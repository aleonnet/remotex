#!/usr/bin/env bash
# Build the native installer(s) for the current platform from the release
# tarball produced by build-tarball.sh.
#
# Linux produces both package formats from the same payload:
#   dist/remotex-linux-amd64.deb
#   dist/remotex-linux-amd64.rpm
#
# macOS produces:
#   dist/remotex-macos-arm64.pkg
#
# Native packages use package-manager-owned paths directly. There is no
# versioned tree, active-version symlink, rollback copy, or package wrapper:
#
#   Linux: /usr/bin/remotex
#   macOS: /usr/local/bin/remotex
#
# Every package brings libFLAC, which decodes wlshare's sound and is loaded at
# run time (desktop-flac): the Linux ones depend on the distribution's, and the
# macOS one, whose system has none, carries its own:
#
#   macOS: /usr/local/lib/remotex/libFLAC.14.dylib
#
# The web client is inside that one binary; the packages carry no web directory.
#
# The live config is not package-owned. It contains credentials, so the operator
# creates it from the packaged example with the ownership of the account that
# will run the gateway; package upgrades and removals consequently cannot
# replace or delete it.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

version="$(python3 -c '
import re, sys, tomllib
with open("Cargo.toml", "rb") as f:
    version = tomllib.load(f)["package"]["version"]
if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", version):
    sys.exit(f"invalid version in Cargo.toml: {version!r}")
print(version)
')"

case "$(uname -s)" in
  Linux)  os=linux ;;
  Darwin) os=macos ;;
  *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64)
    tar_arch=x86_64
    asset_arch=amd64
    deb_arch=amd64
    ;;
  arm64|aarch64)
    tar_arch=arm64
    asset_arch=arm64
    deb_arch=arm64
    ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

tarball="dist/remotex-${version}-${os}-${tar_arch}.tar.gz"
[ -f "$tarball" ] || {
  echo "missing $tarball; run packaging/build-tarball.sh first" >&2
  exit 1
}

mkdir -p tmp dist
stage="$(mktemp -d "$repo_root/tmp/native-packages.XXXXXX")"
trap 'rm -rf "$stage"' EXIT

mkdir -p "$stage/release"
tar -xzf "$tarball" -C "$stage/release" --strip-components=1
release="$stage/release"

[ -x "$release/bin/remotex" ] || { echo "release tarball has no executable gateway" >&2; exit 1; }
[ "$(cat "$release/VERSION")" = "$version" ] || { echo "release tarball VERSION does not match Cargo.toml" >&2; exit 1; }

reported="$("$release/bin/remotex" --version)"
[ "$reported" = "remotex $version" ] || {
  echo "release binary reports '$reported', expected 'remotex $version'" >&2
  exit 1
}

