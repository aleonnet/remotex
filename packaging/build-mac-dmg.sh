#!/usr/bin/env bash
# Build the disk image somebody installs Alumia from: Alumia.app and a way to the
# Applications folder beside it, signed, notarized and stapled.
#
#   ALUMIA_SIGN_IDENTITY="Developer ID Application: …" \
#   ALUMIA_NOTARY_PROFILE=<profile> [ALUMIA_NOTARY_KEYCHAIN=<keychain file>] \
#     packaging/build-mac-dmg.sh
#
#   packaging/build-mac-dmg.sh --window <name> [--photograph <picture.png>]
#       tmp/mac-window/<name>.dmg: the window alone, to be looked at. Neither signed nor
#       notarized, with the app that is in dist/mac or one built ad hoc, and installed
#       from by nobody: so it is never left in dist/mac, beside the image somebody does
#       install from, which it looks like. One left there was dragged to Applications, and
#       macOS would not start the gateway of an app nobody signed (2026-10-06).
#       With --photograph, the image is mounted, its window opened behind
#       every other, that window alone photographed as the Finder of this Mac draws it,
#       and the image let go: how the Finder draws a window is seen, and not supposed.
#
# It is built on the Mac that holds the identity and the notary credential, and not by the
# release workflow: neither leaves that Mac. The profile is one `xcrun notarytool
# store-credentials` stored; the keychain is where, when it is not the default one.
#
# The order is the house's, measured on its other Mac app, and what Apple asks:
#
# 1. The app is built and signed from the inside out (packaging/build-mac-app.sh).
# 2. The app goes to Apple by itself, in a zip, and its ticket is stapled to it *before* it
#    enters the image: the app somebody drags to Applications then carries its own ticket,
#    and Gatekeeper takes it with no network.
# 3. The image is made with the window the approved mockup draws: the brand's dark glass,
#    the app, an arrow, the way to Applications, and the sentence under them
#    (packaging/macos/dmg-settings.py and dmg-background.swift). It is mounted again and
#    read back: the app is in it, the way to Applications is, the app's signature still
#    verifies, the window's own record and its picture are the ones declared here, by
#    their numbers, and the volume wears the system's own disk with the app's icon flat on
#    the middle of it (packaging/macos/dmg-icon.swift draws it).
# 4. The image is signed, notarized and stapled, its file is given the volume's icon too,
#    and the last word is this Mac's own Gatekeeper, asked with the icon on:
#    `source=Notarized Developer ID`, or the build fails.
#
# The first image made here showed its drawing at half its size, in a corner. The window's
# record and the picture's two sizes read back as declared: it was the dense picture itself
# that had been drawn so, which looking at the picture showed. The drawing now checks that
# it fills the picture (dmg-background.swift), and fails the build where it does not.
#
# Three things about the window are the Finder's and not the image's, each measured on
# macOS 27 on 2026-10-05 by photographing the window (`--photograph`), or read at its source:
#
# - The two names are the Finder's to write, and over a ground of the image's own it
#   writes them black, in a dark Mac too: over the picture, over the picture with the
#   record's colour made black, and over a plain dark colour with no picture, all three
#   photographed. It writes them light only in a window with no ground of its own, which
#   has no arrow and no sentence. So each name stands on a light capsule drawn where the
#   Finder puts it, and the arrow and the sentence are the light things on the dark glass.
# - A Finder with its path bar on, which is a setting of the Finder's and not of the
#   window's, shows the bar at the window's foot, over the picture: 32 points measured,
#   and as much again for the status bar. Nothing is drawn in the last 60 points.
# - Where the window opens is a place on the screen, from its bottom left, and nothing
#   else: "Unfortunately it doesn't appear to be possible to position the window relative
#   to the top left or relative to the centre of the user's screen" (dmgbuild's settings,
#   `window_rect`). No one place is the middle of every screen. The one chosen is as far
#   from the middle of the smallest screen a Mac is sold with as from the middle of the
#   largest: 1470 by 956 points, and 2560 by 1440.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

fail() { echo "build-mac-dmg: $1" >&2; exit 1; }

window=""
photograph=""
while [ $# -gt 0 ]; do
  case "$1" in
    --window) [ $# -ge 2 ] || fail "--window takes the image's name"; window="$2"; shift ;;
    --photograph) [ $# -ge 2 ] || fail "--photograph takes where the picture goes"; photograph="$2"; shift ;;
    *) fail "unknown argument $1" ;;
  esac
  shift
