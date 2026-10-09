#!/usr/bin/env bash
# Publish one version of alumia to the public repository, aleonnet/alumia, as one commit.
#
#   tools/publish-public.sh <version>
#       From the tag v<version> on this repository's main, already pushed: export the tag,
#       leave out what tools/public-paths.txt names, scan for secrets and addresses, run the
#       repository's own checks on what is left, write it on top of the public repository's
#       main as the commit "alumia <version>", push it with its tag, and create the release with
#       the Mac app's disk image attached. Every condition out of place is refused with one
#       sentence, before anything is written.
#   tools/publish-public.sh --check
#       Whether the public repository is the photograph of the version its last commit
#       names, and nothing else.
#   tools/publish-public.sh --export <dir> [--worktree] [--version <v>]
#       The export alone, to <dir>: from HEAD, or from the working tree with --worktree, with
#       the filter, the scan and the checks, and the version read against Cargo.toml when
#       given. Nothing is written to git or to GitHub: it is the gate, and what the proofs
#       plant defects against.
#
# This is the only thing that writes to the public repository. Its clone lives in
# tmp/publish/public and reaches GitHub by https to read and by ssh to push, with the
# publication key and no other identity: ~/.ssh/alumia-publish, a deploy key of the public
# repository alone (ALUMIA_PUBLISH_KEY names another file). The public repository's rules let
# nothing but that key create, move or delete a branch or a tag, so a push from anywhere else
# is refused there, and the private repository's own remote `public` has its push disabled
# besides. The whole of a publication is rehearsed, with nothing reaching GitHub, by
# tools/rehearse-publish.sh. The lists of what leaves
# and of what the scan may let through are read from the version being exported, so --check
# judges an older version by that version's rules. The public repository is the fork of the
# original project, andrewtheguy/remotex, under the product's name: its main carries the
# original's history as this repository had it when it left, and each version is one commit
# on top. It takes nothing from the original by itself: the original's work reaches this
# repository alone (tools/sync-original.sh), and reaches the public one as a version.
set -euo pipefail

# The ssh a push uses is the one the public clone is configured with below, and an ssh named
# in the environment would be used in its place.
unset GIT_SSH_COMMAND GIT_SSH

cd "$(git rev-parse --show-toplevel)"

PUBLIC_REPO="aleonnet/alumia"
PUBLIC_READ="https://github.com/aleonnet/alumia.git"
PUBLIC_PUSH="git@github.com:aleonnet/alumia.git"
PRIVATE_REPO='aleonnet/alumia-app'
PUBLISH_KEY="${ALUMIA_PUBLISH_KEY:-$HOME/.ssh/alumia-publish}"
PATHS_FILE="tools/public-paths.txt"
ALLOWED_FILE="tools/public-allowed.txt"
WORK="tmp/publish"
LYCHEE_ROOTS=(docs/ README.md README.pt-BR.md README_DEV.md README_DEV.pt-BR.md CHANGELOG.md CHANGELOG.pt-BR.md)

fail() { echo "publish: $1" >&2; exit 1; }
say() { echo "publish: $1"; }

# -- the export -------------------------------------------------------------------------

export_tree() {  # 1 = a ref, or WORKTREE; 2 = the directory to export into
  rm -rf "${2:?}"
  mkdir -p "$2"
  if [ "$1" = WORKTREE ]; then
    # The working tree as it stands: what is tracked and what is new and not ignored, each
    # file as it is on disk (a file deleted on disk is not there to export, and is skipped
    # without failing the loop, whichever one it is).
    git ls-files -z --cached --others --exclude-standard \
      | while IFS= read -r -d '' path; do if [ -e "$path" ]; then printf '%s\0' "$path"; fi; done \
      | tar --null -T - -cf - | tar -xf - -C "$2"
  else
    git archive --format=tar "$1" | tar -xf - -C "$2"
  fi
}

# What leaves, read from the exported tree itself; the comments and blank lines taken out.
excluded_paths() {  # 1 = the exported tree
  sed -e 's/#.*$//' -e 's/[[:space:]]*$//' -e '/^$/d' "$1/$PATHS_FILE"
}

