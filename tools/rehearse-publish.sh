#!/usr/bin/env bash
# Rehearse the publication of a version from end to end, with nothing reaching GitHub.
#
#   tools/rehearse-publish.sh <version>
#
# tools/publish-public.sh, as it is on disk, publishes HEAD as <version> here: from a clone
# of this repository whose origin is a bare repository standing for aleonnet/alumia-app, to a
# bare repository standing for aleonnet/alumia as the fork is before a version (its main at a
# commit of this repository's history), both under tmp/rehearsal/remotes/aleonnet/,
# with a `gh` first on the PATH that writes down what it is asked and creates nothing. The
# script rehearsed is a copy with two lines changed, the two addresses of the public
# repository, and the rehearsal checks that those two lines and no other differ. The disk
# image is the real one, and this Mac's Gatekeeper is asked about it as in a publication.
#
# Fifteen steps, each with the exit code and the words it has to see: what the publication
# refuses before it writes (a public main that is somebody else's history, and a push the
# public repository takes half of, among them), a first publication whose release fails and
# is taken up again, a version published twice, what --check says of the public repository
# as published and as written by hand, a second version on top of the first, and the first
# asked for again after it. A step that does not go as written ends the rehearsal with
# `rehearse: FAILED <n> <its name>` and what the script said.
#
# Not rehearsed, because nothing here stands for them: ssh and the publication key's
# acceptance by GitHub, the public repository's rules, and the real `gh` creating the release
# (docs/release.md has the acts that prove each, once). The second version is this one with
# its last number raised, made here for the rehearsal alone, with the same disk image under
# its name.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

version="${1:?rehearse: the version to rehearse, as in 0.1.3}"
[ $# -eq 1 ] || { echo "rehearse: the version alone" >&2; exit 1; }
tag="v$version"
dmg="dist/mac/Alumia-$version.dmg"
ROOT="$(pwd)"
STAGE="$ROOT/tmp/rehearsal"
PRIVATE="$STAGE/remotes/aleonnet/alumia-app.git"
PUBLIC="$STAGE/remotes/aleonnet/alumia.git"
CLONE="$STAGE/work"
SCRIPT="$STAGE/publish-public.sh"
KEY="$STAGE/publication-key"
OUT="$STAGE/out"

[ -f "$dmg" ] || { echo "rehearse: there is no $dmg: the rehearsal attaches the real disk image" >&2; exit 1; }
head="$(git rev-parse HEAD)"
echo "rehearse: publishing HEAD (${head:0:12}) as $version, with tools/publish-public.sh as it is on disk; nothing here reaches GitHub"

# -- the stage --------------------------------------------------------------------------

rm -rf "$STAGE"
mkdir -p "$STAGE/remotes/aleonnet" "$STAGE/bin"
git init -q --bare "$PRIVATE"
git init -q --bare "$PUBLIC"
git clone -q "$ROOT" "$CLONE"
git -C "$CLONE" checkout -q --detach "$head"
git -C "$CLONE" remote set-url origin "$PRIVATE"
git -C "$CLONE" push -q origin "$head:refs/heads/main"
# The public stand-in starts as the fork does: a main with history, at a commit behind HEAD.
base="$(git rev-parse "$head~1")"
git -C "$CLONE" push -q "$PUBLIC" "$base:refs/heads/main"
git -C "$CLONE" tag -d "$tag" >/dev/null 2>&1 || true
mkdir -p "$CLONE/dist/mac"
cp -c "$dmg" "$CLONE/$dmg" 2>/dev/null || cp "$dmg" "$CLONE/$dmg"
echo "the rehearsal's stand-in for the publication key: it opens nothing" >"$KEY"

# The script rehearsed: the one on disk, with the public repository's two addresses changed.
for constant in 'PUBLIC_READ="https://github.com/aleonnet/alumia.git"' 'PUBLIC_PUSH="git@github.com:aleonnet/alumia.git"'; do
  [ "$(grep -c -x -F -- "$constant" tools/publish-public.sh)" = 1 ] \
    || { echo "rehearse: tools/publish-public.sh does not have the line $constant once" >&2; exit 1; }
done
sed -e "s|^PUBLIC_READ=.*|PUBLIC_READ=\"$PUBLIC\"|" -e "s|^PUBLIC_PUSH=.*|PUBLIC_PUSH=\"$PUBLIC\"|" tools/publish-public.sh >"$SCRIPT"
changed="$(diff tools/publish-public.sh "$SCRIPT" | grep -c '^>' || true)"
[ "$changed" = 2 ] || { echo "rehearse: the copy rehearsed differs from tools/publish-public.sh in $changed lines, not in 2" >&2; exit 1; }

# The stand-in for gh: it writes down what it is asked, and answers from the stage's files.
cat >"$STAGE/bin/gh" <<'GH'
#!/usr/bin/env bash
stage="$(cd "$(dirname "$0")/.." && pwd)"
printf '%s\n' "$*" >>"$stage/gh.log"
case "${1:-} ${2:-}" in
  "release view") [ -f "$stage/released-$3" ] ;;
  "release create")
    if [ -f "$stage/fail-create" ]; then
      rm "$stage/fail-create"
      echo "gh: the rehearsal was told to fail this once" >&2
      exit 1
    fi
    last=""
    released="$3"
    while [ $# -gt 0 ]; do
      if [ "$1" = --notes-file ]; then cp "$2" "$stage/notes.md"; fi
      last="$1"
      shift
    done
    [ -f "$last" ] || { echo "gh: no file to attach at $last" >&2; exit 1; }
    shasum -a 256 "$last" | cut -d' ' -f1 >"$stage/attached"
    touch "$stage/released-$released"
    ;;
  *) echo "gh: the rehearsal has no answer for: $*" >&2; exit 1 ;;
