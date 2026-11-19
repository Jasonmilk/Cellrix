#!/usr/bin/env bash
# 自己跑一轮（不依赖别人抓的 tape）：起本地桩 LLM + 起 anaphase + 喂一轮 + 收 tape/ring。
# 桩只证明"通路"，**不是生产上游**。真上游接入见 docs/observations/real-upstream-checklist-2026-11-05.md
# 用法：bash tools/run_one_cycle.sh [输出目录]
set -uo pipefail
MODE=stub; OUT=""; PROMPT="compute 9^9"
while [ $# -gt 0 ]; do
  case "$1" in
    --config-upstream) MODE=config; shift ;;
    --prompt) PROMPT="${2:-}"; shift 2 ;;
    *) OUT="$1"; shift ;;
  esac
done
OUT="${OUT:-/tmp/cycle-$(date +%Y%m%d-%H%M%S)}"
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

if [ "$MODE" = config ]; then
  echo "① 上游：用 anaphase/config.toml（不启桩）"
  # B1-k（2026-11-19）：原来**只认 config.toml**，而 `src/config.rs:473` 是 env 覆盖 config
  # ⇒ "config 没这行、env 有"这种**已接通**的情形被这里判 UNMEASURABLE/exit 4（与 B1-j 同一个错的第二处）。
  if grep -qE '^[[:space:]]*reasoning_endpoint[[:space:]]*=' "$ANA/config.toml" 2>/dev/null; then
    echo "   reasoning_endpoint 来源：config.toml（脱敏不打印）"
  elif [ -n "${ANAPHASE_REASONING_ENDPOINT:-}" ]; then
    echo "   reasoning_endpoint 来源：ANAPHASE_REASONING_ENDPOINT（脱敏不打印）"
  else
    echo "   UNMEASURABLE: config.toml 与 ANAPHASE_REASONING_ENDPOINT 都没有 ⇒ 无法接真上游（不是通过）"
    exit 4
  fi
  REASONING_ENV=()
else
  echo "① 起桩 LLM :$STUB_PORT（仅证明通路，不是生产上游）"
  python3 "$HERE/stub_llm.py" "$STUB_PORT" >/dev/null 2>&1 & STUB_PID=$!
  sleep 1
  curl -s -m 3 -o /dev/null -w "   stub http=%{http_code}\n" -X POST "http://127.0.0.1:$STUB_PORT/chat/completions" -d '{}' || fail=1
  # 必须是**多个参数**：`env "A=1 B=2"` 会被当成一个变量值（实测导致 endpoint 丢失 ⇒ 适配器 builder error）
  REASONING_ENV=(ANAPHASE_REASONING_ENDPOINT="http://127.0.0.1:$STUB_PORT" ANAPHASE_REASONING_MODEL=stub)
fi

echo "② 起 anaphase :$SVC_PORT（events → $OUT/events）"
( cd "$ANA" && env "${REASONING_ENV[@]}" ANAPHASE_SESSION_EVENTS_PATH="$OUT/events" \
  cargo run -q --all-features --bin anaphase -- --config config.toml >"$OUT/svc.log" 2>&1 ) & SVC_PID=$!
up=0
for i in $(seq 1 60); do
  if curl -s -m 2 "http://127.0.0.1:$SVC_PORT/v1/health" | grep -q '"'; then up=1; break; fi
  sleep 1
done
[ "$up" = 1 ] || { echo "★ FAIL: anaphase 60s 内没起来（见 $OUT/svc.log）"; tail -3 "$OUT/svc.log"; exit 1; }
echo "   health ok"

echo "③ 喂一轮"
curl -s -m 40 -X POST "http://127.0.0.1:$SVC_PORT/v1/chat" -H 'content-type: application/json' \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"message":sys.argv[1]}))' "$PROMPT")" > "$OUT/chat.json"
head -c 140 "$OUT/chat.json"; echo
sleep 2   # 等事件流 flush
echo "④ 收 ring"
curl -s -m 10 "http://127.0.0.1:$SVC_PORT/v1/agent/events" > "$OUT/ring.json"

