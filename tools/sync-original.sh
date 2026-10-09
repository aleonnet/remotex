#!/usr/bin/env bash
# Bring the original project's new work in, renamed, as an ordinary merge.
#
#   tools/sync-original.sh [<ref>]        default: upstream/main
#
# The original reaches this repository through one branch, original-renomeado. Each
# commit on it is the original's tree at one point, renamed by tools/rename-product.sh
# with the arguments below. Our branch carries the same rename, so the rename is the same
# change on both sides and the merge conflicts only where both sides changed the same
# work. The original's commit is named in the message, not made a parent: a parent would
# give the merge two bases.
#
# The merge is left uncommitted: run the gates, then `git commit`.
set -euo pipefail

RENAME=(remotex alumia andrewtheguy/remotex=aleonnet/alumia com.andrewtheguy.remotex=com.aleonnet.alumia)
MIRROR=original-renomeado

ref=${1:-upstream/main}
cd "$(git rev-parse --show-toplevel)"
[[ -z $(git status --porcelain --untracked-files=no) ]] ||
  { echo "commit or stash the tracked changes first" >&2; exit 1; }
here=$(git symbolic-ref --short HEAD)
sha=$(git rev-parse --verify "$ref^{commit}")

# `read-tree --reset` overwrites a file at a path the original tracks and this branch does
# not, ignored or not, so any file already there stops the run.
clash=$(comm -23 <(git ls-tree -r --name-only "$sha" | sort) <(git ls-files | sort) |
  while IFS= read -r path; do [[ -e $path || -L $path ]] && printf '%s\n' "$path"; done || true)
[[ -z $clash ]] || { printf 'files at paths the original tracks; move them first:\n%s\n' "$clash" >&2; exit 1; }

# The mirror is the one already published when this clone has none of its own; only the
# first run anywhere starts it, at the original commit this branch already holds.
if ! git show-ref --verify --quiet "refs/heads/$MIRROR"; then
  if git show-ref --verify --quiet "refs/remotes/origin/$MIRROR"; then
    git branch "$MIRROR" "origin/$MIRROR"
  else
    git branch "$MIRROR" "$sha"
  fi
fi

# The mirror's tree is the original's and does not carry the script.
script=$(mktemp)
back() { rm -f "$script"; [[ $(git symbolic-ref --short HEAD) == "$here" ]] || git checkout -q -f "$here"; }
trap back EXIT
cp tools/rename-product.sh "$script"

git checkout -q "$MIRROR"
git read-tree -u --reset "$sha"
bash "$script" "${RENAME[@]}"
# Tracked files only: what the original holds and what the rename moved. Never -A, which
# would take in whatever untracked file sits in the working tree, a local config included.
git add -u
if git diff --cached --quiet; then
  echo "the original at ${sha:0:8} brings nothing new"
else
  git commit -q -m "Original at ${sha:0:8}, renamed"
fi
git checkout -q "$here"

if git merge-base --is-ancestor "$MIRROR" HEAD; then
  echo "this branch already holds the original at ${sha:0:8}"
  exit 0
fi
# A branch that already holds the original commit takes its renamed mirror as a record and
# nothing else: the work is here already, and the lines this branch changed beside the
# product's name would otherwise read as conflicts with the original's older text.
if git merge-base --is-ancestor "$sha" HEAD; then
  git merge --no-commit -s ours "$MIRROR" >/dev/null
  echo "this branch already holds the original at ${sha:0:8}: the mirror is recorded, nothing changes; commit it"
  exit 0
fi

if ! git merge --no-commit --no-ff "$MIRROR"; then
  git rev-parse -q --verify MERGE_HEAD >/dev/null ||
    { echo "the merge did not start; see git's message above" >&2; exit 1; }
  # A lockfile conflict is settled as the last junctions were: the original's file, with
  # Cargo adding back the packages only this side uses. Any other conflict is a person's.
  conflicted=$(git diff --name-only --diff-filter=U)
  if grep -v -q "Cargo\.lock$" <<<"$conflicted"; then
    printf 'conflicts beyond the lockfiles; resolve them, run the gates, then commit:\n%s\n' "$conflicted" >&2
    exit 1
  fi
  git checkout --theirs -- $conflicted
fi
git rev-parse -q --verify MERGE_HEAD >/dev/null ||
  { echo "this branch already holds the original at ${sha:0:8}"; exit 0; }
# Read after the merge, so a lockfile the original adds is ordered too. A renamed package
# sorts elsewhere in its lockfile: keep the order Cargo writes, so a build never leaves the
# tree dirty.
locks=$(git ls-files -- "*Cargo.lock")
for lock in $locks; do (cd "$(dirname "$lock")" && cargo metadata --format-version 1 >/dev/null); done
git add -- $locks
echo "merged and not committed: run the gates, then git commit"
