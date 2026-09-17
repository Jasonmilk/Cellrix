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

# ------------------------------------------------- capability parity
# The harness must run the same way the real launcher does. `up` starts tentacle
# with --plugins-dir; this script did not, so every run here had ZERO tools while
# the page still passed every check — a false green of exactly the kind this file
# exists to prevent. Its own launcher is checked, not remembered.
if ! grep -q -- "--plugins-dir" "$(dirname "${BASH_SOURCE[0]}")/start-panel.sh"; then
  echo "REJECT: start-panel.sh starts tentacle without --plugins-dir."
  echo "        The harness then has NO tools while the real launcher (up) does,"
  echo "        so every result here is about a differently-equipped system."
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

# ------------------------------------------------- capability, not liveness
# Readiness above only proves something is listening. Today six ports all
# answered while the feature did not work, so the probe asks the chain to do a
# thing: fetch a period through the panel and check its shape.
#
# The sample is a real 5-turn period, not the newest file. The newest file is
# typically 1 turn, and a 1-turn period passes even with the multi-turn bug
# present — a probe that cannot fail on the bug it is meant to catch is not a
# probe. (Measured: the newest was 8 lines / 1 turn, the easiest input there is.)
#
# Missing sample = FAILURE, not a skip: a skipped check reads as a pass.
#
# CELLRIX is the repo root; its parent is the workspace. Two levels up is the
# workspace's parent, which is where I first pointed this — measured, not
# assumed, because the probe silently skipped when the path did not exist.
WS_ROOT="$(cd "$CELLRIX/.." && pwd)"
CAP_JOB="run-7efbf0f8aacf96d5"
# Resolve the sample BY ITS ROWS, never by the file name. The writer names files
# after an allocated period identity (anaphase K-006 / B15), so
# "$CAP_JOB.events.jsonl" no longer exists even though the period does — and a
# name-based lookup would have failed the whole CAPABILITY check for a rename.
EV_DIR="$WS_ROOT/.helix/events"
CAP_FILE="$(node -e '
  const fs = require("fs"), path = require("path");
  const dir = process.argv[1], want = process.argv[2];
  let hit = "";
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".events.jsonl")) continue;
    const first = fs.readFileSync(path.join(dir, name), "utf8").split("\n").find(l => l.trim());
    if (!first) continue;
    let row; try { row = JSON.parse(first); } catch (e) { continue; }
    const id = (row && row.period_id) || name.slice(0, -".events.jsonl".length);
    if (id === want || (row && row.job_id) === want) { hit = path.join(dir, name); break; }
  }
  process.stdout.write(hit);
' "$EV_DIR" "$CAP_JOB")"
CAP_WANT_EVENTS=55
CAP_WANT_TURNS=5

if [ ! -f "$CAP_FILE" ]; then
  echo "CAPABILITY FAILURE: sample period missing — $CAP_FILE"
  echo "        (a missing sample must fail, not skip: a skipped check reads as a pass)"
  rc=1
else
  cap_body="$(curl -s --noproxy '*' -m 6 "http://127.0.0.1:$PORT/api/events?job_id=$CAP_JOB")"
  cap="$(printf '%s' "$cap_body" | grep -o '"type"' | wc -l | tr -d ' ')"
  cap_turns="$(printf '%s' "$cap_body" | grep -o '"turn/start"' | wc -l | tr -d ' ')"
  if [ "${cap:-0}" -ge "$CAP_WANT_EVENTS" ] && [ "${cap_turns:-0}" -eq "$CAP_WANT_TURNS" ]; then
    echo "capability — $CAP_JOB served $cap events across $cap_turns turns"
  else
    echo "CAPABILITY FAILURE: $CAP_JOB served $cap events / $cap_turns turns"
    echo "        (expected >= $CAP_WANT_EVENTS events and exactly $CAP_WANT_TURNS turns)"
    rc=1
  fi
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
