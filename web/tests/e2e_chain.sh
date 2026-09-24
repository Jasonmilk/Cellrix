#!/usr/bin/env bash
# Is the chain THROUGH? One command, and it can go red.
#
#   ./e2e_chain.sh tool   # a tool round must happen  -> expect PASS
#   ./e2e_chain.sh text   # the mock plans no call    -> expect the criterion RED
#
# Why a script and not a paragraph: "the chain works" was, for several rounds, a
# description of a run I had done by hand. A description cannot fail. This can.
#
# The red case is the point. `MOCK_MODE=text` returns a plain reply, no tool is
# planned, no `tool/call` is ever written — and `chain_legs_test.js` is TOLD
# (`CHAIN_REQUIRE=executor,metering`) that this run required those legs, so their
# absence is the finding rather than a skip.
set -u
MODE="${1:-tool}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WS="$(cd "$HERE/../../.." && pwd)"
CHAIN="$WS/anaphase-helix/ecosystem/chain.json"
CHAIN_MODEL="${CHAIN_MODEL:-mock-chat-1}"
export NODE_PATH="${NODE_PATH:-$WS/.test-node/node_modules}"

port_of() { python3 -c "import json;print([c['port'] for c in json.load(open('$CHAIN'))['components'] if c['name']=='$1'][0])"; }
# Every component that declares an endpoint FOR ANAPHASE contributes it — the
# endpoints do not live on the `anaphase` entry, they live on each PEER
# (`anaphase_env` / `anaphase_value`). Reading only the anaphase entry exported a
# single variable and left the other four endpoints unset, so anaphase ran four
# SILENT Noop adapters: the plan parsed ("planned calls: calc") and nothing was ever
# dispatched, while every port reported healthy. Measured 2026-09-24: 0/5 runs
# dispatched and `context/inject` carried `nodes: 0` every time. This is the same
# shape as every other defect this session — a leg that degrades without saying so.
env_of()  { python3 -c "
import json
for c in json.load(open('$CHAIN'))['components']:
    if c.get('anaphase_env'): print('%s=%s' % (c['anaphase_env'], c['anaphase_value']))
    for k,v in (c.get('start_env') or {}).items(): print('%s=%s' % (k, v.replace('<workspace>','$WS')))"; }

echo "== e2e_chain: mode=$MODE =="
MPORT="${MOCK_PORT:-59099}"
pkill -f mock_upstream 2>/dev/null
for _ in 1 2 3 4 5; do lsof -nP -iTCP:"$MPORT" -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done
# Spawning is not the same as being the one you asked for. Measured 2026-09-24: a
# stale `MOCK_MODE=text` server kept the port, the new one died on EADDRINUSE, and
# the run then proved nothing while looking like a real execution. So: the port
# must be free, and the log must say the mode we asked for, or we stop here.
if lsof -nP -iTCP:"$MPORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  ABORT: :$MPORT still held — refusing to run against an unknown upstream"; exit 3
fi
MOCK_PORT="$MPORT" MOCK_MODE="$MODE" nohup node "$HERE/mock_upstream.js" > /tmp/e2e_mock.log 2>&1 &
sleep 2
if ! grep -q "mode=$MODE" /tmp/e2e_mock.log; then
  echo "  ABORT: the upstream did not come up in mode=$MODE"; cat /tmp/e2e_mock.log; exit 3
fi
echo "  upstream: $(head -1 /tmp/e2e_mock.log)"

# SEMANTIC probe, not a log line. A log says what the process PRINTED; only an
# answer says what it DOES — and a leftover process from the previous mode would
# print anything. So: ask it something whose CORRECT ANSWER DIFFERS BY MODE, and
# assert the answer. (Health checks lie; only a synthetic request through the real
# path answers "is this the thing I asked for".)
PROBE=$(curl -s --noproxy '*' -m 8 -X POST -H 'Content-Type: application/json' \
  -d '{"model":"mode-probe","messages":[{"role":"user","content":"probe"}]}' \
  "http://127.0.0.1:$MPORT/v1/chat/completions" 2>/dev/null || true)
if [ "$MODE" = "tool" ]; then
  if ! printf '%s' "$PROBE" | grep -q 'calls'; then
    echo "  ABORT: upstream does NOT answer in tool mode (probe saw no calls)"; exit 3
  fi
else
  if printf '%s' "$PROBE" | grep -q 'calls'; then
    echo "  ABORT: upstream answers like TOOL mode while MODE=$MODE"; exit 3
  fi
fi
echo "  upstream probe: answers as mode=$MODE  ✓"
KEY=$(python3 -c "
import re;s=open('$WS/Tuck/config.toml').read();m=re.search(r'api_key\s*=\s*\"([^\"]*)\"',s);print(m.group(1) if m else '')")
( cd "$WS/Cellrix" && nohup ./target/debug/up --restart --no-open --tuck-key "$KEY" > /tmp/e2e_up.log 2>&1 & )
sleep 45
echo "  stack ready: $(grep -cE '已就绪' /tmp/e2e_up.log) component(s)"

# Anaphase is restarted with the DECLARED model: `up` derives the endpoints from
# the declaration but not the model, so the run states it explicitly.
pkill -f "target/debug/anaphase" 2>/dev/null; sleep 2
( cd "$WS/anaphase-helix" && env $(env_of) ANAPHASE_REASONING_MODEL="$CHAIN_MODEL" \
    nohup ./target/debug/anaphase --config config.toml > /tmp/e2e_ana.log 2>&1 & )
sleep 5
SINCE=$(date +%s)
# DRIFT: the declaration is the source, so what anaphase is ACTUALLY RUNNING with
# must match what the declaration derives. Read-only: it reports, it does not
# repair — a drift that is silently applied is a signal destroyed.
APID=$(pgrep -f "target/debug/anaphase" | head -1 || true)
if [ -n "$APID" ]; then
  RUNENV=$(ps eww -p "$APID" -o command= 2>/dev/null | tr ' ' '\n' | grep '^ANAPHASE_' || true)
  MISSING=""
  for kv in $(env_of); do
    case "$kv" in
      ANAPHASE_*) printf '%s\n' "$RUNENV" | grep -qx "$kv" || MISSING="$MISSING $kv" ;;
    esac
  done
  if [ -n "$MISSING" ]; then
    echo "  ABORT: anaphase is running WITHOUT declared env:$MISSING"
    echo "         (that is silent Noop degradation — measured 0/5 dispatch, nodes 0)"; exit 3
  fi
  echo "  drift check: anaphase's live env matches the declaration  ✓"
fi

PROMPT="say pong"
echo "  turn (recordings since $SINCE, prompt=$PROMPT):"
curl -s --noproxy '*' -m 120 -X POST -H 'Content-Type: application/json' \
  -d "{\"message\":\"$PROMPT\"}" "http://127.0.0.1:$(port_of anaphase)/v1/chat" | head -c 200
echo
echo "  mock saw: $(grep -c 'POST' /tmp/e2e_mock.log) request(s)"

echo "== criterion =="
CHAIN_SINCE="$SINCE" CHAIN_PROMPT="$PROMPT" CHAIN_REQUIRE="executor,metering" node "$HERE/chain_legs_test.js"
CODE=$?

pkill -f mock_upstream 2>/dev/null
pkill -f "target/debug/up" 2>/dev/null
pkill -f "target/debug/anaphase" 2>/dev/null; pkill -f "target/debug/tentacle" 2>/dev/null
pkill -f "helix-mind-cli" 2>/dev/null; pkill -f "flowmodus " 2>/dev/null
pkill -f "target/debug/tuck" 2>/dev/null; pkill -f "cellrix-web" 2>/dev/null
echo "== e2e_chain: criterion exit $CODE (mode=$MODE) =="
exit $CODE
