#!/usr/bin/env bash
# Build the public page (site/) and the README's pictures (docs/readme/) from the product.
#
# The gateway is compiled with the page in it (--profile qa) and run with the three
# computers of example of tools/site/site.toml, once per language, since one of the
# computers' names is Portuguese and the page in English says it in English; its sign-in
# and its list are harvested (tools/site/harvest.mjs) and photographed
# (tools/site/capture.mjs). A session comes from the gateway's own test harness
# (tools/page-harness.sh), whose one computer answers a connection. Then build.py writes
# site/index.html from the template, the harvest and the product's code, the Mac app's
# screens are photographed from that page, and check.py holds the result to what was
# approved. What this writes enters the repository: site/ and docs/readme/ are output
# kept, and tools/site/dom/ is the harvest the page was built from.
#
# Needs the Chromium of tests/playwright (bun install there), Rust and uv.
#
#   bash tools/site/build.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.cargo/bin:$PATH"

GATEWAY_URL="http://127.0.0.1:52383/"
GATEWAY_PID=""

gateway_start() {
  local config="$1"
  RUST_LOG=warn ./target/qa/alumia serve -c "$config" >tmp/site/gateway.log 2>&1 &
  GATEWAY_PID=$!
  for _ in $(seq 1 100); do
    if curl -fs -o /dev/null "$GATEWAY_URL"; then
      return 0
    fi
    if ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
      cat tmp/site/gateway.log >&2
      echo "site: the gateway stopped before it listened" >&2
      return 1
    fi
    sleep 0.2
  done
  echo "site: the gateway did not answer at $GATEWAY_URL" >&2
  return 1
}

gateway_stop() {
  if [ -n "$GATEWAY_PID" ]; then
    kill "$GATEWAY_PID" 2>/dev/null || true
    wait "$GATEWAY_PID" 2>/dev/null || true
    GATEWAY_PID=""
  fi
}

cargo build --profile qa

# The gateway writes its kept logins beside its config: the config runs from tmp/.
mkdir -p tmp/site
cp tools/site/site.toml tmp/site/site.pt-BR.toml
OFFICE_EN="$(uv run --no-project python -c 'import json; print(json.load(open("tools/site/words.json"))["en-US"]["sample.office"])')"
sed "s/^name = \"PC do escritório\"$/name = \"$OFFICE_EN\"/" tools/site/site.toml >tmp/site/site.en-US.toml

trap 'gateway_stop' EXIT
for lang in pt-BR en-US; do
  gateway_start "tmp/site/site.$lang.toml"
  node tools/site/harvest.mjs gateway "$GATEWAY_URL" medir "$lang"
  node tools/site/capture.mjs gateway "$GATEWAY_URL" medir "$lang"
  gateway_stop
done

source tools/page-harness.sh
harness_build
harness_start
node tools/site/harvest.mjs harness "$HARNESS_URL" hunter2
node tools/site/capture.mjs harness "$HARNESS_URL" hunter2
harness_stop

uv run --no-project python tools/site/build.py
node tools/site/capture.mjs app
uv run --no-project python tools/site/check.py
echo "site: built"
