# Packaging

Native packages are the release install contract. Linux ships both `.deb` and
`.rpm`; macOS ships `.pkg`. The distro-agnostic tarball remains the layout input
for native package and container builds. Containers replace its native binary
with a build that excludes the `embedded-gateway` default feature.

Every artifact carries one gateway binary with the web client compiled into it
(`src/assets.rs` embeds the bundle from Cargo's private output directory at build
time). No package installs a web directory, and there is nothing to point the
gateway at.

## Native layouts

Linux package managers own the conventional FHS paths directly:

```text
/usr/bin/remotex
/usr/share/doc/remotex/remotex.example.toml
```

The macOS package owns the corresponding local prefix:

```text
/usr/local/bin/remotex
/usr/local/share/doc/remotex/remotex.example.toml
```

The Windows package (`.msi`) owns the same tree under the 64-bit Program Files
directory and puts its `bin` on the machine `PATH`:

```text
C:\Program Files\remotex\bin\remotex.exe
C:\Program Files\remotex\share\doc\remotex\remotex.example.toml
```

There is no package wrapper, version directory, active-version symlink, or
package-managed rollback. The package manager replaces and removes its files.

The live config is deliberately outside the manifests:
`/etc/remotex/remotex.toml` on Linux,
`/usr/local/etc/remotex/remotex.toml` on macOS and
`%ProgramData%\remotex\remotex.toml` on Windows. The operator creates it from the
example with mode `0600` and ownership of the account that runs the gateway.
That keeps both upgrades and removals away from stored credentials.

What the gateway keeps between runs — today only the `[meter]` database — is
outside the manifests for the same reason, in a state directory the gateway
creates when it first needs it: `/var/lib/remotex` on Linux,
`/usr/local/var/remotex` on macOS and `%ProgramData%\remotex` on Windows. The
account that runs the gateway must be able to create or write it. The container
uses `/opt/remotex/var`, which wants a volume for the records to outlive it.

## Scripts

| Path | Purpose |
|---|---|
| `build-tarball.sh` | build the gateway and assemble the common release payload |
| `build-native-packages.sh` | consume that payload and build `.deb` + `.rpm` or `.pkg` |
| `build-windows-msi.ps1` | build the gateway on Windows and the `.msi` from `windows/remotex.wxs` (WiX 5) |
| `verify-windows-msi.ps1` | install that `.msi`, run the installed gateway, remove it, check nothing is left |
| `build-container-binary.sh` | build and verify a gateway with default features disabled, plus any `REMOTEX_CONTAINER_FEATURES` |
| `publish-full-image.sh` | build a release tag's linux/amd64 image with Debian's libavcodec and fdk-aac installed and push it to the private `ghcr.io/andrewtheguy/remotex-full` |
| `uninstall-macos-pkg.sh` | remove the installed `.pkg` by its receipt and forget it |
| `Dockerfile` | build an image from an extracted release tarball |

## Local build

```sh
cd frontend && bun install --frozen-lockfile && cd ..
bash packaging/build-tarball.sh
bash packaging/build-native-packages.sh
```

The native builder requires `dpkg-deb` and `rpmbuild` on Linux, or `pkgbuild` on
macOS. On Windows, in PowerShell 7 with WiX on `PATH`
(`dotnet tool install --global wix --version 5.0.2`):

```powershell
pwsh -File packaging\build-windows-msi.ps1
pwsh -File packaging\verify-windows-msi.ps1   # elevated: installs and removes it
```

Outputs are:

```text
dist/remotex-linux-amd64.deb
dist/remotex-linux-amd64.rpm
dist/remotex-macos-arm64.pkg
dist/remotex-windows-x86_64.msi
```

Arm Linux runners use `arm64` in the asset names. The tarballs keep versioned
filenames, which the container build selects by release version.

## x86-64 CPU compatibility

