#!/usr/bin/env bash
# Build Alumia.app: the Mac app, with the gateway's binary inside it.
#
#   packaging/build-mac-app.sh                 dist/mac/Alumia.app
#   packaging/build-mac-app.sh --test          dist/mac/Alumia Test.app: a copy that never
#                                              touches an installed Alumia (see below)
#   packaging/build-mac-app.sh --test --smoke  the same, and then the copy checks itself:
#                                              it registers its service, waits for the
#                                              gateway to serve, ends it and waits for the
#                                              system to bring it back, stops it and starts
#                                              it as its owner would, and takes everything
#                                              away again, the copy itself included
#   packaging/build-mac-app.sh --test --smoke-trash
#                                              the same copy puts itself in the Trash while
#                                              its gateway serves, and waits thirty seconds
#                                              for its service and its folder to be gone; the
#                                              copy does not come back from the Trash
#
# The bundle is put together by hand, with no Xcode project, as docs/mac-app.md says and why:
#
#   Contents/MacOS/Alumia                           the app (macos/Alumia, `swift build`)
#   Contents/Helpers/alumia                         the gateway (`cargo build --release`)
#   Contents/Library/LaunchAgents/<id>.gateway.plist  the service the app registers
#   Contents/Resources/AppIcon.icns                 drawn by packaging/macos/icon.swift
#   Contents/Resources/<language>.lproj/InfoPlist.strings
#   Contents/Resources/THIRD-PARTY-LICENSES.txt     what the gateway is built from
#   Contents/Resources/LICENSE                      Alumia's own
#
# The gateway goes in Contents/Helpers and not beside the app's own executable: the disk
# does not tell `alumia` from `Alumia`.
#
# Signing is from the inside out, each piece by itself and never with --deep: "Sign code
# from the inside out." With ALUMIA_SIGN_IDENTITY (a Developer ID Application identity) the
# pieces are signed for distribution, with the Hardened Runtime and a secure timestamp, which
# is what notarization asks; without it they are signed ad hoc, which runs on this Mac and
# nowhere else. The gateway alone carries an entitlement, and why is in
# packaging/macos/gateway.entitlements.
#
# A copy made for testing has another bundle identifier, so another service; keeps
# everything in a folder of its own, named in its Info.plist and in its service's
# environment; and serves its page on port 52399. Nothing of it is the installed app's.
# Nor is the Mac's Tailscale its own to touch: a copy made for testing is given no
# Tailscale command, so it reads nothing of what its owner has published and publishes
# and takes back nothing (macos/Alumia/Sources/AlumiaCore/Tailscale.swift, `Tailscale.of`).
# The two checks above run with no window; the copy is not left open in anybody's session.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
export PATH="$HOME/.cargo/bin:$PATH"

test_copy=""
smoke=""
for argument in "$@"; do
  case "$argument" in
    --test) test_copy=1 ;;
    --smoke | --smoke-trash) smoke="$argument" ;;
    *) echo "build-mac-app: unknown argument $argument" >&2; exit 64 ;;
  esac
done
if [ -n "$smoke" ] && [ -z "$test_copy" ]; then
  echo "build-mac-app: $smoke is for a copy made for testing: add --test" >&2
  exit 64
fi

fail() { echo "build-mac-app: $1" >&2; exit 1; }

version="$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -1)"
[ -n "$version" ] || fail "Cargo.toml names no version"
identity="${ALUMIA_SIGN_IDENTITY:--}"
resources="packaging/macos"
out="dist/mac"

if [ -n "$test_copy" ]; then
  name="Alumia Test"
  identifier="com.aleonnet.alumia.test"
  test_dir="$HOME/Library/Application Support/alumia/app-test"
  test_port=52399
else
  name="Alumia"
  identifier="com.aleonnet.alumia"
fi
app="$out/$name.app"

