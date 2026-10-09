#!/usr/bin/env bash
# Photograph the product's screens beside the mockup's, scene by scene, and write the page
# that shows each pair: docs/comparisons/<name>/index.html.
#
# The product is the gateway's own test harness (tools/page-harness.sh), with what only a
# real remote sends said in its place by the script (tools/compare-screens.cjs). The mockup
# is the file in docs/mockups, opened from disk. Nothing here is a test and no test depends
# on a photograph: it is one round for a delivery, for an eye to compare.
#
#   bash tools/compare-screens.sh                    every pair
#   bash tools/compare-screens.sh info-keys covers   those pairs alone, and the page again
set -euo pipefail
cd "$(dirname "$0")/.."
# Before anything is compiled: the public copy of the repository has no mockups.
[ -f docs/mockups/2026-10-03-0233-prancha-alumia.html ] \
  || { echo "compare-screens: docs/mockups is not in this tree, and every pair is the product beside the mockup" >&2; exit 1; }
# shellcheck source=/dev/null
source tools/page-harness.sh

harness_build
harness_start
NODE_PATH=tests/playwright/node_modules node tools/compare-screens.cjs "$HARNESS_URL" "$@"
harness_stop
