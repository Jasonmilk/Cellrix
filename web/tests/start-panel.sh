#!/usr/bin/env bash
# Start the full Helix stack needed by the Cellrix panel.
#
#   tuck      :60052   LLM gateway + audit chain (Anaphase is fail-closed on it)
#   tentacle  :50051   tool-execution engine (gRPC) -> Anaphase's deterministic channel
#   mind      :50052   memory hub (gRPC) -> Anaphase's memory retrieval
#   flowmodus :60053   supplier pool + routing (serve); the panel's Flows view reads it
#   anaphase  :50061   cognitive engine (CAP HTTP)
#   panel     :18932   Cellrix web panel (proxies anaphase + tuck + flowmodus)
#
# Order matters: Anaphase resolves tentacle/mind/tuck at startup, so those three
# must be listening first or Anaphase silently falls back to Noop adapters.
#
# Usage:  ./start-panel.sh [port]     (default 18932)
#         ./start-panel.sh --stop     stop all six
set -u

# The workspace root is derived from this script's own location, never
# hardcoded: the script lives at <workspace>/Cellrix/web/tests/, so three
# levels up is the workspace. Logs stay outside every repo (runtime only).
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PORT="${1:-18932}"
LOGS="$WS/.workbuddy-ai/tools/prove-track-verify/logs"

TUCK_BIN="$WS/Tuck/target/debug/tuck"
TENT_BIN="$WS/helix-tentacle/target/debug/tentacle"
MIND_BIN="$WS/helix-mind/target/debug/helix-mind-cli"
FLOW_BIN="$WS/FlowModus/flowmodus-rs/target/debug/flowmodus"
ANA_BIN="$WS/anaphase-helix/target/debug/anaphase"
PANEL_BIN="$WS/Cellrix/target/debug/cellrix-web"
MIND_CFG="$WS/.helix/mind/config.toml"
# flowmodus resolves its registry through a *relative* path ("registry"), so it
# must be launched from the crate dir or it reports an empty pool.
FLOW_DIR="$WS/FlowModus/flowmodus-rs"
FLOW_PORT=60053

SERVICES="tuck tentacle mind flowmodus anaphase panel"

pidfile() { echo "$LOGS/$1.pid"; }