esac
GH
chmod +x "$STAGE/bin/gh"

# -- the steps --------------------------------------------------------------------------

step=0
key="$KEY"

# The script, in the clone, with the stand-ins: the stand-in gh, and the key named. What it
# says goes to $OUT.
run() {
  (cd "$CLONE" && PATH="$STAGE/bin:$PATH" ALUMIA_PUBLISH_KEY="$key" bash "$SCRIPT" "$@") >"$OUT" 2>&1
}

ok() {
  step=$((step + 1))
  echo "rehearse: ok   $step $1"
}

failed() {  # 1 = the step's name; 2 = what was not as written
  echo "rehearse: FAILED $((step + 1)) $1: $2" >&2
  [ ! -f "$OUT" ] || sed 's/^/    /' "$OUT" >&2
  exit 1
}

says() { grep -q -F -- "$1" "$OUT"; }

# A run that has to be refused, saying these words.
refused() {  # 1 = the step's name; 2 = the words; the rest = the script's arguments
  local name="$1" words="$2"
  shift 2
  if run "$@"; then failed "$name" "it was not refused"; fi
  says "$words" || failed "$name" "it did not say: $words"
}

make_tag() {  # 1 = the day the tag is made on; 2 = what the tag says, when not the usual
  GIT_COMMITTER_DATE="$1T12:00:00" git -C "$CLONE" tag -f -a "$tag" -m "${2:-alumia $version}" >/dev/null
}

# The tag as it has to be, on the private stand-in too.
push_tag() {
  make_tag "$dated"
  git -C "$CLONE" push -q -f origin "refs/tags/$tag"
}

# The clone and the private stand-in back at HEAD, after a refusal that needed a commit.
back_to_head() {
  git -C "$CLONE" checkout -q -f --detach "$head"
  git -C "$PRIVATE" update-ref refs/heads/main "$head"
  push_tag
}

# A commit of the clone with one line of a file changed, on the private main and tagged.
changed() {  # 1 = the file; 2 = the line as it is; 3 = the line as it is to be
  [ "$(grep -c -x -F -- "$2" "$CLONE/$1")" = 1 ] || { echo "rehearse: $1 does not have the line '$2' once" >&2; exit 1; }
  awk -v old="$2" -v new="$3" '$0 == old { print new; next } { print }' "$CLONE/$1" >"$STAGE/changed"
  cp "$STAGE/changed" "$CLONE/$1"
  git -C "$CLONE" commit -q -am "the rehearsal: $1 changed"
  git -C "$CLONE" push -q origin HEAD:refs/heads/main
  push_tag
}

public_refs() { git -C "$PUBLIC" for-each-ref --format='%(refname) %(objectname)'; }

dated="$(sed -n -E "s/^## ${version//./[.]} - ([0-9]{4}-[0-9]{2}-[0-9]{2})\$/\\1/p" "$CLONE/CHANGELOG.md")"
[ -n "$dated" ] || { echo "rehearse: CHANGELOG.md at HEAD has no section '## $version - <date>'" >&2; exit 1; }

name="a tag that is not on the private repository is refused"
make_tag "$dated"
refused "$name" "the tag $tag is not pushed to aleonnet/alumia-app" "$version"
ok "$name"