echo ">> the gateway (cargo build --release)"
cargo build --release
gateway="${CARGO_TARGET_DIR:-target}/release/alumia"
# The app runs these, and a gateway without them is one it cannot host.
case "$("$gateway" serve --help 2>&1; "$gateway" app --help 2>&1)" in
  *config-apply*) ;;
  *) fail "the gateway built here has no \`app\` commands: it needs macOS and the embedded-gateway feature" ;;
esac

echo ">> the app (swift build -c release --arch arm64)"
# The link is told where the system kit is. macOS draws an app in the look of the kit its
# executable says it was built against ("build your app with the latest SDKs, and run it on
# the latest platform releases to see the changes in your interface", Apple, Adopting Liquid
# Glass), and `swift build` links through the toolchain's own driver, which is handed
# `--sysroot` and no SDKROOT: the linker is then told the oldest system the app runs on in the
# kit's place, and the app comes up in that system's look. Measured, with the address of each
# sentence, in docs/research/2026-10-06-1300-correcao-app-de-mac.md; read back below.
sdk="$(xcrun --sdk macosx --show-sdk-path)"
kit=(-Xswiftc -Xclang-linker -Xswiftc -isysroot -Xswiftc -Xclang-linker -Xswiftc "$sdk")
(cd macos/Alumia && swift build -c release --arch arm64 -Xswiftc -warnings-as-errors "${kit[@]}" >/dev/null)
products="$(cd macos/Alumia && swift build -c release --arch arm64 "${kit[@]}" --show-bin-path)"
[ -x "$products/Alumia" ] || fail "swift build left no Alumia in $products"

echo ">> $app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Helpers" "$app/Contents/Library/LaunchAgents" "$app/Contents/Resources"
cp "$products/Alumia" "$app/Contents/MacOS/Alumia"
cp "$gateway" "$app/Contents/Helpers/alumia"

# A template's line marked for a copy made for testing is kept only in one.
fill() {
  if [ -n "$test_copy" ]; then
    sed -e "s|@TEST_DIR@|$test_dir|g" -e "s|@TEST_PORT@|$test_port|g" -e 's|<!-- test copy -->||' "$1"
  else
    grep -v '<!-- test copy -->' "$1"
  fi | sed -e "s|@IDENTIFIER@|$identifier|g" -e "s|@NAME@|$name|g" -e "s|@VERSION@|$version|g"
}
fill "$resources/Info.plist.in" > "$app/Contents/Info.plist"
fill "$resources/gateway.plist.in" > "$app/Contents/Library/LaunchAgents/$identifier.gateway.plist"
plutil -lint "$app/Contents/Info.plist" "$app/Contents/Library/LaunchAgents/$identifier.gateway.plist" >/dev/null \
  || fail "a property list written here does not read"
for language in en pt-BR; do
  mkdir -p "$app/Contents/Resources/$language.lproj"
  cp "$resources/$language.lproj/InfoPlist.strings" "$app/Contents/Resources/$language.lproj/"
done

# The icon, in the brand's own colours as the design tokens have them.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
read -r glass red green blue < <(uv run --no-project python - <<'PY'
import json
brand = json.load(open("docs/design/alumia.tokens.json"))["color"]["brand"]
print(*(brand[name]["$value"]["hex"] for name in ("glass", "red", "green", "blue")))
PY
)
swift "$resources/icon.swift" "$work/icon.png" "$glass" "$red" "$green" "$blue"
mkdir "$work/AppIcon.iconset"
for spec in "16 icon_16x16" "32 icon_16x16@2x" "32 icon_32x32" "64 icon_32x32@2x" "128 icon_128x128" \
            "256 icon_128x128@2x" "256 icon_256x256" "512 icon_256x256@2x" "512 icon_512x512" "1024 icon_512x512@2x"; do
  sips -z "${spec%% *}" "${spec%% *}" "$work/icon.png" --out "$work/AppIcon.iconset/${spec##* }.png" >/dev/null
