#!/usr/bin/env bash
# 一键跑完三个验收入口；任何一项失败即非零退出（不是打印 PASS 了事）。
# 用法：bash tools/accept_all.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 3
TAPE=fixtures/l2-tape-2026-11-05
EV=$TAPE/run-752d73d3ed4afb18-p006af8c54e000001.events.jsonl
AGUI=../anaphase-helix/target/debug/agui
fail=0

# ── 预检：三道门（只读；缺就具名，不判红也不判绿）
ANA="$(cd "${ANAPHASE_DIR:-../anaphase-helix}" 2>/dev/null && pwd)"
# 可注入（喂夹具）：默认读 anaphase 仓内 config；测试可用 ANAPHASE_CONFIG 指向别处
CFG="${ANAPHASE_CONFIG:-$ANA/config.toml}"
if [ -n "${ANA:-}" ] && [ -f "$CFG" ]; then
  grep -qE '^[[:space:]]*tentacle_endpoint[[:space:]]*=' "$CFG" 2>/dev/null && g2="已配置" || g2="缺（pipeline Unbound）"
  grep -qE '^[[:space:]]*reasoning_endpoint[[:space:]]*=' "$CFG" 2>/dev/null && g3="已配置" || g3="缺（无上游）"
  echo "── 两道门（预检，只读；2026-11-16 纠正：原先的'①适配器不读 tool_calls'是桩形状错）"
  echo "   ① 上游 reasoning_endpoint : $g3"
  echo "   ② 执行点 tentacle_endpoint: $g2"
fi

if [ ! -d "$TAPE" ]; then
  echo "── ① 重放：UNMEASURABLE（缺 tape 夹具 $TAPE）"
  echo "   先: bash tools/run_one_cycle.sh /tmp/my-cycle 然后把它拷进 fixtures/"
  exit 4
fi

echo "── ① 重放（同一 tape 两遍）"
node tools/l2_casefile.js $TAPE/ring.json $TAPE ../anaphase-helix/src/run_cycle/mod.rs > /tmp/replay-1.json 2>/dev/null
node tools/l2_casefile.js $TAPE/ring.json $TAPE ../anaphase-helix/src/run_cycle/mod.rs > /tmp/replay-2.json 2>/dev/null
if diff -q /tmp/replay-1.json /tmp/replay-2.json >/dev/null; then
  echo "   diff=0 · sha=$(shasum -a 256 /tmp/replay-1.json | cut -c1-16)"
else echo "   ★ FAIL: 两次输出不一致"; fail=1; fi

# 出口判据依赖 anaphase 的 agui 二进制；缺失时**具名不可量**，不是报"期望5条"那种误导性 FAIL
if [ ! -x "$AGUI" ]; then
  echo "── ② 出口：UNMEASURABLE（找不到 $AGUI）"
  echo "   先: (cd ../anaphase-helix && cargo build --all-features --bin agui)"
  exit 4
fi

echo "── ② 出口（标准事件 + D1/D2）"
n=$($AGUI "$EV" 2>/dev/null | wc -l | tr -d ' ')
echo "   事件条数=$n"
[ "$n" = "5" ] || { echo "   ★ FAIL: 期望 5 条"; fail=1; }
node tools/d1_d2_check.js "$EV" >/dev/null 2>&1 || { echo "   ★ FAIL: D1/D2 rc≠0"; fail=1; }

echo "── ②b 页面（缺口留白 + 反向）"
node tools/l2_casefile.js $TAPE/ring.json $TAPE ../anaphase-helix/src/run_cycle/mod.rs > docs/observations/l2-casefile-2026-11-05.json 2>/dev/null
node tools/d3_compare.js docs/observations/l2-casefile-2026-11-05.json > docs/observations/l2-d3-compare-2026-11-05.json 2>/dev/null
node tools/l2_render.js docs/observations/l2-casefile-2026-11-05.json docs/observations/l2-d3-compare-2026-11-05.json docs/observations/l2-evidence-2026-11-05.html 2>/dev/null
g=$(grep -c '本 tape 未记录' docs/observations/l2-evidence-2026-11-05.html || true)
echo "   缺口标注=$g 处 · $(wc -c < docs/observations/l2-evidence-2026-11-05.html | tr -d ' ') 字节"
[ "${g:-0}" -ge 2 ] || { echo "   ★ FAIL: 缺口标注少于 2"; fail=1; }
node tools/l2_render_test.js >/dev/null 2>&1 || { echo "   ★ FAIL: 反向检查（填值后页面应变化）"; fail=1; }

echo "── ③ web/ 地面"
w=$(git ls-files web | wc -l | tr -d ' ')
echo "   git ls-files web = $w · test -d web ⇒ $(test -d web; echo $?)"
[ "$w" = "0" ] || { echo "   ★ FAIL: web 仍有跟踪文件"; fail=1; }

echo "── 结果：$([ $fail = 0 ] && echo '三项均通过（读数如上，不是结论）' || echo '★ 有失败项')"
exit $fail
