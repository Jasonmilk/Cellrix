# 三个可自按的验收入口（cwd 见每块第一行）

## ① 重放：同一份 tape 跑两遍，比一字不差

```bash
cd /Users/jason/Developer/Jasonmilk/Cellrix
node tools/l2_casefile.js fixtures/l2-tape-2026-11-05/ring.json fixtures/l2-tape-2026-11-05 ../anaphase-helix/src/run_cycle/mod.rs > /tmp/replay-1.json 2>/dev/null
node tools/l2_casefile.js fixtures/l2-tape-2026-11-05/ring.json fixtures/l2-tape-2026-11-05 ../anaphase-helix/src/run_cycle/mod.rs > /tmp/replay-2.json 2>/dev/null
diff /tmp/replay-1.json /tmp/replay-2.json && echo "diff=0"
shasum -a 256 /tmp/replay-1.json /tmp/replay-2.json
```

## ② 出口那一轮：标准事件 + 证轨页（都可点开/可数）

```bash
cd /Users/jason/Developer/Jasonmilk/Cellrix
# 出口：同一份 tape → 标准事件条数（期望 5）与 D1/D2 判据（期望 rc=0）
/Users/jason/Developer/Jasonmilk/anaphase-helix/target/debug/agui fixtures/l2-tape-2026-11-05/run-752d73d3ed4afb18-p006af8c54e000001.events.jsonl | wc -l
node tools/d1_d2_check.js fixtures/l2-tape-2026-11-05/run-752d73d3ed4afb18-p006af8c54e000001.events.jsonl; echo "rc=$?"

# 证轨页（重新生成后点开）
node tools/l2_casefile.js fixtures/l2-tape-2026-11-05/ring.json fixtures/l2-tape-2026-11-05 ../anaphase-helix/src/run_cycle/mod.rs > docs/observations/l2-casefile-2026-11-05.json 2>/dev/null
node tools/d3_compare.js docs/observations/l2-casefile-2026-11-05.json > docs/observations/l2-d3-compare-2026-11-05.json 2>/dev/null
node tools/l2_render.js docs/observations/l2-casefile-2026-11-05.json docs/observations/l2-d3-compare-2026-11-05.json docs/observations/l2-evidence-2026-11-05.html
grep -c '本 tape 未记录' docs/observations/l2-evidence-2026-11-05.html
open docs/observations/l2-evidence-2026-11-05.html

# 反向：把缺口填成有值 ⇒ 标注数应减少、页面应变化（期望 rc=0 且打印 2→1）
node tools/l2_render_test.js
```

## ③ 数地面变化：web/ 是不是 0

```bash
cd /Users/jason/Developer/Jasonmilk/Cellrix
git ls-files web | wc -l      # 期望 0
test -d web; echo $?          # 期望 1
```

## ④（可选）你自己产一条新 tape，而不是只信仓里的样本

```bash
cd /Users/jason/Developer/Jasonmilk/Cellrix
bash tools/run_one_cycle.sh /tmp/my-cycle
```

读期望形状（每次运行的数字可变）：
```
job_id=run-… · jsonl=…-p….events.jsonl · 行数=10
ring 事件=8
tape 选中=…（含 turn/start）      ← 必须选含 turn/start 那条（目录里另有一条 rails 演示的 3 行流）
agui 标准事件=5
D1/D2 rc=0
── 产物目录：/tmp/my-cycle
```

拿到的 tape 可直接喂 ①②：
```bash
node tools/d1_d2_check.js /tmp/my-cycle/events/<上面选中的那条>.events.jsonl; echo "rc=$?"
node tools/l2_casefile.js /tmp/my-cycle/ring.json /tmp/my-cycle/events ../anaphase-helix/src/run_cycle/mod.rs > /tmp/mine.json 2>/dev/null
```

桩只证明通路，**不是生产上游**；真上游见 `real-upstream-checklist-2026-11-05.md`。