done
[ -z "$photograph" ] || [ -n "$window" ] || fail "--photograph is for an image of the window alone: add --window <name>"

identity="${ALUMIA_SIGN_IDENTITY:-}"
profile="${ALUMIA_NOTARY_PROFILE:-}"
keychain="${ALUMIA_NOTARY_KEYCHAIN:-}"
if [ -z "$window" ]; then
  [ -n "$identity" ] && [ "$identity" != "-" ] \
    || fail "set ALUMIA_SIGN_IDENTITY to a Developer ID Application identity: an image signed ad hoc installs nowhere"
  [ -n "$profile" ] || fail "set ALUMIA_NOTARY_PROFILE to a profile stored with \`xcrun notarytool store-credentials\`"
fi

version="$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -1)"
resources="packaging/macos"
out="dist/mac"
app="$out/Alumia.app"
if [ -n "$window" ]; then
  volume="$window"
  mkdir -p tmp/mac-window
  dmg="tmp/mac-window/$window.dmg"
else
  volume="Alumia"
  dmg="$out/Alumia-$version.dmg"
fi

# The window, in points, after the approved mockup (`.am-dmgbody`): its content, the title
# bar over it, the two icons and where their middles are, how far down the sentence's
# middle is, and where the window opens, from the screen's bottom left. Said once, here:
# the drawing, the window's record and the reading back all take these.
width=560
height=280
bar=28
icon=92
row=108
left=154
right=406
words=208
# The window's middle is halfway between the middle of the smallest screen and the middle
# of the largest, each in points, as wide and as high.
x=$((((1470 + 2560) / 2 - width) / 2))
y=$((((956 + 1440) / 2 - height - bar) / 2))
# What the Finder's own bars may cover at the window's foot.
foot=60
[ $((words + 9)) -le $((height - foot)) ] \
  || fail "the sentence ends $((height - words - 9)) points from the window's foot, where the Finder's bars cover $foot"

if [ -z "$window" ]; then
  bash packaging/build-mac-app.sh
elif [ ! -d "$app" ]; then
  ALUMIA_SIGN_IDENTITY="" bash packaging/build-mac-app.sh
fi
[ -d "$app" ] || fail "no $app"

stage="$(mktemp -d)"
mounted=""
clean() {
  [ -n "$mounted" ] && hdiutil detach -quiet "$mounted" 2>/dev/null || true
  rm -rf "$stage"
}
trap clean EXIT

notarize() {  # 1 = a zip or an image, 2 = what it is
  echo ">> notarizing $2 (xcrun notarytool submit --wait)"
  local said
  said="$(xcrun notarytool submit "$1" --keychain-profile "$profile" ${keychain:+--keychain "$keychain"} --wait 2>&1)" \
    || { printf '%s\n' "$said" | tail -6 >&2; fail "the notarization of $2 failed"; }
  grep -q 'status: Accepted' <<<"$said" \
    || { printf '%s\n' "$said" | tail -8 >&2; fail "Apple did not accept $2"; }
}

if [ -z "$window" ]; then
  ditto -c -k --keepParent "$app" "$stage/app.zip"
  notarize "$stage/app.zip" "the app"
  rm -f "$stage/app.zip"
  xcrun stapler staple "$app" >/dev/null 2>&1 || fail "could not staple the app's ticket"
  xcrun stapler validate "$app" >/dev/null 2>&1 || fail "the ticket stapled to the app does not validate"
fi

# The picture behind the window, in the design tokens' colours and with the sentence
# docs/design/words.json has for it. One image is handed to everybody, whatever their
# language, and the Finder writes "Applications" beside the app in every one of them: the
# sentence is the English one. The capsule under each name is the colour of a light window.
{ read -r ground; read -r ink; read -r plate; read -r sentence; } < <(uv run --no-project python - <<'PY'
import json
colour = json.load(open("docs/design/alumia.tokens.json"))["color"]
print(colour["brand"]["glass"]["$value"]["hex"])
print(colour["backdrop"]["lightest"]["$value"]["hex"])
print(colour["mac"]["light"]["window"]["$value"]["hex"])
words = json.load(open("docs/design/words.json", encoding="utf-8"))["words"]
print(words["mac.install.drag"]["en-US"])
PY
)
[ -n "$sentence" ] || fail "the sentence for the window was not read from docs/design/words.json"
draw() {  # 1 = the file, 2 = how dense
  swift "$resources/dmg-background.swift" "$1" "$2" "$width" "$height" "$row" "$left" "$right" "$words" "$ground" "$ink" "$plate" "$sentence"
}
draw "$stage/background.png" 1 || fail "the window's picture could not be drawn"
draw "$stage/background@2x.png" 2 || fail "the window's dense picture could not be drawn"
# Both densities in one file, which is what a display of either takes its own from.
background="$stage/background.tiff"
tiffutil -cathidpicheck "$stage/background.png" "$stage/background@2x.png" -out "$background" >/dev/null 2>&1 \
  || fail "the window's picture could not be put together"