name="a tag made on another day than the changelog says is refused"
make_tag 2000-01-01
git -C "$CLONE" push -q -f origin "refs/tags/$tag"
refused "$name" "CHANGELOG.md dates $version $dated, and the tag $tag was made on 2000-01-01" "$version"
make_tag "$dated"
git -C "$CLONE" push -q -f origin "refs/tags/$tag"
ok "$name"

name="a tracked change that is not committed is refused"
echo >>"$CLONE/README.md"
refused "$name" "commit or stash the tracked changes first" "$version"
git -C "$CLONE" checkout -q -- README.md
ok "$name"

name="a publication with no publication key is refused"
key="$STAGE/no-such-key"
refused "$name" "there is no publication key at $STAGE/no-such-key" "$version"
key="$KEY"
ok "$name"

name="nothing was written to the public repository by any refusal"
# The other refusals, each by its words. A clone of something else:
git -C "$CLONE" remote set-url origin "$STAGE/remotes/aleonnet/another.git"
refused "$name" "this is not a clone of aleonnet/alumia-app" "$version"
git -C "$CLONE" remote set-url origin "$PRIVATE"
# No tag, and a tag that is a name alone:
git -C "$CLONE" tag -d "$tag" >/dev/null
refused "$name" "the tag $tag is not in this repository" "$version"
git -C "$CLONE" tag "$tag"
refused "$name" "the tag $tag is not annotated" "$version"
# A tag that is not the one the private repository has:
make_tag "$dated" "another tag by the same name"
refused "$name" "the tag $tag in aleonnet/alumia-app is not the one here" "$version"
# A tag on a commit the private main does not have:
git -C "$CLONE" commit -q --allow-empty -m "the rehearsal: a commit that is on no main"
push_tag
refused "$name" "the tag $tag is not on the main of aleonnet/alumia-app" "$version"
back_to_head
# No disk image, and one Gatekeeper does not take:
mv "$CLONE/$dmg" "$STAGE/image-aside"
refused "$name" "there is no $dmg" "$version"
echo "not a disk image" >"$CLONE/$dmg"
refused "$name" "this Mac's Gatekeeper does not take $dmg as notarized" "$version"
mv "$STAGE/image-aside" "$CLONE/$dmg"
# A changelog with no section for the version, and one whose other language gives another day:
changed CHANGELOG.md "## $version - $dated" "## 0.0.0 - $dated"
refused "$name" "CHANGELOG.md at $tag has no section '## $version - <date>'" "$version"
back_to_head
changed CHANGELOG.pt-BR.md "## $version - $dated" "## $version - 2000-01-02"
refused "$name" "CHANGELOG.pt-BR.md dates $version 2000-01-02, and the tag $tag was made on $dated" "$version"
back_to_head
# A public main that is somebody else's history, neither a version nor a commit of this
# repository:
foreign="$(git -C "$PUBLIC" commit-tree -m "somebody else's" "$(git -C "$PUBLIC" mktree </dev/null)")"
git -C "$PUBLIC" update-ref refs/heads/main "$foreign"
refused "$name" "the public repository's main is neither a version's commit nor one of this repository's history" "$version"
git -C "$PUBLIC" update-ref refs/heads/main "$base"
# And the public repository's own: a push it takes half of, main and not the tag. The whole
# push has to fail, and main to stay where it was. (The hook's own $1 is written as it is.)
# shellcheck disable=SC2016
printf '#!/bin/sh\ncase "$1" in refs/tags/*) echo "the rehearsal: this repository takes no tag for now" >&2; exit 1 ;; esac\n' >"$PUBLIC/hooks/update"
chmod +x "$PUBLIC/hooks/update"
refused "$name" "the push to aleonnet/alumia failed" "$version"
rm "$PUBLIC/hooks/update"
[ "$(public_refs)" = "refs/heads/main $base" ] || failed "$name" "the public stand-in has: $(public_refs | tr '\n' ' ')"
[ ! -f "$STAGE/gh.log" ] || failed "$name" "gh was asked: $(cat "$STAGE/gh.log")"
ok "$name"

name="the first publication writes main and the tag, and stops when the release fails"
touch "$STAGE/fail-create"
refused "$name" "the release $tag could not be created on aleonnet/alumia; main and the tag are pushed" "$version"
ok "$name"

