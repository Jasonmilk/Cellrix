# 三个可自按的验收入口（cwd 见每块第一行）

## ⓪「真上游到底配了没」——一行判定（不回显 key）

```bash
cd "${REPO_ROOT:-$HOME/Developer/Jasonmilk}/Cellrix"
bash tools/check_upstream.sh; echo "rc=$?"
# 期望形状：NO   config.toml 里没有 reasoning_endpoint（… mtime=…）      rc=1
#            YES  endpoint=https://…  model=…  key=set|none  env=0     rc=0
```

# 三个可自按的验收入口（cwd 见每块第一行）

## ① 重放：同一份 tape 跑两遍，比一字不差

```bash
cd "${REPO_ROOT:-$HOME/Developer/Jasonmilk}/Cellrix"
node tools/l2_casefile.js fixtures/l2-tape-2026-11-05/ring.json fixtures/l2-tape-2026-11-05 ../anaphase-helix/src/run_cycle/mod.rs > /tmp/replay-1.json 2>/dev/null
node tools/l2_casefile.js fixtures/l2-tape-2026-11-05/ring.json fixtures/l2-tape-2026-11-05 ../anaphase-helix/src/run_cycle/mod.rs > /tmp/replay-2.json 2>/dev/null
diff /tmp/replay-1.json /tmp/replay-2.json && echo "diff=0"
shasum -a 256 /tmp/replay-1.json /tmp/replay-2.json
```

## ② 出口那一轮：标准事件 + 证轨页（都可点开/可数）

```bash
cd "${REPO_ROOT:-$HOME/Developer/Jasonmilk}/Cellrix"
# 出口：同一份 tape → 标准事件条数（期望 5）与 D1/D2 判据（期望 rc=0）
"${REPO_ROOT:-$HOME/Developer/Jasonmilk}/anaphase-helix/target/debug/agui" fixtures/l2-tape-2026-11-05/run-752d73d3ed4afb18-p006af8c54e000001.events.jsonl | wc -l
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
cd "${REPO_ROOT:-$HOME/Developer/Jasonmilk}/Cellrix"
git ls-files web | wc -l      # 期望 0
test -d web; echo $?          # 期望 1
```

## ④（可选）你自己产一条新 tape，而不是只信仓里的样本