done
iconutil -c icns "$work/AppIcon.iconset" -o "$app/Contents/Resources/AppIcon.icns"

# What the gateway is built from, by name, version and licence: each crate's own word for
# it, as `cargo metadata` has it. FFmpeg is not among them and not in the bundle: the
# gateway loads the one the Mac has (packaging/README.md).
cargo metadata --format-version 1 --locked | uv run --no-project python -c '
import json, sys
packages = json.load(sys.stdin)["packages"]
print("Alumia is built from these, each under its own licence.\n")
for package in sorted(packages, key=lambda package: (package["name"].lower(), package["version"])):
    licence = package.get("license") or "see " + (package.get("license_file") or "its repository")
    print(package["name"], package["version"], "-", licence, "-", package.get("repository") or "")
' > "$app/Contents/Resources/THIRD-PARTY-LICENSES.txt"
# And Alumia's own, which every artifact carries.
cp LICENSE "$app/Contents/Resources/LICENSE"

echo ">> signing as ${identity/#-/ad hoc}"
sign() {  # 1 = what, 2... = more for codesign
  local what="$1"; shift
  if [ "$identity" = "-" ]; then
    codesign --force --sign - "$@" "$what" 2>/dev/null || fail "could not sign $what"
  else
    codesign --force --options runtime --timestamp --sign "$identity" "$@" "$what" 2>/dev/null \
      || fail "could not sign $what as $identity"
  fi
}
sign "$app/Contents/Helpers/alumia" --entitlements "$resources/gateway.entitlements"
sign "$app"

codesign --verify --strict --deep "$app" 2>/dev/null || fail "the bundle's signature does not verify"
codesign -d --entitlements - "$app/Contents/Helpers/alumia" 2>/dev/null \
  | grep -q "com.apple.security.cs.disable-library-validation" \
  || fail "the gateway lacks the entitlement that lets it load the Mac's FFmpeg"
if [ "$identity" != "-" ]; then
  for piece in "$app/Contents/Helpers/alumia" "$app"; do
    said="$(codesign -dv --verbose=2 "$piece" 2>&1 || true)"
    case "$said" in *"flags=0x10000(runtime)"*) ;; *) fail "$piece is not signed with the Hardened Runtime" ;; esac
    case "$said" in *"Timestamp="*) ;; *) fail "$piece has no secure timestamp" ;; esac
  done
fi
# What was written is what is there.
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" = "$identifier" ] \
  || fail "the bundle's identifier is not $identifier"
[ "$(/usr/libexec/PlistBuddy -c 'Print :BundleProgram' "$app/Contents/Library/LaunchAgents/$identifier.gateway.plist")" = "Contents/Helpers/alumia" ] \
  || fail "the service does not name the gateway inside the bundle"
# And the kit the app's executable says it was built against is this Mac's, read from the
# executable itself.
built="$(otool -l "$app/Contents/MacOS/Alumia" | awk '/LC_BUILD_VERSION/ { found = 1 } found && $1 == "sdk" { print $2; exit }')"
has="$(xcrun --sdk macosx --show-sdk-version)"
[ "$built" = "$has" ] || fail "the app's executable says the system kit ${built:-none}, and this Mac's is $has"
echo "build-mac-app: the app's executable is built against the system kit $built"

echo "build-mac-app: $app, version $version, signed as ${identity/#-/ad hoc}"

if [ -n "$smoke" ]; then
  echo ">> the copy checks itself"
  # A copy built for a check goes with the check, passed or failed: left in dist/mac it is
  # a second Alumia on somebody's Mac, which the system goes on listing under Login Items
  # after its service is unregistered, and for some time after the bundle is gone too
  # ("The login item may remain visible in the System Settings > General > Login Items for
  # some time", Apple, quoted with its address in docs/research/2026-10-05-0030-app-de-mac.md).
  checked=0
  "$app/Contents/MacOS/Alumia" "$smoke" || checked=$?
  rm -rf "$app"
  exit "$checked"
fi
