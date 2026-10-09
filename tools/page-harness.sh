#!/usr/bin/env bash
# The gateway's own test harness, for whatever needs the page in a browser without a
# remote: the browser specs (tools/run-page-tests.sh) and the photographs beside the
# mockup (tools/compare-screens.sh).
#
# The harness is `serve_a_test_tone` in src/server.rs: the real router, with the page
# compiled into it and a real login (admin / hunter2), in front of a scripted engine whose
# one computer is "test-tone". It ends by itself after fifteen minutes, so whoever needs it
# for longer starts another: starting one costs a moment once it is built.
#
# Sourced, not run:
#
#   source tools/page-harness.sh
#   harness_build            # once; compiles the gateway with the page in it
#   harness_start            # sets HARNESS_URL, and stops the harness when the shell exits
#   ...
#   harness_stop

HARNESS_BINARY=""
HARNESS_PID=""
HARNESS_URL=""
HARNESS_LOG="tmp/page-harness.log"

# Build the gateway's test binary and name it, so that what is started is the gateway
# itself and not cargo: stopping it is then one signal to one process.
harness_build() {
  export PATH="$HOME/.cargo/bin:$PATH"
  local built
  built="$(cargo test --lib serve_a_test_tone --no-run 2>&1)" || {
    echo "$built" >&2
    return 1
  }
  HARNESS_BINARY="$(sed -n 's/.*Executable unittests src\/lib\.rs (\(target\/debug\/deps\/alumia-[0-9a-f]*\)).*/\1/p' <<<"$built" | head -1)"
  if [ -z "$HARNESS_BINARY" ]; then
    echo "$built" >&2
    echo "page-harness: cargo did not name the test binary" >&2
    return 1
  fi
}

# Start it and wait for the address it prints.
harness_start() {
  mkdir -p tmp
  "$HARNESS_BINARY" serve_a_test_tone --ignored --nocapture >"$HARNESS_LOG" 2>&1 &
  HARNESS_PID=$!
  trap harness_stop EXIT
  HARNESS_URL=""
  for _ in $(seq 1 150); do
    HARNESS_URL="$(grep -o 'http://127\.0\.0\.1:[0-9]*/' "$HARNESS_LOG" | head -1 || true)"
    if [ -n "$HARNESS_URL" ]; then
      return 0
    fi
    if ! kill -0 "$HARNESS_PID" 2>/dev/null; then
      cat "$HARNESS_LOG" >&2
      echo "page-harness: the harness stopped before it listened" >&2
      return 1
    fi
    sleep 0.2
  done
  echo "page-harness: the harness did not say where it listens" >&2
  return 1
}

harness_stop() {
  if [ -n "$HARNESS_PID" ]; then
    kill "$HARNESS_PID" 2>/dev/null || true
    wait "$HARNESS_PID" 2>/dev/null || true
    HARNESS_PID=""
  fi
}