if [ "$os" = macos ]; then
  command -v pkgbuild >/dev/null 2>&1 || { echo "pkgbuild is required" >&2; exit 1; }
  command -v cmake >/dev/null 2>&1 || { echo "cmake is required, to build libFLAC" >&2; exit 1; }
  payload="$stage/payload"
  mkdir -p "$payload/usr/local/bin" "$payload/usr/local/share/doc/remotex" "$payload/usr/local/lib/remotex"
  # -X: without the extended attributes, which pkgbuild would archive (below).
  cp -X "$release/bin/remotex" "$payload/usr/local/bin/remotex"
  cp -X "$release/share/doc/remotex/"* "$payload/usr/local/share/doc/remotex/"

  # libFLAC, in a folder of the package's own (`carried_libflac` in
  # src/config.rs), so it neither replaces nor is replaced by a FLAC the operator
  # installed. Built from FLAC's release source, checked against the digest of
  # the file this was written against: without Ogg, so it needs nothing beside
  # it, and for macOS 11, the oldest the gateway itself runs on.
  flac_version=1.5.0
  flac_sha256=f2c1c76592a82ffff8413ba3c4a1299b6c7ab06c734dee03fd88630485c2b920
  curl -fsSL -o "$stage/flac.tar.xz" \
    "https://github.com/xiph/flac/releases/download/${flac_version}/flac-${flac_version}.tar.xz"
  echo "${flac_sha256}  $stage/flac.tar.xz" | shasum -a 256 -c - >/dev/null
  tar -xJf "$stage/flac.tar.xz" -C "$stage"
  cmake -S "$stage/flac-${flac_version}" -B "$stage/flac-build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 \
    -DBUILD_SHARED_LIBS=ON -DWITH_OGG=OFF -DBUILD_CXXLIBS=OFF -DBUILD_PROGRAMS=OFF \
    -DBUILD_EXAMPLES=OFF -DBUILD_TESTING=OFF -DBUILD_DOCS=OFF -DINSTALL_MANPAGES=OFF \
    > "$stage/flac-build.log" 2>&1 \
    && cmake --build "$stage/flac-build" --target FLAC >> "$stage/flac-build.log" 2>&1 \
    || { cat "$stage/flac-build.log" >&2; echo "libFLAC did not build" >&2; exit 1; }
  flac_dylib="$payload/usr/local/lib/remotex/libFLAC.14.dylib"
  # -L: the versioned name is a link to the file.
  cp -LX "$stage/flac-build/src/libFLAC/libFLAC.14.dylib" "$flac_dylib"
  # After its own name, everything it links must be the system's.
  if otool -L "$flac_dylib" | tail -n +3 | grep -v '^[[:space:]]*/usr/lib/'; then
    echo "the built libFLAC links a library macOS does not have" >&2
    exit 1
  fi
  output="dist/remotex-macos-${asset_arch}.pkg"
  pkgbuild \
    --root "$payload" \
    --identifier com.andrewtheguy.remotex.gateway \
    --version "$version" \
    --install-location / \
    "$output"

  pkgutil --payload-files "$output" > "$stage/pkg-contents"
  # pkgbuild archives a file's extended attributes as a `._` entry beside it, and
  # the receipt then lists paths the uninstaller refuses. macOS stamps
  # com.apple.provenance, which nothing clears, on what a shell started from some
  # apps writes; a build over ssh or on a CI runner has none.
  if grep -E '(^|/)\._' "$stage/pkg-contents" >&2; then
    echo "the payload's files carry extended attributes; build from a shell that does not stamp them" >&2
    exit 1
  fi
  grep -qx './usr/local/bin/remotex' "$stage/pkg-contents"
  grep -qx './usr/local/lib/remotex/libFLAC.14.dylib' "$stage/pkg-contents"
  for doc in remotex.example.toml LICENSE; do
    grep -qx "./usr/local/share/doc/remotex/$doc" "$stage/pkg-contents"
  done
  echo ">> wrote $output"
  exit 0
fi

command -v dpkg-deb >/dev/null 2>&1 || { echo "dpkg-deb is required" >&2; exit 1; }
command -v rpmbuild >/dev/null 2>&1 || { echo "rpmbuild is required" >&2; exit 1; }

payload="$stage/payload"
mkdir -p "$payload/usr/bin" "$payload/usr/share/doc/remotex"
cp "$release/bin/remotex" "$payload/usr/bin/remotex"
cp "$release/share/doc/remotex/"* "$payload/usr/share/doc/remotex/"

# '-' separates the Debian revision, so a SemVer prerelease has to become '~',
# which sorts before everything: '0.0.1-rc.1-1' would otherwise sort *after* the
# '0.0.1-1' release. '+' is left alone — it is legal in a Debian version and
# already sorts after the plain release, which is what build metadata means.
# `tr`, not '${version//-/~}': bash 5.2 tilde-expands a replacement that begins
# with '~', which turned '0.0.208-beta1' into '0.0.208$HOMEbeta1'.
deb_version=$(printf '%s' "$version" | tr -- '-' '~')