alive() { # alive <pid>
  [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null
}

stop_one() { # stop_one <name>
  local f; f="$(pidfile "$1")"
  if [ -f "$f" ]; then
    local pid; pid="$(cat "$f" 2>/dev/null)"
    if alive "$pid"; then
      kill "$pid" 2>/dev/null
      local i=0
      while alive "$pid" && [ "$i" -lt 10 ]; do sleep 0.3; i=$((i + 1)); done
      alive "$pid" && kill -9 "$pid" 2>/dev/null
    fi
    rm -f "$f"
  fi
}

# Kill by PID only — never `pkill -f`, which matches on the whole command line
# and can take out an unrelated process that merely mentions the same path.
stop_all() {
  for s in $SERVICES; do stop_one "$s"; done
  sleep 1
  echo "stopped: $SERVICES"
}

if [ "${1:-}" = "--stop" ]; then stop_all; exit 0; fi

# --- preflight -------------------------------------------------------------
missing=0
for b in "$TUCK_BIN" "$TENT_BIN" "$MIND_BIN" "$FLOW_BIN" "$ANA_BIN" "$PANEL_BIN"; do
  if [ ! -x "$b" ]; then echo "MISSING BINARY: $b"; missing=1; fi
done
[ "$missing" = 1 ] && { echo; echo "Build the missing crate first, e.g.:"; \
  echo "  (cd $WS/helix-tentacle && cargo build)"; echo "  (cd $WS/helix-mind && cargo build)"; \
  echo "  (cd $FLOW_DIR && cargo build)"; exit 1; }
if [ ! -f "$MIND_CFG" ]; then echo "MISSING CONFIG: $MIND_CFG"; exit 1; fi

mkdir -p "$LOGS"
echo "logs -> $LOGS"
stop_all >/dev/null   # idempotent: never stack a second copy

wait_port() { # wait_port <port> <label> <seconds>
  local p="$1" label="$2" secs="${3:-15}" i=0
  while [ "$i" -lt "$secs" ]; do
    if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "  OK    $label :$p"; return 0
    fi
    sleep 1; i=$((i + 1))
  done
  echo "  FAIL  $label :$p did not listen in ${secs}s (see $LOGS)"
  return 1
}

# spawn <name> <workdir> <cmd...>
# nohup + disown so the service survives this script exiting. (`disown` drops it
# from the shell's job table, so no SIGHUP is sent when the script finishes.)
spawn() {
  local name="$1" dir="$2"; shift 2
  ( cd "$dir" && exec nohup "$@" ) >"$LOGS/$name.log" 2>&1 </dev/null &
  echo $! >"$(pidfile "$name")"
  disown 2>/dev/null || true
}

echo "[1/6] tuck      :60052"
spawn tuck "$WS/Tuck" "$TUCK_BIN" --config config.toml
wait_port 60052 tuck 15 || exit 1

echo "[2/6] tentacle  :50051 (gRPC)"
# Without --plugins-dir tentacle registers NOTHING, list_tools() returns empty,
# and the tools block is silently dropped from the system prompt — the model then
# truthfully reports "no tools available" (measured: 40+ periods with zero tool
# calls after 2026-09-13 20:04, the last run that DID call one, against the same
# model). The launcher has to name the directory that holds the tools.
spawn tentacle "$WS/helix-tentacle" "$TENT_BIN" --transport grpc --grpc-port 50051 \
  --plugins-dir "$WS/helix-tentacle/fixtures"
wait_port 50051 tentacle 20 || exit 1

echo "[3/6] mind      :50052 (gRPC)"
spawn mind "$WS/helix-mind" "$MIND_BIN" -c "$MIND_CFG" run
wait_port 50052 mind 25 || exit 1

echo "[4/6] flowmodus :$FLOW_PORT (serve)"
spawn flowmodus "$FLOW_DIR" "$FLOW_BIN" serve --port "$FLOW_PORT"
wait_port "$FLOW_PORT" flowmodus 15 || exit 1

echo "[5/6] anaphase  :50061"
spawn anaphase "$WS/anaphase-helix" \
  env ANAPHASE_CONFIG="$WS/anaphase-helix/config.toml" "$ANA_BIN"
wait_port 50061 anaphase 25 || exit 1

echo "[6/6] panel     :$PORT"
spawn panel "$WS/Cellrix" "$PANEL_BIN" --port "$PORT" \
  --flowmodus-url "http://127.0.0.1:$FLOW_PORT"
wait_port "$PORT" panel 20 || exit 1

# --- report ----------------------------------------------------------------
echo
echo "--- adapters actually wired? (grep Anaphase's startup log) ---"
if grep -q "Pipeline wired to Tentacle" "$LOGS/anaphase.log" 2>/dev/null; then
  echo "  OK    tentacle adapter active"
else
  echo "  WARN  tentacle adapter NOT wired (legacy execution fallback)"
fi
if grep -q "mind degraded" "$LOGS/anaphase.log" 2>/dev/null; then
  echo "  WARN  mind degraded to Noop — check $LOGS/mind.log"
else
  echo "  OK    mind adapter active"
fi

echo
echo "--- ecosystem probe (what the panel's status bar shows) ---"
curl -s --noproxy '*' -m 8 "http://127.0.0.1:$PORT/api/ecosystem" 2>/dev/null | tr ',' '\n' \
  | grep -E '"name"|"state"' | paste - - 2>/dev/null || echo "  (probe unavailable)"

echo
echo "--- flowmodus wiring (what the Flows view shows) ---"
if curl -s --noproxy '*' -m 8 "http://127.0.0.1:$FLOW_PORT/api/status" 2>/dev/null \
     | grep -q '"tiers"'; then
  echo "  OK    flowmodus serve /api/status reachable"
else
  echo "  WARN  flowmodus serve unreachable — the Flows view stays empty"
fi
if curl -s --noproxy '*' -m 8 "http://127.0.0.1:$PORT/api/flows" 2>/dev/null \
     | grep -q '"flows":null'; then
  echo "  WARN  panel /api/flows returned null (flowmodus_url not wired?)"
else
  echo "  OK    panel /api/flows carries a supplier pool"
fi

echo
echo "Open:  http://127.0.0.1:$PORT/"
echo "Views: Cockpit / ProveTrack / Chat / Flows  (toolbar at top)"
echo "Stop:  ./start-panel.sh --stop"