name="the public repository keeps its history and holds one commit, \"alumia $version\", on top of it"
[ "$(git -C "$PUBLIC" for-each-ref --format='%(refname)' refs/heads)" = refs/heads/main ] \
  || failed "$name" "its branches are: $(git -C "$PUBLIC" for-each-ref --format='%(refname)' refs/heads | tr '\n' ' ')"
[ "$(git -C "$PUBLIC" rev-parse 'refs/heads/main^')" = "$base" ] || failed "$name" "main's commit is not on top of the history that was there"
[ "$(git -C "$PUBLIC" rev-list --count "$base..refs/heads/main")" = 1 ] || failed "$name" "main has $(git -C "$PUBLIC" rev-list --count "$base..refs/heads/main") commits on top of its history"
[ "$(git -C "$PUBLIC" log -1 --format=%s refs/heads/main)" = "alumia $version" ] || failed "$name" "the commit is: $(git -C "$PUBLIC" log -1 --format=%s refs/heads/main)"
git -C "$PUBLIC" log -1 --format=%b refs/heads/main | grep -q -F "Photograph of aleonnet/alumia-app at ${head:0:12} ($tag)" \
  || failed "$name" "the commit does not name ${head:0:12}"
[ "$(git -C "$PUBLIC" rev-parse "refs/tags/$tag^{commit}")" = "$(git -C "$PUBLIC" rev-parse refs/heads/main)" ] || failed "$name" "the tag is not on main's commit"
left="$(git -C "$PUBLIC" ls-tree -r --name-only refs/heads/main | grep -E '^(docs/(plans|research|comparisons|mockups)|tmp|ci)/|^\.devtools\.conf$' | head -3 || true)"
[ -z "$left" ] || failed "$name" "what leaves is there: $left"
git -C "$PUBLIC" show refs/heads/main:AGENTS.md | grep -q -F "do not edit here" || failed "$name" "AGENTS.md is not the public repository's"
ok "$name"

name="the public clone pushes with the publication key alone"
wanted="ssh -F /dev/null -o IdentitiesOnly=yes -o IdentityAgent=none -i '$KEY'"
had="$(git -C "$CLONE/tmp/publish/public" config --get core.sshCommand || true)"
[ "$had" = "$wanted" ] || failed "$name" "its ssh command is: ${had:-none}"
ok "$name"

name="the same command creates the release alone"
# With what a run before left in the public clone, a file git does not track and a change to
# one it does: the clone is made what the public repository has before it is compared.
mkdir -p "$CLONE/tmp/publish/public/tools/__pycache__"
echo "left by a run" >"$CLONE/tmp/publish/public/tools/__pycache__/left.pyc"
echo "left by a run" >>"$CLONE/tmp/publish/public/README.md"
run "$version" || failed "$name" "it failed"
says "aleonnet/alumia already holds $version with no release: creating the release" || failed "$name" "it did not take the publication up again"
says "published $version: https://github.com/aleonnet/alumia/releases/tag/$tag" || failed "$name" "it did not say it published"
[ "$(git -C "$PUBLIC" rev-list --count "$base..refs/heads/main")" = 1 ] || failed "$name" "main has $(git -C "$PUBLIC" rev-list --count "$base..refs/heads/main") commits on top of its history"
ok "$name"

name="the release got the disk image and notes with no relative link"
asked="$(grep '^release create' "$STAGE/gh.log" | tail -1)"
[ "$asked" = "release create $tag -R aleonnet/alumia --verify-tag --title $tag --notes-file tmp/publish/notes-$version.md $dmg" ] || failed "$name" "gh was asked: $asked"
[ "$(cat "$STAGE/attached")" = "$(shasum -a 256 "$dmg" | cut -d' ' -f1)" ] || failed "$name" "what was attached is not $dmg"
grep -q -F "SHA-256 \`$(cat "$STAGE/attached")\`" "$STAGE/notes.md" || failed "$name" "the notes do not give the image's SHA-256"
relative="$(grep -o -E '\]\([^)]*' "$STAGE/notes.md" | grep -v -E '^\]\([A-Za-z][A-Za-z0-9+.-]*:' | head -3 || true)"
[ -z "$relative" ] || failed "$name" "the notes hold a relative link: $relative"
in_changelog="$(awk -v v="$version" '$0 ~ "^## " v "( |$)" {on = 1; next} on && /^## / {exit} on' "$CLONE/CHANGELOG.md" \
  | grep -o -E '\]\([^)]*' | grep -c -v -E '^\]\([A-Za-z][A-Za-z0-9+.-]*:' || true)"