deb_root="$stage/deb-root"
cp -R "$payload" "$deb_root"
mkdir -p "$deb_root/DEBIAN"
{
  echo "Package: remotex"
  echo "Version: ${deb_version}-1"
  echo "Architecture: $deb_arch"
  echo "Maintainer: andrewtheguy <andrewchen5678@gmail.com>"
  echo "Section: net"
  echo "Priority: optional"
  # libFLAC decodes wlshare's sound and is loaded at run time (desktop-flac), so
  # nothing reads it out of the binary: FLAC 1.5's, or 1.4's where that is the
  # one the distribution has, as on Ubuntu 24.04.
  echo "Depends: ca-certificates, libc6 (>= 2.39), libflac14 | libflac12t64"
  # High Performance's HEVC decoder, loaded at run time (src/libav.rs): any
  # libavcodec the gateway loads.
  echo "Recommends: libavcodec63 | libavcodec62 | libavcodec61 | libavcodec60"
  echo "Homepage: https://github.com/andrewtheguy/remotex"
  echo "Description: Single-user browser remote desktop gateway"
  echo " Connects a browser to RDP, VNC, and macOS Screen Sharing targets."
} > "$deb_root/DEBIAN/control"

deb_output="dist/remotex-linux-${asset_arch}.deb"
dpkg-deb --build --root-owner-group "$deb_root" "$deb_output"
[ "$(dpkg-deb --field "$deb_output" Package)" = remotex ]
dpkg-deb --contents "$deb_output" > "$stage/deb-contents"
grep -q '\./usr/bin/remotex$' "$stage/deb-contents"
for doc in remotex.example.toml LICENSE; do
  grep -q "\./usr/share/doc/remotex/$doc\$" "$stage/deb-contents"
done
echo ">> wrote $deb_output"

# RPM does not accept SemVer's '-' in Version or '+' in either Version or
# Release. Preserve their ordering semantics with '~' for a prerelease and '.'
# for build metadata. Release filenames retain the exact Cargo version through
# the release tag; this only affects RPM's internal version field.
rpm_version=$(printf '%s' "$version" | tr -- '-+' '~.')

rpm_top="$stage/rpmbuild"
mkdir -p "$rpm_top/BUILD" "$rpm_top/BUILDROOT" "$rpm_top/RPMS" "$rpm_top/SOURCES" "$rpm_top/SPECS" "$rpm_top/SRPMS"
spec="$rpm_top/SPECS/remotex.spec"
{
  echo '%global debug_package %{nil}'
  echo '%global __os_install_post %{nil}'
  echo 'Name: remotex'
  echo "Version: $rpm_version"
  echo 'Release: 1'
  echo 'Summary: Single-user browser remote desktop gateway'
  echo 'License: MIT'
  echo 'URL: https://github.com/andrewtheguy/remotex'
  echo 'Requires: ca-certificates'
  # libFLAC, as the .deb depends on it: whichever of the two the distribution has.
  echo 'Requires: (libFLAC.so.14()(64bit) or libFLAC.so.12()(64bit))'
  echo
  echo '%description'
  echo 'Connects a browser to RDP, VNC, and macOS Screen Sharing targets.'
  echo
  echo '%prep'
  echo
  echo '%build'
  echo
  echo '%install'
  echo 'mkdir -p %{buildroot}'
  echo 'cp -a "%{payload}/." "%{buildroot}/"'
  echo
  echo '%files'
  echo '/usr/bin/remotex'
  echo '/usr/share/doc/remotex/remotex.example.toml'
  echo '%license /usr/share/doc/remotex/LICENSE'
} > "$spec"

rpmbuild -bb \
  --define "_topdir $rpm_top" \
  --define "payload $payload" \
  "$spec"

rpm_built="$(find "$rpm_top/RPMS" -type f -name '*.rpm' -print -quit)"
[ -n "$rpm_built" ] || { echo "rpmbuild produced no package" >&2; exit 1; }
rpm_output="dist/remotex-linux-${asset_arch}.rpm"
cp "$rpm_built" "$rpm_output"
rpm -qpl "$rpm_output" > "$stage/rpm-contents"
grep -qx '/usr/bin/remotex' "$stage/rpm-contents"
for doc in remotex.example.toml LICENSE; do
  grep -qx "/usr/share/doc/remotex/$doc" "$stage/rpm-contents"
done
echo ">> wrote $rpm_output"
