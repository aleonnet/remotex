#!/usr/bin/env bash
# Build the image release CI never publishes — the public image with Debian's
# libavcodec61 and fdk-aac (libfdk-aac2t64, from non-free) installed, the High
# Performance decoders its gateway loads at run time — and push it to the
# operator's private registry, ghcr.io/andrewtheguy/remotex-full, under the tag's
# own name (v0.0.286).
#
# The tags it builds are release tags, and it builds nothing of remotex: the
# release workflow has published the public image of the tag, and this is one
# layer over that image's linux/amd64 half, installing the two libraries. A tag
# whose gateway links the decoders rather than loading them is refused.
#
# The package must stay private: the public image leaves the decoders out, and a
# public package is a release artifact. The first push creates it `internal` —
# readable by the organization — and only the package's settings page on GitHub
# can make it private; there is no API for it. This script asks ghcr whether an
# anonymous client can pull the package, and does not push unless the answer is
# no or there is no package yet, and fails unless it is no after the push.
#
# Log in first, with a token that has `write:packages`:
#
#   podman login ghcr.io
#
#   packaging/publish-full-image.sh TAG
#
#   TAG  the released tag to build on, e.g. v0.0.286
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

registry=ghcr.io
package=andrewtheguy/remotex-full
image="${registry}/${package}"

[ $# -eq 1 ] && [ "${1#-}" = "$1" ] || { echo "usage: $0 TAG" >&2; exit 2; }
tag="$1"
public="${registry}/andrewtheguy/remotex:${tag}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) ;;
  *) echo "this builds linux/amd64 on a linux/amd64 host, not $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

commit="$(git rev-parse --verify --quiet "refs/tags/${tag}^{commit}")" \
  || { echo "this checkout has no tag ${tag}: git fetch --tags" >&2; exit 1; }
git cat-file -e "${commit}:src/libav.rs" 2>/dev/null \
  || { echo "${tag} links the decoders rather than loading them: there are no libraries to add to its image" >&2; exit 1; }

# Before the build rather than after it.
podman login --get-login "$registry" >/dev/null 2>&1 \
  || { echo "not logged in to ${registry}: podman login ${registry}" >&2; exit 1; }

echo ">> pulling ${public}"
podman pull --platform linux/amd64 "$public"
reported="$(podman run --rm --platform linux/amd64 "$public" --version)"
[ "$reported" = "remotex ${tag#v}" ] \
  || { echo "${public} reports '${reported}', not remotex ${tag#v}" >&2; exit 1; }

layer="$(mktemp -d)"
trap 'rm -rf "$layer"' EXIT
cat >"$layer/Containerfile" <<'CONTAINERFILE'
ARG BASE
FROM ${BASE}
RUN sed -i 's/^Components: main$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends libavcodec61 libfdk-aac2t64 \
    && rm -rf /var/lib/apt/lists/*
CONTAINERFILE

echo ">> building ${image}:${tag}"
podman build \
  --platform linux/amd64 \
  -f "$layer/Containerfile" \
  --build-arg "BASE=${public}" \
  --label "org.opencontainers.image.revision=${commit}" \
  -t "${image}:${tag}" \
  "$layer"

# What ghcr tells a client with no credentials that asks to pull the package, as
# measured: a token for a public package, 401 UNAUTHORIZED for a private one, and
# 403 DENIED for one that does not exist. Anything else says nothing.
anonymous_access() {
  local response body code
  response="$(curl -sS -w '\n%{http_code}' "https://${registry}/token?scope=repository:${package}:pull")" \
    || { echo "unreachable"; return; }
  body="${response%$'\n'*}"
  code="${response##*$'\n'}"
  case "$code" in
    200) grep -q '"token":"[^"]' <<<"$body" && echo public || echo "HTTP 200 without a token" ;;
    401) grep -q '"code":"UNAUTHORIZED"' <<<"$body" && echo private || echo "HTTP 401: ${body}" ;;
    403) grep -q '"code":"DENIED"' <<<"$body" && echo missing || echo "HTTP 403: ${body}" ;;
    *) echo "HTTP ${code}: ${body}" ;;
  esac
}

# Before a layer goes up. A package that does not exist yet is the first push,
# which the check after it covers.
access="$(anonymous_access)"
case "$access" in
  private | missing) ;;
  public) echo "${image} is public: make the package private before pushing to it" >&2; exit 1 ;;
  *) echo "could not tell whether ${image} is private (${access}); not pushing" >&2; exit 1 ;;
esac

echo ">> pushing ${image}:${tag}"
podman push "${image}:${tag}"

access="$(anonymous_access)"
[ "$access" = private ] \
  || { echo "${image} is not confirmed private after the push (${access}): anyone may pull ${tag}. Make the package private" >&2; exit 1; }

echo ">> pushed ${image}:${tag} (${commit}); anonymous pull refused"