filter_tree() {  # 1 = the exported tree
  local tree="$1" path
  [ -f "$tree/$PATHS_FILE" ] || fail "$PATHS_FILE is not in the exported tree"
  while IFS= read -r path; do
    case "$path" in
      /*|*..*|"") fail "$PATHS_FILE names a path that is not relative and plain: '$path'" ;;
    esac
    rm -rf "${tree:?}/${path:?}"
  done < <(excluded_paths "$tree")
  cat > "$tree/AGENTS.md" <<'EOF'
# Repository instructions

This repository is written by `tools/publish-public.sh` of aleonnet/alumia-app, one commit a version, and read by nobody who changes the product: do not edit here.
EOF
  # The documents that stay: the map loses the sections of what left, and a link into what
  # left becomes its text. The paths go as arguments: the script itself takes the stdin.
  # shellcheck disable=SC2046
  uv run --no-project python - "$tree" $(excluded_paths "$tree") <<'PY'
import pathlib
import re
import sys

tree = pathlib.Path(sys.argv[1])
excluded = sys.argv[2:]
under_docs = [pathlib.PurePosixPath(path).name for path in excluded if path.startswith("docs/")]
NAMES = {"plans": "os planos", "research": "as pesquisas", "mockups": "as pranchas", "comparisons": "as comparações"}

def inside_excluded(target, from_dir):
    target = re.sub(r"[#?].*$", "", target)
    if not target or "://" in target or target.startswith(("mailto:", "/")):
        return False
    resolved = pathlib.PurePosixPath(*(from_dir / target).parts)
    parts = []
    for part in resolved.parts:
        if part == "..":
            if parts:
                parts.pop()
        elif part != ".":
            parts.append(part)
    joined = "/".join(parts)
    return any(joined == path or joined.startswith(path + "/") for path in excluded)

readme = tree / "docs/README.md"
if readme.is_file():
    kept, dropping = [], False
    for line in readme.read_text(encoding="utf-8").split("\n"):
        if line.startswith("## "):
            dropping = any(f"`{name}/`" in line for name in under_docs)
        if not dropping:
            kept.append(line)
    text = "\n".join(kept)
    what = ", ".join(NAMES.get(name, f"`docs/{name}`") for name in under_docs)
    note = (
        f"\n\nEsta é a cópia pública do repositório, uma foto por versão: {what} ficam no "
        "repositório de trabalho, `aleonnet/alumia-app`, e não estão aqui."
    )
    text = re.sub(r"^(# [^\n]*)", lambda found: found.group(1) + note, text, count=1, flags=re.M)
    readme.write_text(text, encoding="utf-8")

link = re.compile(r"\[([^\]\n]*)\]\(([^)\s]+)\)")
changed = 0
for path in sorted(tree.rglob("*.md")):
    from_dir = path.parent.relative_to(tree)
    text = path.read_text(encoding="utf-8")
    new = link.sub(lambda found: found.group(1) if inside_excluded(found.group(2), from_dir) else found.group(0), text)
    if new != text:
        path.write_text(new, encoding="utf-8")
        changed += 1
print(f"publish: {len(excluded)} paths left out; links into them became text in {changed} documents")
PY
}

# -- the scan ---------------------------------------------------------------------------

scan_tree() {  # 1 = the exported tree
  [ -f "$1/$ALLOWED_FILE" ] || fail "$ALLOWED_FILE is not in the exported tree"
  uv run --no-project python - "$1" "$ALLOWED_FILE" <<'PY'
import pathlib
import re
import sys

tree, allowed_file = pathlib.Path(sys.argv[1]), sys.argv[2]
allowed = []
for line in (tree / allowed_file).read_text(encoding="utf-8").splitlines():
    if line.strip() and not line.startswith("#"):
        path, literal, why = line.split("\t", 2)
        if not why.strip():
            sys.exit(f"publish: {allowed_file} allows {literal!r} in {path} and does not say why")
        allowed.append((path, literal))

SECRET = re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})")
KEY = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY")
HASH = re.compile(r"\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}")
IPV4 = re.compile(r"(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w.])")
TAILNET = re.compile(r"\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.ts\.net\b")
BINARY = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns", ".ttf", ".otf", ".woff", ".woff2", ".dmg", ".zip", ".gz", ".lock", ".wasm", ".pdf"}

def address(octets):
    """What an IPv4 address in the tree says of somebody. A public address names a machine
    on the internet, and is refused. The private ranges (RFC 1918), the shared one carriers
    and Tailscale use (100.64/10), loopback, the documentation ranges (RFC 5737), the
    unspecified, broadcast and multicast ones name nobody: every home network has them,
    and the tree has them as the examples of its tests and of alumia.example.toml (60
    places, measured on 2026-10-09). An address whose first number has one digit is left
    alone too: a section number of a standard looks the same (X.691 10.9.3.7)."""
    a, b, c, d = (int(part) for part in octets)
    if any(part > 255 for part in (a, b, c, d)) or a < 10:
        return None
    if a in (10, 127) or (a == 172 and 16 <= b <= 31) or (a == 192 and b in (0, 168) and (b == 168 or c == 2)):
        return None
    if (a == 100 and 64 <= b <= 127) or (a, b, c) in ((198, 51, 100), (203, 0, 113)) or a >= 224:
        return None
    return "a network address"

found = []
for path in sorted(tree.rglob("*")):
    if not path.is_file() or path.suffix.lower() in BINARY or ".git" in path.parts:
        continue
    if path.relative_to(tree).as_posix() == allowed_file:
        continue  # the list of exceptions holds the literals it excepts
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        continue
    where = path.relative_to(tree).as_posix()
    for number, line in enumerate(lines, 1):
        hits = []
        if SECRET.search(line):
            hits.append("a secret-looking string")
        if KEY.search(line):
            hits.append("a private key")
        if HASH.search(line):
            hits.append("a password hash")
        for octets in IPV4.findall(line):
            kind = address(octets)
            if kind and kind not in hits:
                hits.append(kind)
        for name in TAILNET.findall(line):
            if not name.endswith("example.ts.net"):
                hits.append("a Tailscale name")
                break
        if hits and any(where == path_ and literal in line for path_, literal in allowed):
            continue
        for hit in hits:
            found.append(f"publish: {hit} in {where}:{number}")
for sentence in found:
    print(sentence, file=sys.stderr)
if found:
    sys.exit(1)
print("publish: the scan found nothing that may not be public")
PY
}

# -- the checks -------------------------------------------------------------------------

check_tree() {  # 1 = the exported tree
  local tree="$1" command before
  # What is published is what was exported: a check that leaves a file of its own in the
  # tree is refused, and Python is told to leave none.
  before="$(cd "$tree" && find . | LC_ALL=C sort | shasum | cut -d' ' -f1)"
  for command in \
    "uv run --no-project python tools/check-design.py" \
    "uv run --no-project python tools/product-words.py --check" \
    "uv run --no-project python tools/product-glyphs.py --check" \
    "uv run --no-project python tools/app-words.py --check" \
    "uv run --no-project python tools/check-docs.py" \
    "uv run --no-project python tools/site/check.py"; do
    (cd "$tree" && PYTHONDONTWRITEBYTECODE=1 $command >/dev/null) || fail "the exported tree fails: $command"
  done
  local roots=()
  for path in "${LYCHEE_ROOTS[@]}"; do roots+=("$tree/$path"); done
  if ! lychee --offline --no-progress --root-dir "$(cd "$tree" && pwd)" "${roots[@]}" >"$WORK/lychee.log" 2>&1; then
    { grep -E '✗|ERROR|Error|not found' "$WORK/lychee.log" || tail -5 "$WORK/lychee.log"; } | head -20 >&2
    fail "a broken link in the export, or lychee did not run (see above)"
  fi
  [ "$(cd "$tree" && find . | LC_ALL=C sort | shasum | cut -d' ' -f1)" = "$before" ] \
    || fail "a check left a file of its own in the exported tree, and nothing but what was exported may be published"
  say "the exported tree passes its own checks"
}

version_of() {  # 1 = the exported tree
  uv run --no-project python - "$1" <<'PY'
import sys, tomllib
with open(sys.argv[1] + "/Cargo.toml", "rb") as f:
    print(tomllib.load(f)["package"]["version"])
PY
}

check_version() {  # 1 = the exported tree; 2 = the version it has to be
  local said
  said="$(version_of "$1")"
  [ "$said" = "$2" ] || fail "Cargo.toml says $said, not $2"
}

# -- the public clone -------------------------------------------------------------------

public_clone() {
  local clone="$WORK/public" url
  mkdir -p "$WORK"
  if [ -d "$clone/.git" ]; then
    url="$(git -C "$clone" remote get-url origin)"
    [ "$url" = "$PUBLIC_READ" ] || [ "$url" = "$PUBLIC_PUSH" ] \
      || fail "$clone is a clone of $url, not of $PUBLIC_REPO: move it away"
    git -C "$clone" fetch -q origin
  else
    git clone -q "$PUBLIC_READ" "$clone" 2>/dev/null || fail "$PUBLIC_REPO could not be cloned: does it exist, and is this machine online?"
  fi
  git -C "$clone" remote set-url --push origin "$PUBLIC_PUSH"
  # The push goes with the publication key and with nothing else this machine has: no file
  # of ssh's configuration, no agent, no other identity.
  git -C "$clone" config core.sshCommand "ssh -F /dev/null -o IdentitiesOnly=yes -o IdentityAgent=none -i '$PUBLISH_KEY'"
  git -C "$clone" rev-parse -q --verify origin/main >/dev/null \
    || fail "$PUBLIC_REPO has no main: it is the fork of the original project, and carries its history"
  # At the public repository's main, whatever a run that was refused or stopped left here,
  # committed or not.
  git -C "$clone" checkout -q -f -B main origin/main
  # The clone holds what the public repository has and nothing beside it: what a run left
  # there that git does not track would make the comparison below find a difference that the
  # public repository does not have.
  git -C "$clone" clean -q -fdx
}

# The version the public repository's last commit names, or nothing when it has none yet:
# the fork as it was, whose main is then a commit of this repository's own history, behind
# the commit given. Any other commit there was written by somebody else, and is refused.
published_version() {  # 1 = the commit of this repository a public main with no version has to be behind
  local clone="$WORK/public" subject at
  subject="$(git -C "$clone" log -1 --format=%s origin/main)"
  if [[ $subject =~ ^alumia\ ([0-9][^ ]*)$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  at="$(git -C "$clone" rev-parse origin/main)"
  if ! git cat-file -e "$at^{commit}" 2>/dev/null || ! git merge-base --is-ancestor "$at" "$1"; then
    fail "the public repository's main is neither a version's commit nor one of this repository's history: '$subject'"
  fi
}

# The public repository against the export of the version it names: the same files, byte
# for byte, and nothing else.
check_public() {  # 1 = the commit a public main with no version has to be behind (HEAD when not given)
  local previous exported
  public_clone
  previous="$(published_version "${1:-HEAD}")"
  if [ -z "$previous" ]; then
    say "the public repository has no version yet"
    return 0
  fi
  git rev-parse -q --verify "refs/tags/v$previous" >/dev/null \
    || fail "the public repository names $previous, and this repository has no tag v$previous"
  exported="$WORK/export-$previous"
  export_tree "v$previous" "$exported"
  filter_tree "$exported" >/dev/null
  if ! diff -r -q --exclude=.git "$exported" "$WORK/public" >"$WORK/drift.log"; then
    head -20 "$WORK/drift.log" >&2
    fail "the public repository is not the photograph of $previous (see above)"
  fi
  say "the public repository is the photograph of $previous"
}

# -- the notes --------------------------------------------------------------------------

# The changelog's section of the version, as the release's notes: a link that is relative in
# the repository is nothing on a release's page, so each becomes the address of the file at
# the version's tag. That the file is there was checked with the tree's other links.
release_notes() {  # 1 = the version; 2 = its tag; 3 = the exported, filtered tree; 4 = the disk image; 5 = the file to write
  local digest
  uv run --no-project python - "$1" "$2" "$3" "$PUBLIC_REPO" >"$5" <<'PY' || exit 1
import pathlib
import re
import sys

version, tag, tree, repo = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3]), sys.argv[4]
lines, on = [], False
for line in (tree / "CHANGELOG.md").read_text(encoding="utf-8").split("\n"):
    if re.match(rf"## {re.escape(version)}( |$)", line):
        on = True
        continue
    if on and line.startswith("## "):
        break
    if on:
        lines.append(line)

def absolute(found):
    label, target = found.group(1), found.group(2)
    if re.match(r"[A-Za-z][A-Za-z0-9+.-]*:", target):
        return found.group(0)
    if target.startswith("#"):
        target = "CHANGELOG.md" + target
    return f"[{label}](https://github.com/{repo}/blob/{tag}/{target})"

sys.stdout.write(re.sub(r"\[([^\]]*)\]\(([^)\s]+)\)", absolute, "\n".join(lines)))
PY
  digest="$(shasum -a 256 "$4" | cut -d' ' -f1)"
  {
    echo
    echo "**Alumia-$1.dmg** (macOS 14 or newer, Apple Silicon), SHA-256 \`$digest\`."
    echo
    echo "Em português: [CHANGELOG.pt-BR.md](https://github.com/$PUBLIC_REPO/blob/$2/CHANGELOG.pt-BR.md)."
  } >>"$5"
}

# -- the modes --------------------------------------------------------------------------

do_export() {
  local dir="" source=HEAD version=""
  shift
  dir="${1:?--export takes the directory to export into}"; shift
  # The directory is emptied first: only one under tmp/ may be, so a slip of the hand never
  # empties anything that is somebody's.
  case "$dir" in
    tmp/*) ;;
    *) fail "--export writes under tmp/ alone, not to '$dir'" ;;
  esac
  while [ $# -gt 0 ]; do
    case "$1" in
      --worktree) source=WORKTREE ;;
      --version) version="${2:?--version takes the version}"; shift ;;
      *) fail "unknown argument $1" ;;
    esac
    shift
  done
  mkdir -p "$WORK"
  export_tree "$source" "$dir"
  [ -z "$version" ] || check_version "$dir" "$version"
  filter_tree "$dir"
  scan_tree "$dir"
  check_tree "$dir"
  say "exported ${version:-$source} to $dir"
}

do_publish() {
  local version="$1" tag="v$1" origin sha exported dmg verdict previous clone notes said tagged_on dated file resumed
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "'$version' is not a version of the form 0.1.3"
  origin="$(git remote get-url origin)"
  [[ $origin =~ [:/]${PRIVATE_REPO}(\.git)?$ ]] || fail "this is not a clone of $PRIVATE_REPO: origin is $origin"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || fail "commit or stash the tracked changes first"
  [ -f "$PUBLISH_KEY" ] || fail "there is no publication key at $PUBLISH_KEY: docs/release.md says how it is made, once"
  git rev-parse -q --verify "refs/tags/$tag" >/dev/null || fail "the tag $tag is not in this repository"
  [ "$(git cat-file -t "refs/tags/$tag")" = tag ] || fail "the tag $tag is not annotated: make it with git tag -a"
  sha="$(git rev-parse "$tag^{commit}")"
  # The private repository as it is now, asked once: its main and the tag, into references of
  # this script's own, taken away again below. What a clone remembers of its remote is not
  # what the remote has.
  if ! said="$(LC_ALL=C git fetch -q --no-tags origin "+refs/heads/main:refs/publish/main" "+refs/tags/$tag:refs/publish/tag" 2>&1)"; then
    case "$said" in
      *"couldn't find remote ref refs/tags/"*) fail "the tag $tag is not pushed to $PRIVATE_REPO: git push origin main $tag" ;;
      *) fail "$PRIVATE_REPO could not be read: $said" ;;
    esac
  fi
  said=""
  [ "$(git rev-parse refs/publish/tag)" = "$(git rev-parse "refs/tags/$tag")" ] || said="the tag $tag in $PRIVATE_REPO is not the one here"
  git merge-base --is-ancestor "$sha" refs/publish/main || said="${said:-the tag $tag is not on the main of $PRIVATE_REPO: push main first}"
  git update-ref -d refs/publish/main
  git update-ref -d refs/publish/tag
  [ -z "$said" ] || fail "$said"
  dmg="dist/mac/Alumia-$version.dmg"
  [ -f "$dmg" ] || fail "there is no $dmg: build it with packaging/build-mac-dmg.sh"
  verdict="$(spctl -a -t open --context context:primary-signature -v "$dmg" 2>&1)" || true
  grep -q 'source=Notarized Developer ID' <<<"$verdict" || fail "this Mac's Gatekeeper does not take $dmg as notarized: $verdict"

  mkdir -p "$WORK"
  exported="$WORK/export-$version"
  export_tree "$tag" "$exported"
  check_version "$exported" "$version"
  # The day the changelog gives the version is the day its tag was made, in both languages.
  tagged_on="$(git for-each-ref --format='%(taggerdate:short)' "refs/tags/$tag")"
  for file in CHANGELOG.md CHANGELOG.pt-BR.md; do
    dated="$(sed -n -E "s/^## ${version//./[.]} - ([0-9]{4}-[0-9]{2}-[0-9]{2})\$/\\1/p" "$exported/$file")"
    [ -n "$dated" ] || fail "$file at $tag has no section '## $version - <date>'"
    [ "$dated" = "$tagged_on" ] || fail "$file dates $version $dated, and the tag $tag was made on $tagged_on"
  done

  check_public "$tag"
  previous="$(published_version "$tag")"
  clone="$WORK/public"
  # A version goes on top of an older one, never under it: the public main is its versions in
  # order, and one published again, or an older one after a newer, would be written over it.
  if [ -n "$previous" ] && [ "$previous" != "$version" ] \
    && [ "$(printf '%s\n%s\n' "$previous" "$version" | sort -V | tail -1)" != "$version" ]; then
    fail "the public repository is at $previous, and $version is not a newer version"
  fi
  if [ "$previous" = "$version" ]; then
    # The photograph is pushed already (check_public said it is this version's). With its
    # release, the version is published and this is a slip; without, a run that stopped
    # after the push goes on to the release alone.
    ! gh release view "$tag" -R "$PUBLIC_REPO" >/dev/null 2>&1 || fail "the version $version is already published"
    say "$PUBLIC_REPO already holds $version with no release: creating the release"
    resumed=yes
  else
    filter_tree "$exported"
    scan_tree "$exported"
    check_tree "$exported"
    resumed=no
  fi

  # The notes before the push: one that cannot be made stops the publication with nothing written.
  notes="$WORK/notes-$version.md"
  release_notes "$version" "$tag" "$exported" "$dmg" "$notes"

  if [ "$resumed" = no ]; then
    find "$clone" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
    cp -R "$exported/." "$clone/"
    git -C "$clone" add -A
    git -C "$clone" commit -q -m "alumia $version" \
      -m "Photograph of $PRIVATE_REPO at ${sha:0:12} ($tag), made by tools/publish-public.sh." \
      || fail "nothing to commit: the public repository already holds this tree"
    # A tag left by a run whose push failed is made again on the new commit; one the public
    # repository already has would have made this version the published one above.
    git -C "$clone" tag -d "$tag" >/dev/null 2>&1 || true
    git -C "$clone" tag -a "$tag" -m "alumia $version"
    say "pushing main and $tag to $PUBLIC_REPO"
    # Both or neither: a main that went without its tag would be a version with no name.
    git -C "$clone" push -q --atomic origin main "$tag" || fail "the push to $PUBLIC_REPO failed; nothing was released, and running this again starts over from the public repository as it is"
  fi

  gh release create "$tag" -R "$PUBLIC_REPO" --verify-tag --title "$tag" --notes-file "$notes" "$dmg" >/dev/null \
    || fail "the release $tag could not be created on $PUBLIC_REPO; main and the tag are pushed"
  say "published $version: https://github.com/$PUBLIC_REPO/releases/tag/$tag"
  say "next: dispatch the release workflow there for the packages (docs/release.md)"
}

case "${1:-}" in
  --check) check_public ;;
  --export) do_export "$@" ;;
  "" | --help | -h) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
  --*) fail "unknown argument $1" ;;
  *) [ $# -eq 1 ] || fail "publish takes the version alone"; do_publish "$1" ;;
esac
