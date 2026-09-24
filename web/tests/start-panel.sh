#!/usr/bin/env bash
# Start the full Helix stack needed by the Cellrix panel.
#
#   tuck      :60052   LLM gateway + audit chain (Anaphase is fail-closed on it)
#   tentacle  :50051   tool-execution engine (gRPC) -> Anaphase's deterministic channel
#   mind      :50052   memory hub (gRPC) -> Anaphase's memory retrieval
#   flowmodus :60053   supplier pool + routing (serve); the panel's Flows view reads it
#   anaphase  :50061   cognitive engine (CAP HTTP)
#   panel     :from the declaration   Cellrix web panel (proxies anaphase + tuck + flowmodus)
#
# Order matters: Anaphase resolves tentacle/mind/tuck at startup, so those three
# must be listening first or Anaphase silently falls back to Noop adapters.
#
# Usage:  ./start-panel.sh [port]     (default: the `panel` entry in
#                                     anaphase-helix/ecosystem/chain.json)
#         ./start-panel.sh --stop     stop all six
set -u

# The workspace root is derived from this script's own location, never
# hardcoded: the script lives at <workspace>/Cellrix/web/tests/, so three
# levels up is the workspace. Logs stay outside every repo (runtime only).
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHAIN_ENV="$WS/Cellrix/web/tests/chain-env"
if [ ! -x "$CHAIN_ENV" ]; then echo "MISSING chain-env: $CHAIN_ENV"; exit 1; fi
# The ONE derivation lives in `chain-env` (ADR-0047 D3). This script consumes it and
# derives nothing: a second derivation has nowhere to live, rather than being
# asserted absent. The manifest is committed, so a stale one is caught here.
"$CHAIN_ENV" --check || exit 1
eval "$("$CHAIN_ENV" --emit-sh)"
PORT="${1:-$PORT_PANEL}"
LOGS="$WS/.workbuddy-ai/tools/prove-track-verify/logs"

TUCK_BIN="$WS/Tuck/target/debug/tuck"
TENT_BIN="$WS/helix-tentacle/target/debug/tentacle"
MIND_BIN="$WS/helix-mind/target/debug/helix-mind-cli"
FLOW_BIN="$WS/FlowModus/flowmodus-rs/target/debug/flowmodus"
ANA_BIN="$WS/anaphase-helix/target/debug/anaphase"
PANEL_BIN="$WS/Cellrix/target/debug/cellrix-web"
MIND_CFG="$WS/.helix/mind/config.toml"
# ── The chain's wiring facts, from ONE declaration (anaphase:ADR-0046) ───────
# Ports and Anaphase's endpoint env are NOT restated here. Measured 2026-09-24:
# three launchers carried three different wirings, and only anaphase's own `up`
# injected the endpoints — so this harness started six healthy processes while
# Anaphase ran three Noop adapters (mind/tentacle/tuck) and called the fourth
# (`grpc://127.0.0.1:60054`) a "bad endpoint". Exporting the declared env closes
# the loop; `spawn` inherits it.
echo "chain declaration: $CHAIN_ENV_COUNT endpoint env(s) derived from $(basename "$CHAIN_JSON")"
# Tuck's tamper-evident audit chain (Tuck:ADR-0006) closes the leg WITHOUT
# editing Tuck/config.toml, which is gitignored: a machine-rebuilt config
# silently lost `audit_path`, so `/v1/audit` answered 404 no_audit_chain while
# the gateway still served — and every launcher called Tuck healthy.
# The path itself is derived below; only non-secret operational keys go through
# env (Tuck's api_key / jwt_secret / upstream_key stay in the untracked 0600
# config — DNA iron rule 3).
# Tuck's audit chain path is DERIVED below from the declaration's `start_env`
# (anaphase:ADR-0046) — not restated here.
# flowmodus resolves its registry through a *relative* path ("registry"), so it
# must be launched from the crate dir or it reports an empty pool.
FLOW_DIR="$WS/FlowModus/flowmodus-rs"
FLOW_PORT="$PORT_FLOWMODUS_SERVE"

SERVICES="tuck tentacle mind flowmodus-serve flowmodus-reason anaphase panel"

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

