#!/usr/bin/env bash
# Rename the product across the tracked tree, paths and text, in one pass.
#
#   tools/rename-product.sh <old> <new> [<from>=<to> ...]
#
# <old> and <new> are lowercase names; their Capitalized and UPPERCASE forms are
# renamed with them. Each <from>=<to> pair is replaced first, verbatim, for the
# identifiers that carry an owner as well as the name (a repository, a bundle id).
#
# Left alone, by design: LICENSE, whose MIT notice of the original author stays as
# written; docs/plans, docs/research and docs/README.md, dated records of what was
# decided and measured; this script and tools/sync-original.sh, which name the old
# product on purpose; and binary files. Paths move with `git mv`; edited text is left
# for the caller to stage with `git add -u`.
#
# Running it twice changes nothing the second time.
set -euo pipefail

old=${1:?usage: rename-product.sh <old> <new> [<from>=<to> ...]}
new=${2:?usage: rename-product.sh <old> <new> [<from>=<to> ...]}
shift 2

[[ $old =~ ^[a-z][a-z0-9-]*$ && $new =~ ^[a-z][a-z0-9-]*$ ]] ||
  { echo "names must be lowercase words: '$old' '$new'" >&2; exit 2; }

cd "$(git rev-parse --show-toplevel)"

capital() { printf '%s%s' "$(printf '%s' "${1:0:1}" | tr '[:lower:]' '[:upper:]')" "${1:1}"; }
upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

keep=(':!LICENSE' ':!docs/plans' ':!docs/research' ':!docs/README.md'
      ':!tools/rename-product.sh' ':!tools/sync-original.sh')

git ls-files -z -- "${keep[@]}" | tr '\0' '\n' | { grep -i -- "$old" || true; } | while IFS= read -r path; do
  target=$(printf '%s' "$path" | sed -e "s/$old/$new/g" -e "s/$(capital "$old")/$(capital "$new")/g" \
    -e "s/$(upper "$old")/$(upper "$new")/g")
  [[ $target == "$path" ]] && continue
  mkdir -p "$(dirname "$target")"
  git mv -- "$path" "$target"
done

program=''
for pair in "$@"; do
  from=${pair%%=*} to=${pair#*=}
  [[ $pair == *=* && -n $from && -n $to ]] || { echo "not a <from>=<to> pair: '$pair'" >&2; exit 2; }
  program+="s{\\Q$from\\E}{$to}g;"
done
program+="s{$(upper "$old")}{$(upper "$new")}g;s{$(capital "$old")}{$(capital "$new")}g;s{$old}{$new}g;"

{ git grep -z -I -l -i -e "$old" -- "${keep[@]}" || true; } | xargs -0 -r perl -pi -e "$program"