in_notes="$(grep -o -F "](https://github.com/aleonnet/alumia/blob/$tag/" "$STAGE/notes.md" | wc -l | tr -d ' ')"
[ "$in_notes" = "$((in_changelog + 1))" ] || failed "$name" "the changelog's section has $in_changelog relative links and the notes $in_notes addresses at $tag, the Portuguese changelog's among them"
ok "$name"

name="a third run is refused as already published"
refused "$name" "the version $version is already published" "$version"
ok "$name"

name="--check says the public repository is the photograph"
run --check || failed "$name" "it failed"
says "the public repository is the photograph of $version" || failed "$name" "it did not say so"
ok "$name"

name="a commit made by hand in the public repository is found by --check"
git clone -q "$PUBLIC" "$STAGE/hand" 2>/dev/null
git -C "$STAGE/hand" checkout -q main
echo "written by hand" >"$STAGE/hand/BY-HAND.md"
git -C "$STAGE/hand" add BY-HAND.md
git -C "$STAGE/hand" commit -q -m "alumia $version"
git -C "$STAGE/hand" push -q origin main
refused "$name" "the public repository is not the photograph of $version" --check
ok "$name"

# The public stand-in as the publication left it, for the second version.
published="$(git -C "$PUBLIC" rev-parse "refs/tags/$tag^{commit}")"
git -C "$PUBLIC" update-ref refs/heads/main "$published"

name="a second version is written on top of the first"
next="${version%.*}.$((${version##*.} + 1))"
[ "$(grep -c -x -F -- "version = \"$version\"" "$CLONE/Cargo.toml")" = 1 ] || failed "$name" "Cargo.toml does not say the version on one line"
awk -v old="version = \"$version\"" -v new="version = \"$next\"" '$0 == old { print new; next } { print }' "$CLONE/Cargo.toml" >"$STAGE/changed"
cp "$STAGE/changed" "$CLONE/Cargo.toml"
for file in CHANGELOG.md CHANGELOG.pt-BR.md; do
  awk -v at="## $version - $dated" -v section="## $next - $dated" '$0 == at { print section; print ""; print "The rehearsal."; print "" } { print }' "$CLONE/$file" >"$STAGE/changed"
  cp "$STAGE/changed" "$CLONE/$file"
done
git -C "$CLONE" commit -q -am "the rehearsal: $next"
git -C "$CLONE" push -q origin HEAD:refs/heads/main
GIT_COMMITTER_DATE="${dated}T12:00:00" git -C "$CLONE" tag -a "v$next" -m "alumia $next"
git -C "$CLONE" push -q origin "refs/tags/v$next"
cp -c "$dmg" "$CLONE/dist/mac/Alumia-$next.dmg" 2>/dev/null || cp "$dmg" "$CLONE/dist/mac/Alumia-$next.dmg"
run "$next" || failed "$name" "it failed"
says "the public repository is the photograph of $version" || failed "$name" "it did not find the first version there"
says "published $next: https://github.com/aleonnet/alumia/releases/tag/v$next" || failed "$name" "it did not say it published"
[ "$(git -C "$PUBLIC" log -1 --format=%s refs/heads/main)" = "alumia $next" ] || failed "$name" "the commit is: $(git -C "$PUBLIC" log -1 --format=%s refs/heads/main)"
[ "$(git -C "$PUBLIC" rev-parse 'refs/heads/main^')" = "$published" ] || failed "$name" "it is not on top of the first version's commit"
[ "$(git -C "$PUBLIC" rev-parse "refs/tags/$tag^{commit}")" = "$published" ] || failed "$name" "the first version's tag moved"
[ "$(git -C "$PUBLIC" rev-parse "refs/tags/v$next^{commit}")" = "$(git -C "$PUBLIC" rev-parse refs/heads/main)" ] || failed "$name" "the second version's tag is not on its commit"
run --check || failed "$name" "--check failed"
says "the public repository is the photograph of $next" || failed "$name" "--check did not say so"
ok "$name"

name="a version that is not newer than the published one is refused"
second="$(public_refs)"
git -C "$CLONE" checkout -q -f --detach "$head"
refused "$name" "the public repository is at $next, and $version is not a newer version" "$version"
[ "$(public_refs)" = "$second" ] || failed "$name" "the public stand-in changed"
ok "$name"

[ "$step" = 15 ] || { echo "rehearse: $step steps ran, not 15" >&2; exit 1; }
echo "rehearse: $step of 15 steps as expected"
