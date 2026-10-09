# Packaging

Native packages are the release install contract. Linux ships both `.deb` and
`.rpm`; macOS ships `.pkg`. The distro-agnostic tarball is the layout input
for native package and container builds, and no release asset. Containers replace its native binary
with a build that excludes the `embedded-gateway` default feature.

A Mac also has the app: `Alumia.app` in a disk image, which hosts the same
gateway and is its control ([The Mac app](../docs/mac-app.md)). It is built on
the Mac that holds the Developer ID identity and the notary credential, by the
two scripts below, and attached to the version's release by the publication
(`tools/publish-public.sh`), not by the release workflow.

Every artifact carries one gateway binary with the web client compiled into it
(`src/assets.rs` embeds the bundle from Cargo's private output directory at build
time). No package installs a web directory, and there is nothing to point the
gateway at.

## Native layouts

Linux package managers own the conventional FHS paths directly:

```text
/usr/bin/alumia
/usr/share/doc/alumia/alumia.example.toml
/usr/share/doc/alumia/LICENSE
```

The macOS package owns the corresponding local prefix:

```text
/usr/local/bin/alumia
/usr/local/share/doc/alumia/alumia.example.toml
/usr/local/share/doc/alumia/LICENSE
```

By default the Windows package (`.msi`) owns the same tree under the 64-bit Program
Files directory and puts its `bin` on the machine `PATH`; its install wizard can
select another directory:

```text
C:\Program Files\alumia\bin\alumia.exe
C:\Program Files\alumia\VERSION
C:\Program Files\alumia\share\doc\alumia\alumia.example.toml
C:\Program Files\alumia\share\doc\alumia\LICENSE
```

The Mac app is one bundle, dragged to Applications, with the gateway inside it:

```text
Alumia.app/Contents/MacOS/Alumia
Alumia.app/Contents/Helpers/alumia
Alumia.app/Contents/Library/LaunchAgents/com.aleonnet.alumia.gateway.plist
Alumia.app/Contents/Resources/LICENSE
Alumia.app/Contents/Resources/THIRD-PARTY-LICENSES.txt
```

It keeps its settings and everything else of its gateway in
`~/Library/Application Support/alumia/app`, which the app writes and its
Uninstall deletes; it reads none of the `.pkg`'s paths.

Every artifact, container images included, carries alumia's MIT `LICENSE`.

There is no package wrapper, version directory, active-version symlink, or
package-managed rollback. The package manager replaces and removes its files.

The live config is deliberately outside the manifests:
`/etc/alumia/alumia.toml` on Linux,
`/usr/local/etc/alumia/alumia.toml` on macOS and
`%ProgramData%\alumia\alumia.toml` on Windows. The operator creates it from the
example with mode `0600` and ownership of the account that runs the gateway.
That keeps both upgrades and removals away from stored credentials.

What the gateway keeps between runs — today only the `[meter]` database — is
outside the manifests for the same reason, in a state directory the gateway
creates when it first needs it: `/var/lib/alumia` on Linux,
`/usr/local/var/alumia` on macOS and `%ProgramData%\alumia` on Windows. The
account that runs the gateway must be able to create or write it. The container
uses `/opt/alumia/var`, which wants a volume for the records to outlive it.

## Scripts

| Path | Purpose |
|---|---|
| `build-tarball.sh` | build the gateway and assemble the common release payload |
| `build-native-packages.sh` | consume that payload and build `.deb` + `.rpm` or `.pkg` |
| `build-windows-msi.ps1` | build the gateway on Windows and the `.msi` from `windows/alumia.wxs` (WiX 5) |
| `verify-windows-msi.ps1` | install that `.msi`, run the installed gateway, remove it, check nothing is left |
| `build-container-binary.sh` | build and verify a gateway with default features disabled, plus any `ALUMIA_CONTAINER_FEATURES` |
| `publish-full-image.sh` | add Debian's libavcodec, and the pinned software HEVC decoder's archive, to a release's public linux/amd64 image and push the result to the private `ghcr.io/aleonnet/alumia-full` |
| `uninstall-macos-pkg.sh` | remove the installed `.pkg` by its receipt and forget it |
| `build-mac-app.sh` | build the gateway and the Mac app, assemble `Alumia.app` and sign it from the inside out; `--test` builds a copy that never touches an installed one, and `--smoke` or `--smoke-trash` has that copy check itself |
| `build-mac-dmg.sh` | notarize the app, lay out the disk image it is installed from, sign, notarize and staple it |
| `macos/` | the Mac app's property lists, the gateway's entitlement, and what draws the icon and the disk image's window |
| `Dockerfile` | build an image from an extracted release tarball |

## Local build

```sh
cd frontend && bun install --frozen-lockfile && cd ..
bash packaging/build-tarball.sh
bash packaging/build-native-packages.sh
```

