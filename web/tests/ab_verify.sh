#!/usr/bin/env bash
# A/B verification for burnt-in web assets (Cellrix:ADR-0018 T7).
#
# The panel's assets are compiled into the binary with `include_str!`, so
# "I edited an asset" and "the server serves it" are two different facts, and
# only a rebuild connects them. Twice today an e2e run was read as a pass while
# the binary still held the previous assets.
#
# A result from a stale binary is not a weaker result — it is a result about
# different code. So this script refuses to run the e2e at all when the two
# disagree, and says which files disagree.
#
# Usage:  ./ab_verify.sh          check freshness, then run the e2e
#         ./ab_verify.sh --check  freshness only (no stack, no port)
#
# Exit:   0 fresh + e2e ran    2 stale (rebuild, then rerun)    other = e2e failure
set -u

WS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CELLRIX="$WS/Cellrix"
BIN="$CELLRIX/target/debug/cellrix-web"
ASSETS="$CELLRIX/web/assets"
PORT="${PORT:-18932}"

if [ ! -x "$BIN" ]; then
  echo "no binary at $BIN — build it first: (cd $CELLRIX && cargo build -p cellrix-web)"
  exit 2
fi

# ---------------------------------------------------------------- freshness
# `find -newer` compares mtimes directly; no date parsing, no arithmetic.
stale="$(find "$ASSETS" -type f -newer "$BIN" 2>/dev/null | sort)"
if [ -n "$stale" ]; then
  echo "STALE — the binary predates these assets:"
  echo "$stale" | sed 's|^|  |'
  echo ""
  echo "The assets are burnt in at compile time, so this binary is serving the"
  echo "previous ones. Rebuild, then rerun:"
  echo ""
  echo "  (cd $CELLRIX && cargo build -p cellrix-web)"
  echo "  $0"
  exit 2
fi
echo "fresh — the binary is newer than every asset under web/assets/"

if [ "${1:-}" = "--check" ]; then
  exit 0
fi

# ---------------------------------------------------------------------- e2e
# The stack does not survive a command boundary, so start, probe and stop all
# happen here rather than across separate invocations.
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE_BIN" ]; then
  echo "node not found — set NODE_BIN=/path/to/node"
  exit 3
fi
export NODE_PATH="${NODE_PATH:-$HOME/.workbuddy-ai/binaries/node/workspace/node_modules}"

echo ""
echo "starting the stack on :$PORT (log: /tmp/ab-verify-panel.log)"
"$CELLRIX/web/tests/start-panel.sh" "$PORT" > /tmp/ab-verify-panel.log 2>&1

# Poll for readiness rather than sleeping a fixed amount: the six components
# come up in dependency order and a fixed sleep is either too short or wasted.
ready=0
for _ in $(seq 1 20); do
  if curl -s --noproxy '*' -m 2 "http://127.0.0.1:$PORT/api/ecosystem" > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" != "1" ]; then
  echo "panel never became ready — see /tmp/ab-verify-panel.log"
  "$CELLRIX/web/tests/start-panel.sh" --stop > /dev/null 2>&1
  exit 4
fi

echo "running all_views_test.js"
out="$("$NODE_BIN" "$CELLRIX/web/tests/all_views_test.js" 2>&1)"
rc=$?
printf '%s\n' "$out" | tail -6
# Print the failures themselves rather than reciting a past run. A note that
# says "4 failures are the known set" goes stale the moment the set changes,
# and then sends the next reader after a problem that no longer exists.
fails="$(printf '%s\n' "$out" | grep -c '^  FAIL' || true)"
if [ "${fails:-0}" != "0" ]; then
  echo ""
  echo "actual failures ($fails):"
  printf '%s\n' "$out" | grep '^  FAIL' | sed 's/^/  /'
fi

echo ""
echo "stopping the stack"
"$CELLRIX/web/tests/start-panel.sh" --stop > /dev/null 2>&1

# No baseline recital: the failures above are the failures. K12 was fixed on
# 2026-09-15 and this note outlived it by hours.
echo ""
if [ "$rc" = "0" ]; then
  echo "all assertions passed"
else
  echo "non-zero exit — see the failures listed above"
fi
exit "$rc"