rm -f "$dmg"
# dmgbuild lays the window out by writing the Finder's own record of it, with no Finder
# open: the versions are pinned, since it handles what is about to be signed.
tools=(--with dmgbuild==1.6.7 --with ds_store==1.3.3 --with mac_alias==2.2.3)
# The volume's icon: the system's own disk with the app's icon flat on the middle of it.
swift "$resources/dmg-icon.swift" draw "$app/Contents/Resources/AppIcon.icns" "$stage/disk.icns" \
  || fail "the disk's icon could not be drawn"
uv run --no-project "${tools[@]}" \
  dmgbuild -s "$resources/dmg-settings.py" -D app="$app" -D background="$background" \
  -D volume_icon="$stage/disk.icns" \
  -D width="$width" -D height="$height" -D bar="$bar" -D icon="$icon" -D row="$row" -D left="$left" -D right="$right" \
  -D x="$x" -D y="$y" \
  "$volume" "$dmg" >/dev/null \
  || fail "dmgbuild could not make the image"

mounted="$stage/mounted"
mkdir "$mounted"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mounted" "$dmg" \
  || { mounted=""; fail "the image does not mount"; }
# The first thing found wrong is the one said, once the image is let go of.
wrong=""
amiss() { [ -n "$wrong" ] || wrong="$1"; }
[ -d "$mounted/Alumia.app" ] || amiss "the app is not in the image"
[ -L "$mounted/Applications" ] || amiss "the way to Applications is not in the image"
codesign --verify --strict --deep "$mounted/Alumia.app" 2>/dev/null \
  || amiss "the signature of the app does not verify inside the image"
if [ -z "$window" ]; then
  xcrun stapler validate "$mounted/Alumia.app" >/dev/null 2>&1 \
    || amiss "the app inside the image carries no ticket"
fi
# The volume wears the system's own disk with the app's icon over it, which is what a disk
# image is known by, and not the app's icon alone, which is the app's: there is an icon, it
# is the one drawn above, byte for byte, and the volume is marked as having an icon of its
# own, without which the Finder shows none. dmgbuild sets that mark and does not look
# whether it took.
if [ ! -s "$mounted/.VolumeIcon.icns" ]; then
  amiss "the volume has no icon of its own"
elif ! cmp -s "$mounted/.VolumeIcon.icns" "$stage/disk.icns"; then
  amiss "the volume's icon is not the disk's with the app's over it"
fi
[ "$(GetFileInfo -aC "$mounted" 2>/dev/null)" = "1" ] \
  || amiss "the volume is not marked as having an icon of its own"
# The window as the image has it, read from the Finder's record and from the picture
# themselves, against what was declared above.
cat > "$stage/read-back.py" <<'PY'
import os.path, re, subprocess, sys
from ds_store import DSStore

mounted = sys.argv[1]
width, height, bar, icon, row, left, right, x, y = (int(number) for number in sys.argv[2:])
wrong = []
record = {}
with DSStore.open(f"{mounted}/.DS_Store", "r") as store:
    for entry in store:
        record[(entry.filename, entry.code)] = entry.value
bounds = record.get((".", b"bwsp"), {}).get("WindowBounds", "")
if bounds != f"{{{{{x}, {y}}}, {{{width}, {height + bar}}}}}":
    wrong.append(f"the window is {bounds}, not {width} by {height + bar} at ({x}, {y})")
view = record.get((".", b"icvp"), {})
if view.get("iconSize") != icon or view.get("backgroundType") != 2:
    wrong.append(f"the icons are {view.get('iconSize')} over a ground of type {view.get('backgroundType')}, not {icon} over a picture")
for name, at in (("Alumia.app", left), ("Applications", right)):
    where = tuple(record.get((name, b"Iloc"), ())[:2])
    if where != (at, row):
        wrong.append(f"{name} is at {where}, not at ({at}, {row})")