echo "[1/7] tuck      :$PORT_TUCK"
spawn tuck "$WS/Tuck" "$TUCK_BIN" --config config.toml
wait_port "$PORT_TUCK" tuck 15 || exit 1
# The port listening is NOT the criterion (ADR-0006): the gateway serves with an
# empty audit_path too. The physical fact we require is that it OPENED a ledger.
if [ -f "$TUCK_GATEWAY__AUDIT_PATH" ]; then
  echo "  OK    tuck audit chain open: $TUCK_GATEWAY__AUDIT_PATH"
else
  echo "  WARN  tuck audit chain NOT open ($TUCK_GATEWAY__AUDIT_PATH missing) — /v1/audit will 404 no_audit_chain"
fi

echo "[2/7] tentacle  :$PORT_TENTACLE (gRPC)"
# Without --plugins-dir tentacle registers NOTHING, list_tools() returns empty,
# and the tools block is silently dropped from the system prompt — the model then
# truthfully reports "no tools available" (measured: 40+ periods with zero tool
# calls after 2026-09-13 20:04, the last run that DID call one, against the same
# model). The launcher has to name the directory that holds the tools.
spawn tentacle "$WS/helix-tentacle" "$TENT_BIN" --transport grpc --grpc-port "$PORT_TENTACLE" \
  --plugins-dir "$WS/helix-tentacle/fixtures"
wait_port "$PORT_TENTACLE" tentacle 20 || exit 1

echo "[3/7] mind      :$PORT_MIND (gRPC)"
spawn mind "$WS/helix-mind" "$MIND_BIN" -c "$MIND_CFG" run
wait_port "$PORT_MIND" mind 25 || exit 1

echo "[4/7] flowmodus :$FLOW_PORT (serve)"
spawn flowmodus-serve "$FLOW_DIR" "$FLOW_BIN" serve --port "$FLOW_PORT"
wait_port "$FLOW_PORT" flowmodus 15 || exit 1

echo "[5/7] flowmodus-reason :$PORT_FLOWMODUS_REASON (gRPC Reason — the reasoning entry)"
spawn flowmodus-reason "$FLOW_DIR" "$FLOW_BIN" grpc --port "$PORT_FLOWMODUS_REASON"
wait_port "$PORT_FLOWMODUS_REASON" flowmodus-reason 15 || exit 1

echo "[6/7] anaphase  :$PORT_ANAPHASE"
spawn anaphase "$WS/anaphase-helix" \
  env ANAPHASE_CONFIG="$WS/anaphase-helix/config.toml" "$ANA_BIN"
wait_port "$PORT_ANAPHASE" anaphase 25 || exit 1

echo "[7/7] panel     :$PORT"
spawn panel "$WS/Cellrix" "$PANEL_BIN" --port "$PORT" \
  --flowmodus-url "http://127.0.0.1:$FLOW_PORT"
wait_port "$PORT" panel 20 || exit 1

# --- report ----------------------------------------------------------------
echo
echo "--- what Anaphase actually wired (its own /v1/health) ---"
# Single source of truth: /v1/health is the hub's own physical report of its
# organs. This block used to grep the log instead, and the mind line was a
# FALSE GREEN: when `mind_endpoint` is unset, resolve_memory_adapter takes
# `_ => Arc::new(NoopMemoryAdapter)` and logs NOTHING (adapters/mod.rs:195);
# only "configured but unreachable" warns "mind degraded" (:187). So the script
# printed "OK mind adapter active" while mind was Noop (measured 2026-09-24).
# Absence of a warning is not evidence of a wire.
# python3 is already a harness dependency (verify_live.py / coupling_audit.py),
# and this body carries nested commas that a `tr ','` scan would split wrongly.
HEALTH=$(curl -s --noproxy '*' -m 8 "http://127.0.0.1:$PORT_ANAPHASE/v1/health" 2>/dev/null || true)
if [ -z "$HEALTH" ]; then
  echo "  WARN  /v1/health unreachable — cannot tell what is wired (do NOT read this as ready)"
else
  printf '%s' "$HEALTH" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for c in d.get("checks", []):
    cfg, ok = c.get("configured"), c.get("ok")
    if not cfg:
        tag = "NOT-CONFIGURED (silent Noop)"
    elif ok:
        tag = "ok"
    else:
        tag = "BAD"
    print("  %-22s configured=%-5s ok=%-5s %s"
          % (c.get("name"), str(cfg).lower(), str(ok).lower(), tag))
print("  %-22s %s" % ("governance.state", d.get("governance", {}).get("state")))
'
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
