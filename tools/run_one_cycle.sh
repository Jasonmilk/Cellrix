#!/usr/bin/env bash
# 自己跑一轮（不依赖别人抓的 tape）：起本地桩 LLM + 起 anaphase + 喂一轮 + 收 tape/ring。
# 桩只证明"通路"，**不是生产上游**。真上游接入见 docs/observations/real-upstream-checklist-2026-11-05.md
# 用法：bash tools/run_one_cycle.sh [输出目录]
set -uo pipefail
OUT="${1:-/tmp/cycle-$(date +%Y%m%d-%H%M%S)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ANA="$(cd "$HERE/../../anaphase-helix" && pwd)"
STUB_PORT="${STUB_PORT:-19999}"; SVC_PORT="${SVC_PORT:-50061}"
mkdir -p "$OUT/events"; fail=0
cleanup(){ [ -n "${SVC_PID:-}" ] && kill "$SVC_PID" 2>/dev/null; [ -n "${STUB_PID:-}" ] && kill "$STUB_PID" 2>/dev/null; }
trap cleanup EXIT

# 端口若有旧实例（未开 session_events 的那种）会冒充成功 ⇒ 先清场
for port in "$STUB_PORT" "$SVC_PORT"; do pid=$(lsof -t -i :$port 2>/dev/null); [ -n "$pid" ] && kill $pid 2>/dev/null; done
sleep 1

# cargo 可能不在非交互 shell 的 PATH 上（rustup）⇒ 显式解析并前置
CARGO_BIN="$(command -v cargo 2>/dev/null || rustup which cargo 2>/dev/null || true)"
[ -n "$CARGO_BIN" ] || { echo "★ FAIL: 找不到 cargo（先装 rustup 或在 PATH 里导出）"; exit 3; }
export PATH="$(dirname "$CARGO_BIN"):$PATH"

echo "① 起桩 LLM :$STUB_PORT"
python3 "$HERE/stub_llm.py" "$STUB_PORT" >/dev/null 2>&1 & STUB_PID=$!
sleep 1
curl -s -m 3 -o /dev/null -w "   stub http=%{http_code}\n" -X POST "http://127.0.0.1:$STUB_PORT/chat/completions" -d '{}' || fail=1

echo "② 起 anaphase :$SVC_PORT（events → $OUT/events）"
( cd "$ANA" && ANAPHASE_REASONING_ENDPOINT="http://127.0.0.1:$STUB_PORT" ANAPHASE_REASONING_MODEL=stub \
  ANAPHASE_SESSION_EVENTS_PATH="$OUT/events" cargo run -q --all-features --bin anaphase -- --config config.toml >"$OUT/svc.log" 2>&1 ) & SVC_PID=$!
up=0
for i in $(seq 1 60); do
  if curl -s -m 2 "http://127.0.0.1:$SVC_PORT/v1/health" | grep -q '"'; then up=1; break; fi
  sleep 1
done
[ "$up" = 1 ] || { echo "★ FAIL: anaphase 60s 内没起来（见 $OUT/svc.log）"; tail -3 "$OUT/svc.log"; exit 1; }
echo "   health ok"

echo "③ 喂一轮"
curl -s -m 40 -X POST "http://127.0.0.1:$SVC_PORT/v1/chat" -H 'content-type: application/json' -d '{"message":"use a tool: compute 12^12"}' > "$OUT/chat.json"
head -c 140 "$OUT/chat.json"; echo
sleep 2   # 等事件流 flush
echo "④ 收 ring"
curl -s -m 10 "http://127.0.0.1:$SVC_PORT/v1/agent/events" > "$OUT/ring.json"

echo "⑤ 读数"
JOB=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("job_id",""))' "$OUT/chat.json" 2>/dev/null)
# ★ 一个目录里可能有两条流：本次周期的 10 行 + rails 演示的 3 行（后者没有 turn/start）。
#   选 tape 必须按内容选（含 turn/start），不能拿 glob 第一个 —— 否则量错了对象。
f=$(grep -l '"type":"turn/start"' "$OUT"/events/*.jsonl 2>/dev/null | head -1)
[ -n "${f:-}" ] || f=$(ls -S "$OUT"/events/*.jsonl 2>/dev/null | head -1)
echo "   job_id=${JOB:-?} · jsonl=$(basename "${f:-none}") · 行数=$(wc -l < "${f:-/dev/null}" 2>/dev/null | tr -d ' ')"
echo "   ring 事件=$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["events"]))' "$OUT/ring.json" 2>/dev/null || echo '?')"
if [ -n "${f:-}" ]; then
  echo "   tape 选中=$(basename "$f")（含 turn/start）"
  echo "   agui 标准事件=$("$ANA/target/debug/agui" "$f" 2>/dev/null | wc -l | tr -d ' ')"
  ( cd "$HERE/.." && node tools/d1_d2_check.js "$f" >/dev/null 2>&1 ) && echo "   D1/D2 rc=0" || { echo "   ★ FAIL: D1/D2 rc≠0"; fail=1; }
else
  echo "   ★ FAIL: 没找到含 turn/start 的 tape"; fail=1
fi
[ -n "${f:-}" ] && [ -s "$OUT/ring.json" ] || { echo "★ FAIL: 没收到 tape/ring"; fail=1; }
echo "⑥ 用这条 tape 生成证轨页（同一条链，不另取数）"
CX="$(cd "$HERE/.." && pwd)"
if [ -n "${f:-}" ]; then
  ( cd "$CX" && node tools/l2_casefile.js "$OUT/ring.json" "$OUT/events" "$ANA/src/run_cycle/mod.rs" > "$OUT/casefile.json" 2>/dev/null \
    && node tools/d3_compare.js "$OUT/casefile.json" > "$OUT/d3.json" 2>/dev/null \
    && node tools/l2_render.js "$OUT/casefile.json" "$OUT/d3.json" "$OUT/evidence.html" 2>/dev/null ) \
    && echo "   页面：$OUT/evidence.html · 缺口标注=$(grep -c '本 tape 未记录' "$OUT/evidence.html" 2>/dev/null || echo 0) 处" \
    || { echo "   ★ FAIL: 页面生成失败"; fail=1; }
fi

echo "── 产物目录：$OUT（tape/ ring.json casefile.json d3.json evidence.html）"
exit $fail