echo "⑤ 读数"
JOB=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("job_id",""))' "$OUT/chat.json" 2>/dev/null)
# ★ 一个目录里可能有两条流：本次周期的 10 行 + rails 演示的 3 行（后者没有 turn/start）。
#   选 tape 必须按内容选（含 turn/start），不能拿 glob 第一个 —— 否则量错了对象。
# B1-o（2026-11-19）：下一行注释说"另一条流没有 turn/start" —— **今天不成立**：
# 启动 anaphase 会先写一个**苏醒 period**（session_notes，config.rs:114 P10c T1），它**也含 turn/start**
# （实测 /tmp/roc1：000000 6 行 + 000001 9 行，两份都有 turn/start）。
# 所以"按含 turn/start 选"会退化成 glob 字典序。认轮必须用**本次 POST 返回的 job_id**（本脚本已解析 JOB）。
f=""
if [ -n "${JOB:-}" ]; then
  for c in "$OUT"/events/*.jsonl; do
    [ -f "$c" ] || continue
    if head -1 "$c" | grep -q "\"job_id\":\"$JOB\""; then f="$c"; break; fi
  done
  [ -n "${f:-}" ] && echo "   tape 按 job_id 钉住（$JOB）"
fi
if [ -z "${f:-}" ]; then
  f=$(grep -l '"type":"turn/start"' "$OUT"/events/*.jsonl 2>/dev/null | head -1)
  [ -n "${f:-}" ] && echo "   ⚠ 未按 job_id 钉住 ⇒ 退化为『含 turn/start 的第一个』（可能是苏醒轮）"
fi
[ -n "${f:-}" ] || f=$(ls -S "$OUT"/events/*.jsonl 2>/dev/null | head -1)
echo "   本目录 period 数=$(ls "$OUT"/events/*.events.jsonl 2>/dev/null | wc -l | tr -d ' ')（>1 表示含苏醒轮）"
echo "   job_id=${JOB:-?} · jsonl=$(basename "${f:-none}") · 行数=$(wc -l < "${f:-/dev/null}" 2>/dev/null | tr -d ' ')"
echo "   ring 事件=$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["events"]))' "$OUT/ring.json" 2>/dev/null || echo '?')"
if [ -n "${f:-}" ]; then
  echo "   tape 选中=$(basename "$f")（含 turn/start）"
  if [ ! -x "$ANA/target/debug/agui" ]; then
    echo "   ★ FAIL: 缺 $ANA/target/debug/agui（先 cargo build --all-features --bin agui）"; fail=1
  else
    # B1-k 附：`agui | wc -l` 在 agui 崩溃时给出 **0**（读到空）⇒ 先取 rc 再数
    ag_out=$("$ANA/target/debug/agui" "$f" 2>/dev/null); ag_rc=$?
    if [ "$ag_rc" -eq 0 ]; then
      echo "   agui 标准事件=$(printf '%s\n' "$ag_out" | grep -c . )"
    else
      echo "   agui 标准事件=UNMEASURABLE（agui rc=$ag_rc，不是 0 条）"
    fi
  fi
  ( cd "$HERE/.." && node tools/d1_d2_check.js "$f" >/dev/null 2>&1 ) && echo "   D1/D2 rc=0" || { echo "   ★ FAIL: D1/D2 rc≠0"; fail=1; }
else
  echo "   ★ FAIL: 没找到含 turn/start 的 tape"; fail=1
fi
[ -n "${f:-}" ] && [ -s "$OUT/ring.json" ] || { echo "★ FAIL: 没收到 tape/ring"; fail=1; }
if [ -n "${f:-}" ]; then
  tc=$(grep -c '"type":"tool/call"' "$f" 2>/dev/null); [ -n "${tc:-}" ] || tc=UNMEASURABLE
  tr=$(grep -c '"type":"tool/result"' "$f" 2>/dev/null); [ -n "${tr:-}" ] || tr=UNMEASURABLE
  md=$(python3 -c "
import json,sys
for l in open(sys.argv[1],encoding='utf-8'):
    d=json.loads(l)
    if d.get('type')=='assistant/usage':
        print((d.get('data') or {}).get('model') or 'null'); break
else: print('none')" "$f" 2>/dev/null || echo '?')
  # 本轮到底跑成没跑成：impasse / reasoning 报错必须露出来（否则"通路 OK"会掩盖"没跑成"）
  python3 - "$f" <<'PY2'
import json,sys
imp=None; err=None
for l in open(sys.argv[1],encoding='utf-8'):
    d=json.loads(l); t=d.get('type'); dd=d.get('data') or {}
    if t=='turn/end': imp=dd.get('impasse')
    if t=='assistant/attempt' and dd.get('error'): err=dd.get('error')
byp=None
for l in open(sys.argv[1],encoding='utf-8'):
    d=json.loads(l)
    if d.get('type') in ('assistant/reply','turn/end'):
        b=(d.get('data') or {}).get('bypass')
        if b: byp=b
print("⑤c 本轮结果：impasse=%s%s%s" % (imp, ("  reasoning_error=%s" % err) if err else "",
      ("  bypass=%s（上游未被调用 ⇒ 通路未验证）" % byp) if byp else ""))
if imp: sys.exit(1)
PY2
  rc_cycle=$?; [ "$rc_cycle" = 0 ] || { echo "   ★ 本轮未跑成（impasse）⇒ 通路读数不可当作"跑通一轮""; fail=1; }

  echo "⑤b 工具段：tool/call=$tc · tool/result=$tr · model=$md  （0 表示本轮未走工具段；这是读数不是结论）"
fi

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