The Linux x86-64 binary targets the baseline x86-64 ISA and dispatches SIMD at
run time. Neither Cargo configuration nor packaging and CI set `target-cpu`, and
the prebuilt archives downloaded by the sys crates must use the same baseline
with their hand-written kernels selected by CPUID: libvpx's rtcd tables and
opus's `MAY_HAVE` dispatch. The sys crates fetch
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

## Prebuilt native dependencies

Release builds link `opus-prebuilt` and `libvpx-prebuilt`. Their sys crates
download static archives instead of building vendored C and C++, so this project
needs no CMake, assembler, pkg-config, libclang, vcpkg, or system copies of
those libraries. `LIBVPX_PREBUILT_DIR` and `LIBOPUS_PREBUILT_DIR` select locally
built archives.

`ard-high-performance` targets decode the Mac's stream with two decoders whose
licences keep them out of every artifact: FFmpeg's libavcodec
(LGPL-2.1-or-later) for the HEVC picture and Fraunhofer's fdk-aac, whose licence
is not OSI-approved and grants no patents, for the AAC-ELD sound. No build
compiles or links either: the gateway loads the system's shared libraries when a
session needs them (`src/libav.rs`, `src/aac_eld.rs`), and a host without them
runs those targets only with `media_passthrough`, for browsers that decode the
stream. The `.deb` recommends the Linux ones, the public container image carries
neither and the private one `publish-full-image.sh` builds carries Debian's;
elsewhere they are installed by hand:

| | libavcodec (FFmpeg 6.1 to 9) | fdk-aac |
|---|---|---|
| Linux | `libavcodec.so.60` to `.63`, e.g. Debian's `libavcodec61` | `libfdk-aac.so.2`, `libfdk-aac2` (Debian non-free, Ubuntu multiverse) |
| macOS | `libavcodec.60.dylib` to `.63`, `brew install ffmpeg` | `libfdk-aac.2.dylib`, `brew install fdk-aac` |
| Windows | `avcodec-60.dll` to `-63`, MSYS2's `mingw-w64-ucrt-x86_64-ffmpeg` | `libfdk-aac-2.dll`, MSYS2's `mingw-w64-ucrt-x86_64-fdk-aac` |

Each is looked for by the platform loader's own search, then in Homebrew's and
MacPorts' `lib` or MSYS2's `C:\msys64\ucrt64\bin`. On macOS the loaded
libavcodec decodes through VideoToolbox.

The non-default `apple-hp-media-static` feature links private static archives
instead, and is in no release artifact.
`libavcodec-hevc-prebuilt` links FFmpeg's libavcodec and libavutil, configured
down to the HEVC decoder and parser, and on macOS its VideoToolbox hwaccel, which
links Apple's VideoToolbox, CoreMedia, CoreVideo and CoreFoundation frameworks;
its build script downloads the latest release of
`andrewtheguy/libavcodec-hevc-prebuilt-archives` through `gh`, or takes
`LIBAVCODEC_HEVC_PREBUILT_DIR`.
FFmpeg linked statically obliges a distributor of a binary to let its recipient
relink it against a modified FFmpeg (see that repository's README).
`fdk-aac-prebuilt` links fdk-aac the same way, from its own private archives,
through `gh` or `FDK_AAC_PREBUILT_DIR`. Do not restore
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

`.github/workflows/release.yml` creates a draft, builds the frontend once, then
builds native packages and tarballs for Linux x86-64, Linux arm64, and macOS
arm64, and the MSI for Windows x86-64. The release is published only after the packages and common artifacts
succeed.

Container images take their layout from the Linux tarballs, then replace
`bin/remotex` with the separately built container gateway. The build
script, release smoke test, and Dockerfile all reject a binary that exposes
`tui`, `serve-embedded`, or `check-config --embedded`. The tarballs therefore remain
build plumbing and fallback payloads even though native packages are what users
are directed to install.

`remotex-viewer` is released from [its own repository](https://github.com/andrewtheguy/remotex-viewer), not from
this one.