The frontend's
build compiles two WebAssembly modules: one from the gateway's graphics crate
(`frontend/wasm/egfx` around
`crates/alumia-rdp-graphics`, the page's compositor for a passed RDP pipeline),
and the page's FLAC decoder for a session's lossless sound (`frontend/wasm/flac`),
which the stable toolchain builds. So wherever the frontend is built — `bun run build`, or a
Cargo build without `ALUMIA_PREBUILT_FRONTEND` — the compositor's module is built by the nightly
toolchain `frontend/wasm/egfx/rust-toolchain.toml` pins, which its threads need and
nothing else is built with. rustup installs it on the first build, unless
`RUSTUP_AUTO_INSTALL=0` turns that off; `rustup toolchain install` in that
directory installs it ahead of the build, as release CI does. wasm-pack comes with `bun install`. The native builder requires `dpkg-deb` and `rpmbuild` on Linux, or
`pkgbuild` on macOS. On Windows, in PowerShell 7 with WiX on `PATH`
(`dotnet tool install --global wix --version 5.0.2`):

```powershell
pwsh -File packaging\build-windows-msi.ps1
pwsh -File packaging\verify-windows-msi.ps1   # elevated: installs and removes it
```

Outputs are:

```text
dist/alumia-linux-amd64.deb
dist/alumia-linux-amd64.rpm
dist/alumia-macos-arm64.pkg
dist/alumia-windows-x86_64.msi
```

Arm Linux runners use `arm64` in the asset names. The tarballs keep versioned
filenames, which the container build selects by release version.

The Mac app is built by itself, on an Apple Silicon Mac with Xcode, Rust, `bun`
and `uv`:

```sh
bash packaging/build-mac-app.sh
ALUMIA_SIGN_IDENTITY="Developer ID Application: …" ALUMIA_NOTARY_PROFILE=<profile> \
  bash packaging/build-mac-dmg.sh
```

The first leaves `dist/mac/Alumia.app`, signed ad hoc unless
`ALUMIA_SIGN_IDENTITY` names a Developer ID Application identity. The second
needs that identity and a profile stored with
`xcrun notarytool store-credentials`, and leaves `dist/mac/Alumia-<version>.dmg`,
which it does not call built until that Mac's Gatekeeper says
`source=Notarized Developer ID`. [The Mac app](../docs/mac-app.md#building-it)
has the order and why.

## x86-64 CPU compatibility

The Linux x86-64 binary targets the baseline x86-64 ISA and dispatches SIMD at
run time. Neither Cargo configuration nor packaging and CI set `target-cpu`, and
the prebuilt archives downloaded by the sys crates must use the same baseline
with their hand-written kernels selected by CPUID: libvpx's rtcd tables,
opus's `MAY_HAVE` dispatch and libFLAC's own CPU detection. The sys crates fetch
each dependency repository's latest release, so that release's archives—not the
tag pinned in this repository's `Cargo.toml`—set the effective CPU floor.

This policy is measured, not merely conservative. On an i5-8500T,
`target-cpu=x86-64-v3` made PNG encoding 1.7 times slower through changes to the
autovectorized `png`/`fdeflate` loops. VP9 encoding was within noise of a
v3-scalar libvpx, while an opus archive using runtime dispatch consumed 0.73% of
a core against 0.65% with `PRESUME_AVX2`. A global v3 floor also caused `SIGILL`
at startup on Ivy Bridge. If a Rust hot path benefits from AVX2, guard a separate
function with `is_x86_feature_detected!` and `#[target_feature]`; never raise the
binary's global CPU floor.

## The glibc floor

Linux release binaries ask for glibc 2.39 or newer, which is what the packages
declare (`packaging/build-native-packages.sh`) and what
[the install guide](../docs/install.md) promises. The release workflow compiles
on a newer Ubuntu than the oldest one of that promise, and a binary asks for the
newest glibc symbol versions it was linked against, whatever its package says.
`tools/check-linux-floor.sh` holds the two together: it reads the newest `GLIBC_`
version the binary names and starts the binary on Ubuntu 24.04, and fails when
the binary asks for more than the floor or does not start there. The release
runs it on each Linux binary it has just built (`--binary`), x86-64 and arm64,
before anything is uploaded. Run with no argument it builds the gateway first,
in a container of the workflow's own Ubuntu, for the architecture of the machine
it is run on; that is for when the workflow's runner, the floor or a native
dependency changes. It needs Docker. Measured on 2026-10-07, built in Ubuntu
26.04 for arm64: the binary asks for glibc 2.39 and starts on Ubuntu 24.04.
x86-64 was not measured on a Mac, whose Docker does not unpack the build's
prebuilt archives under emulation: the release's own run is what holds it.

## Prebuilt native dependencies

Release builds link `opus-prebuilt`, `libvpx-prebuilt` and, under
[sound-flac](https://github.com/andrewtheguy/sound-flac), `libflac-prebuilt`.
Their sys crates download static archives instead of building vendored C and
C++, so this project needs no CMake, assembler, pkg-config, libclang, vcpkg, or
system copies of those libraries, and no artifact carries or depends on one.
`LIBVPX_PREBUILT_DIR`, `LIBOPUS_PREBUILT_DIR` and `LIBFLAC_PREBUILT_DIR` select
locally built archives.

`ard-high-performance` targets decode the Mac's picture with a decoder whose
licence keeps it out of every artifact: FFmpeg's libavcodec
(LGPL-2.1-or-later), for the HEVC. The Mac's AAC-ELD sound needs none: the
browser decodes it. Published release
artifacts neither compile nor link FFmpeg: the gateway loads the system's shared libraries
when a session needs them, or on Windows the ones in the folder `[hp_decoders]`
names when it starts (`src/libav.rs`), and a host without them
runs those targets only with the picture passed through, for browsers that decode
it. The `.deb` recommends the Linux one, the public container image does not
carry it and the private one `publish-full-image.sh` builds carries Debian's;
the Mac app does not carry it either, and its gateway is signed with the one
entitlement that lets a notarized binary load Homebrew's
(`macos/gateway.entitlements`);
elsewhere the operator installs it, as
[High Performance decoder](../docs/high-performance-decoder.md) says for each
platform.

The non-default `apple-hp-media-static` feature links private static archives
instead, and is in no release artifact. No artifact holds the BETA software
HEVC decoder either, libavcodec in WebAssembly for the page, which FFmpeg's
licence keeps out as it keeps the native decoder out: an operator
downloads the release that `src/hevc_wasm.rs` pins by version and SHA-256 from
the private `andrewtheguy/hevc-wasm-archives` through `gh`, and every build
serves it when it finds it. Every release target looks for it by its release
name in `share/alumia`, beside the `share/doc/alumia` it installs, unless
`[hevc_wasm].archive` names another file:
`/usr/share/alumia` for the `.deb` and `.rpm`, `/usr/local/share/alumia` for
the `.pkg`, `share\alumia` under the `.msi`'s install directory, and
`/opt/alumia/versions/<version>/share/alumia` in the
container image. No package owns or makes that directory: the operator does. The
private image `publish-full-image.sh` builds carries it there.
`libavcodec-hevc-prebuilt` links FFmpeg's libavcodec and libavutil, configured
down to the HEVC decoder and parser, and on macOS its VideoToolbox hwaccel, which
links Apple's VideoToolbox, CoreMedia, CoreVideo and CoreFoundation frameworks;
its build script downloads the latest release of
`andrewtheguy/libavcodec-hevc-prebuilt-archives` through `gh`, or takes
`LIBAVCODEC_HEVC_PREBUILT_DIR`.
FFmpeg linked statically obliges a distributor of a binary to let its recipient
relink it against a modified FFmpeg (see that repository's README).
Do not restore
`LIBOPUS_STATIC`, `LIBOPUS_NO_PKG`, `CMAKE_POLICY_VERSION_MINIMUM`, or a source
libopus build in `build-tarball.sh`. The libvpx archives are VP9-only and built
with `--enable-realtime-only`; additional features need a separately built
archive selected with `LIBVPX_PREBUILT_DIR`, not a source-build fallback.

The one C library built from source is jemalloc, through `tikv-jemallocator`,
the global allocator on every Unix build. It needs only a C compiler and `make`,
which every Unix builder already has. glibc's malloc is not an option: it keeps
freed memory in per-thread arenas, and the gateway's per-session threads grew it
with every session. jemalloc fixes its page size at build time, and a 4K build
will not start on the 16K and 64K kernels arm64 boards ship, so the linux-arm64
release sets `JEMALLOC_SYS_WITH_LG_PAGE=16`. Windows keeps the system heap.

## Releases

A version is published from the private repository, `aleonnet/alumia-app`, to
the public one, `aleonnet/alumia`, by `tools/publish-public.sh`
([Releasing](../docs/release.md)): the tag's tree, less the working notes, as
one commit, with the release created and the Mac app's disk image attached.
Then `.github/workflows/release.yml`, dispatched in the public repository on
that commit, builds the frontend once, the native packages and tarballs for
Linux x86-64, Linux arm64 and macOS arm64, and the MSI for Windows x86-64, and
attaches the packages to that release. There it refuses a commit the version's
tag does not name, and a version with no release. Dispatched anywhere else, in
`aleonnet/alumia-app` above all, it is the rehearsal of that: the same jobs
build, install and test every package and both images, and nothing is attached
to a release or pushed to the registry. A version's packages are rehearsed
there, on the branch it is made on, before the version is tagged.

The Mac app's disk image is not built by it: the Developer ID identity and the
notary credential stay on the Mac that has them, `build-mac-dmg.sh` runs there,
and the publication attaches what it built.

Container images take their layout from the Linux tarballs, then replace
`bin/alumia` with the separately built container gateway. The build
script, release smoke test, and Dockerfile all reject a binary that exposes
`tui`, `serve-embedded`, or `check-config --embedded`. The tarballs are build
plumbing between the workflow's jobs and are not published: the native packages
and the image are what bring the gateway everything it needs.