picture = f"{mounted}/.background.tiff"
dense = []
if not os.path.isfile(picture):
    wrong.append("the image has no picture for its window")
else:
    said = subprocess.run(["tiffutil", "-info", picture], capture_output=True, text=True).stdout
    sizes = re.findall(r"Image Width: (\d+) Image Length: (\d+)", said)
    dots = re.findall(r"Resolution: (\d+)", said)
    dense = [(int(w), int(h), int(d)) for (w, h), d in zip(sizes, dots)]
    if sorted(dots for _, _, dots in dense) != [72, 144]:
        wrong.append(f"the picture has the densities {[dots for _, _, dots in dense]}, not 72 and 144 dots an inch")
for wide, high, dots in dense:
    if (wide * 72 / dots, high * 72 / dots) != (width, height):
        wrong.append(f"a picture of {wide} by {high} at {dots} dots an inch is not {width} by {height} points")

if wrong:
    print("WRONG " + "; ".join(wrong))
else:
    print(f"the window is as declared: {width} by {height + bar} at ({x}, {y}), icons of {icon} at ({left}, {row}) and ({right}, {row}), "
          f"a picture of {width} by {height} points at 72 and 144 dots an inch")
PY
laid="$(uv run --no-project "${tools[@]}" python "$stage/read-back.py" "$mounted" "$width" "$height" "$bar" "$icon" "$row" "$left" "$right" "$x" "$y")" \
  || amiss "the window's record could not be read back"
case "$laid" in
  "the window is as declared"*) ;;
  *) amiss "${laid:-the record of the window could not be read back}" ;;
esac
hdiutil detach -quiet "$mounted" && mounted=""
[ -z "$wrong" ] || fail "$wrong"
echo "build-mac-dmg: $laid"
echo "build-mac-dmg: the volume's icon is the disk's with the app's over it"

if [ -n "$window" ]; then
  echo "build-mac-dmg: $dmg, the window alone: neither signed nor notarized, to be looked at"
  if [ -n "$photograph" ]; then
    # The window as this Mac's Finder draws it. Opened behind every other window, so
    # that nobody's work is taken from under them, and photographed by its own number,
    # whatever stands over it.
    hdiutil attach -quiet "$dmg" || fail "the image does not mount to be photographed"
    mounted="/Volumes/$volume"
    open -g "$mounted"
    number=""
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 1
      number="$(swift "$resources/dmg-window.swift" "$volume" 2>/dev/null || true)"
      [ -z "$number" ] || break
    done
    taken=""
    if [ -n "$number" ]; then
      sleep 1
      screencapture -x -o -l"$number" "$photograph" 2>/dev/null && taken=1
    fi
    hdiutil detach -quiet "$mounted" && mounted=""
    [ -n "$number" ] || fail "the Finder showed no window named $volume"
    [ -n "$taken" ] || fail "the window could not be photographed: this terminal may lack the leave to record the screen"
    echo "build-mac-dmg: $photograph, the window as this Mac's Finder draws it"
  fi
  exit 0
fi

codesign --force --timestamp --sign "$identity" "$dmg" >/dev/null 2>&1 || fail "could not sign the image as $identity"
notarize "$dmg" "the image"
xcrun stapler staple "$dmg" >/dev/null 2>&1 || fail "could not staple the image's ticket"
xcrun stapler validate "$dmg" >/dev/null 2>&1 || fail "the ticket stapled to the image does not validate"

# The image's own file wears the volume's icon too, on this Mac: a file's icon is kept beside
# its content and does not travel in a download, as the volume's does. It is put on after the
# ticket, and the ticket and Gatekeeper are both asked with it on.
swift "$resources/dmg-icon.swift" wear "$dmg" "$stage/disk.icns" \
  || fail "could not put the volume's icon on the image's file"
[ "$(GetFileInfo -aC "$dmg" 2>/dev/null)" = "1" ] || fail "the image's file is not marked as having an icon of its own"
xcrun stapler validate "$dmg" >/dev/null 2>&1 || fail "the image's ticket does not validate with the icon on its file"

verdict="$(spctl -a -t open --context context:primary-signature -v "$dmg" 2>&1)"
grep -q 'source=Notarized Developer ID' <<<"$verdict" \
  || { printf '%s\n' "$verdict" >&2; fail "this Mac's Gatekeeper does not take the image as notarized"; }

echo "build-mac-dmg: $dmg ($(du -sh "$dmg" | cut -f1)), $verdict"
echo "build-mac-dmg: the image file wears the same icon"
