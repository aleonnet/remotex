#!/usr/bin/env bash
# Run the browser specs that need no remote, against the gateway's own test harness.
#
# The harness (tools/page-harness.sh) is the real router, with the page compiled into it
# and a real login, in front of a scripted engine. This builds it once and then, for each
# spec file, starts it, runs the file against the address it prints and stops it: the
# harness ends by itself after fifteen minutes, and no file's run depends on how long the
# files before it took. One command says whether the page still signs in, lists its
# computers, opens a session and draws what a session has.
#
#   bash tools/run-page-tests.sh            every spec that needs no remote
#   bash tools/run-page-tests.sh -g eye     the tests whose title matches, as Playwright's -g
#   ALUMIA_PAGE_SPECS="opening session" bash tools/run-page-tests.sh     those files alone
#
# Every file runs in Chromium. The files of ALUMIA_PAGE_WEBKIT_SPECS, the sound's, the
# opening's and the session's unless it says otherwise, run a second time in Apple's engine, which is every
# browser of an iPhone and decides some things its own way: when sound may start, which
# video decoder there is, what a press leaves focused. Set it empty for Chromium alone.
#
# What each file's run printed is kept in tmp/page-tests-<spec>.out, and what a failing test
# left (its trace, the page as it was) in tmp/playwright-results/<spec>/: a folder for each
# file, so that the files run after a failure do not wipe what it left. A run in Apple's
# engine keeps its own, under <spec>-webkit.
#
# The specs that need a live Mac or a Windows host are not run here: see
# tests/playwright/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."
source tools/page-harness.sh

read -r -a SPECS <<<"${ALUMIA_PAGE_SPECS:-signin computers picker-options audio-socket opening session displays input-held throughput}"
read -r -a WEBKIT_SPECS <<<"${ALUMIA_PAGE_WEBKIT_SPECS-audio-socket opening session}"

# One file in one engine, against a harness of its own: `run_spec <spec> <engine> <kept as> ...`.
run_spec() {
  local spec="$1" engine="$2" kept="$3"
  shift 3
  local passed=0
  harness_start
  (
    cd tests/playwright
    ALUMIA_PLAYWRIGHT_BASE_URL="$HARNESS_URL" \
      ALUMIA_PLAYWRIGHT_USERNAME=admin \
      ALUMIA_PLAYWRIGHT_PASSWORD=hunter2 \
      ALUMIA_PLAYWRIGHT_AUDIO_TARGET=test-tone \
      ALUMIA_PLAYWRIGHT_PICKER_TARGET=test-tone \
      ALUMIA_PLAYWRIGHT_TARGET=test-tone \
      ALUMIA_PLAYWRIGHT_ENGINE="$engine" \
      bun run test "/${spec}\\.spec\\.ts\$" --pass-with-no-tests \
      --output "../../tmp/playwright-results/${kept}" "$@" 2>&1 |
      tee "../../tmp/page-tests-${kept}.out"
  ) || passed=1
  harness_stop
  return "$passed"
}

harness_build
failed=()
for spec in "${SPECS[@]}"; do
  run_spec "$spec" chromium "$spec" "$@" || failed+=("$spec")
  # Spelt so an empty list is no error under `set -u` in the bash a Mac comes with.
  for other in ${WEBKIT_SPECS[@]+"${WEBKIT_SPECS[@]}"}; do
    if [ "$other" = "$spec" ]; then
      run_spec "$spec" webkit "${spec}-webkit" "$@" || failed+=("${spec} in Apple's engine")
    fi
  done
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "run-page-tests: failed: ${failed[*]}" >&2
  exit 1
fi
echo "run-page-tests: every spec passed (${SPECS[*]})"
