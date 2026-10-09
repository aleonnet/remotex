#!/usr/bin/env bash
# Whether the Linux binary the release builds runs where the install guide says it does.
#
# The release workflow compiles the gateway on an Ubuntu 26.04 runner
# (.github/workflows/release.yml), and the packages it makes ask for the glibc that
# packaging/build-native-packages.sh names, which is what docs/install.md promises. A
# binary asks for the newest glibc symbol versions it was linked against, whatever its
# package says: built against a newer glibc it can ask for more than the floor, and then
# it installs and does not start. So this reads the newest GLIBC_ version a binary names
# and starts the binary on the oldest Ubuntu of the promise, and fails when the binary
# asks for more than the floor, or does not start there.
#
#   tools/check-linux-floor.sh                  builds the gateway first, in an Ubuntu 26.04
#                                               container of this machine's architecture, as
#                                               the workflow's runner does
#   tools/check-linux-floor.sh --binary <path>  checks a Linux binary already built, on a
#                                               Linux host of its architecture: what the
#                                               release runs on each binary it has just built
#
# It needs Docker. Building, the container keeps its own target directory and its own cargo
# registry in two Docker volumes, so nothing of a Linux build is written among this
# checkout's own. Only the architecture of the machine is built here: Docker's emulation of
# another one on a Mac does not unpack the prebuilt archives the build downloads, so x86-64
# is checked where it is built, by the release.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
export PATH="$HOME/.bun/bin:$PATH"

fail() { echo "check-linux-floor: $1" >&2; exit 1; }

built=""
case "${1:-}" in
  "") ;;
  --binary)
    built="${2:-}"
    [ -f "$built" ] || fail "--binary names no file: '$built'"
    ;;
  *) echo "check-linux-floor: unknown argument $1" >&2; exit 64 ;;
esac

command -v docker >/dev/null || fail "Docker is not installed"
docker info >/dev/null 2>&1 || fail "Docker is not running"

floor="$(sed -n 's/.*libc6 (>= \([0-9.]*\)).*/\1/p' packaging/build-native-packages.sh | head -1)"
[ -n "$floor" ] || fail "packaging/build-native-packages.sh names no libc6 floor"
grep -q "glibc $floor" docs/install.md || fail "docs/install.md does not promise glibc $floor, the floor the package names"
# The oldest Ubuntu docs/install.md names for the floor.
oldest_image="ubuntu:24.04"

if [ -n "$built" ]; then
  # The host reads the binary it built, and the oldest Ubuntu is handed its folder.
  command -v objdump >/dev/null || fail "objdump is not installed"
  from="the binary at $built"
  folder=(-v "$(cd "$(dirname "$built")" && pwd)":/built:ro)
  binary="/built/$(basename "$built")"
  asked="$(objdump -T "$built" | grep -o "GLIBC_[0-9.]*" | sort -uV | tail -1)"
else
  builder="$(sed -n 's/.*runner: \(ubuntu-[0-9.]*\)$/\1/p' .github/workflows/release.yml | head -1)"
  [ -n "$builder" ] || fail ".github/workflows/release.yml names no Ubuntu runner"
  builder_image="ubuntu:${builder#ubuntu-}"
  from="built in $builder_image, the binary"
  folder=(-v alumia-linux-floor-target:/built)
  binary="/built/release/alumia"

  # The page's bundle is built once, on the host, and handed to the build prebuilt, as the
  # workflow hands its own.
  echo ">> the page's bundle (bun run build)"
  (cd frontend && bun run build >/dev/null) || fail "the page's bundle did not build"

  echo ">> the gateway, in $builder_image (cargo build --release)"
  docker run --rm \
    -v "$repo_root":/src \
    -v alumia-linux-floor-target:/target \
    -v alumia-linux-floor-cargo:/root/.cargo \
    -e CARGO_TARGET_DIR=/target \
    -e RUSTUP_HOME=/root/.cargo/rustup \
    -e ALUMIA_PREBUILT_FRONTEND=frontend/dist \
    -w /src "$builder_image" bash -euc '
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq
      apt-get install -y -qq --no-install-recommends \
        build-essential ca-certificates clang cmake curl git nasm perl pkg-config python3 binutils >/dev/null
      # The toolchain lives in the same volume as the registry, so a second run finds it.
      [ -x /root/.cargo/bin/rustup ] || curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal >/dev/null
      . /root/.cargo/env
      rustup default stable >/dev/null
      cargo build --release
      objdump -T /target/release/alumia | grep -o "GLIBC_[0-9.]*" | sort -uV | tail -1 > /target/glibc-asked
    ' || fail "the gateway did not build in $builder_image"
  asked="$(docker run --rm "${folder[@]}" "$oldest_image" cat /built/glibc-asked)"
fi

asked="${asked#GLIBC_}"
[ -n "$asked" ] || fail "the binary names no GLIBC_ version"
newest="$(printf '%s\n%s\n' "$floor" "$asked" | sort -V | tail -1)"
echo "check-linux-floor: $from asks for glibc $asked; the floor is $floor"
[ "$newest" = "$floor" ] || fail "the binary asks for glibc $asked, newer than the $floor that docs/install.md promises"

# The image first, by itself: what `docker run` says while it fetches one goes where the
# binary's own words go, and would be read as the binary's answer.
docker pull -q "$oldest_image" >/dev/null || fail "$oldest_image could not be fetched"
started="$(docker run --rm "${folder[@]}" "$oldest_image" "$binary" --version 2>&1)" \
  || fail "the binary does not start in $oldest_image: $started"
version="$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -1)"
[ "$started" = "alumia $version" ] || fail "in $oldest_image the binary said '$started', not 'alumia $version'"
echo "check-linux-floor: it starts in $oldest_image and says $started"