```bash
cd "${REPO_ROOT:-$HOME/Developer/Jasonmilk}/Cellrix"
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

脚本现在会把整条链跑完，产物都在 `$OUT`：

```
$OUT/events/*.jsonl       本次周期的 tape（10 行，含 turn/start）
$OUT/ring.json            那一轮的事件环（8 事件）
$OUT/casefile.json        案卷（选中边/候选边/支撑读数/未记项）
$OUT/d3.json              6 项对照
$OUT/evidence.html        证轨页（缺口 2 处「本 tape 未记录」）
open /tmp/my-cycle/evidence.html
```

拿到的 tape 也可直接喂 ①②：
```bash
node tools/d1_d2_check.js /tmp/my-cycle/events/<上面选中的那条>.events.jsonl; echo "rc=$?"
node tools/l2_casefile.js /tmp/my-cycle/ring.json /tmp/my-cycle/events ../anaphase-helix/src/run_cycle/mod.rs > /tmp/mine.json 2>/dev/null
```

桩只证明通路，**不是生产上游**；真上游见 `real-upstream-checklist-2026-11-05.md`。

## ⑤ 真上游一轮（本机已跑通 · verdict=Met）

```bash
# 1) 本地推理（OpenAI 兼容 8080）
llama-swap --config ~/llama-swap/config.yaml &

# 2) 工具通道必须带插件目录（不带 ⇒ 注册 0 个工具 ⇒ gRPC NotFound）
cd /Users/jason/Developer/Jasonmilk/helix-tentacle
./target/debug/tentacle --transport grpc --grpc-port 50051 --plugins-dir ./fixtures &

# 3) anaphase 本地 config（gitignored，两行；端口取自 ecosystem/chain.json）
#    reasoning_endpoint = "http://127.0.0.1:8080/v1"
#    tentacle_endpoint  = "http://127.0.0.1:50051"
cd /Users/jason/Developer/Jasonmilk/anaphase-helix
ANAPHASE_SESSION_EVENTS_PATH=/tmp/cycle cargo run -q --all-features --bin anaphase -- --config config.toml &
curl -s -X POST http://127.0.0.1:50061/v1/chat -H 'content-type: application/json' \
  -d '{"message":"Reply with ONLY this JSON in a ```json fence: {\"calls\":[{\"tool\":\"calc\",\"args\":{\"expression\":\"9**9\"},\"expect\":\"ok\"}]}"}'
```

期望形状（本机实测）：
```
reply  'calc: {"ok":true,"result":"387420489"}'   success=true   verdict=Met
tape   tool/call → tool/result{ok:true,55ms} → exec_ok(ok=true) → answer.delivered → verdict Met
       check(phase=hitl) {"allowed_once":1,…}
```

**会误导的三处**：端口取 `ecosystem/chain.json`（ADR-0046）· `/v1/health` 的 `reasoning not configured`
是按 config 字段名判、不代表端点没生效 · 50061 上若有旧 anaphase 实例，它会用**自己的**事件目录应答（先清场）。

完整读数与三个真原因：`helix-mind/docs/helixECO/observations/2026-11-18/first-green-cycle.md`

## ⑥ 园丁三下（可重跑；每条都能自己按）

> 三条入口只写在**这一处**。参数用「当轮目录」占位：把 `<ROUND>` 换成你自己的轮次目录
> （例：`/tmp/round-t2`，里面至少要有 `ring.json` 与 `events/<job>-<period>.events.jsonl`）。

**① 重放：同一份当轮 jsonl 跑两遍，比一字不差**

```bash
cd "${REPO_ROOT:-$HOME/Developer/Jasonmilk}/Cellrix"
R=<ROUND>
node tools/l2_casefile.js "$R/ring.json" "$R/events" ../anaphase-helix/src/run_cycle/mod.rs > "$R/a.json"
node tools/l2_casefile.js "$R/ring.json" "$R/events" ../anaphase-helix/src/run_cycle/mod.rs > "$R/b.json"
diff "$R/a.json" "$R/b.json" && echo "diff=0"
shasum -a 256 "$R/a.json" "$R/b.json"      # 两行哈希应相同
```

**② 页面：点开看留白（数字以命令为准）**

```bash
# 生成（用当轮 casefile）
node tools/d3_compare.js "$R/a.json" > "$R/d3.json"
node tools/l2_render.js "$R/a.json" "$R/d3.json" "$R/evidence.html"
grep -c '本 tape 未记录' "$R/evidence.html"       # 实际值：本轮实测 = 2
open "$R/evidence.html"

# 仓内既有页面（由 fixtures 样本生成）同样是 2 处
grep -c '本 tape 未记录' docs/observations/l2-evidence-2026-11-05.html    # = 2
```

**③ 数地面变化：web/ 是不是 0**

```bash
git ls-files web | wc -l      # 期望 0
test -d web; echo $?          # 期望 1
```

**附：AG-UI 出口折回 L2 的两条查看命令（不新开格子）**

```bash
AGUI="${REPO_ROOT:-$HOME/Developer/Jasonmilk}/anaphase-helix/target/debug/agui"
"$AGUI" "$R"/events/*.events.jsonl | wc -l                 # 标准事件条数（本轮实测 5）
node tools/d1_d2_check.js "$R"/events/*.events.jsonl       # D1/D2 rc（本轮实测 0）
```

**读数口径（贴在入口处，避免被读成完成）**：`diff=0` / `agui=5` / `D1·D2 rc=0` / `tool-call` / `Met` / `HITL`
**都只是当轮读数**。同一输入在不同 period 可以分别是「用了工具答对」与「没用工具答错」，
所以它们不构成能力断言，也不构成完成判据。
