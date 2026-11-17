# 接真上游所需（一次性清单，不含推测值）

> 依据：`anaphase-helix/src/config.rs` 与 `src/adapters/http_reasoning.rs` 的实际读取点。
> 只列**代码里真的存在**的键；不写"大概叫 xx"。

## 1. 配置键（config.toml 的 `[anaphase]` 段）

```toml
[anaphase]
reasoning_endpoint = "https://<你的网关>"      # 必填：base URL（不含 /chat/completions）
reasoning_model    = "<模型 id>"                # 必填：调用方声明，优先于 Auto
reasoning_api_key  = "<key>"                    # 可选：给了就发 Authorization: Bearer
```

## 2. 环境变量（覆盖 config）

```
ANAPHASE_REASONING_ENDPOINT="https://<网关>"
ANAPHASE_REASONING_MODEL="<模型 id>"
# ⚠️ api_key 没有 env 变体（config.rs 只在 take() 里列了 endpoint/model）
#    ⇒ key 只能写进 config.toml（或由你的网关做免鉴权）
```

## 3. 协议形状（适配器实际调用）

```
POST {reasoning_endpoint}/chat/completions
Content-Type: application/json
Authorization: Bearer <reasoning_api_key>        # 仅当配置了 key

{"model":"<model>","messages":[{"role":"system","content":"..."},{"role":"user","content":"..."}]}
```

流式与非流式都支持（`choices[0].delta` 与 `choices[0].message` 两条读法都在代码里）。

## 4. 回包字段（缺一个就会退化成空回复 ⇒ impasse）

```
choices[0].message.content            # 正文
choices[0].message.reasoning_content  # 思考（可选，缺失不影响）
choices[0].message.tool_calls[]       # 工具调用（**要走到授权段必须有它**）
  .id / .type="function" / .function.name / .function.arguments(JSON 字符串)
```

## 5. 最小联调（你自己跑，不经 anaphase）

```bash
curl -sS -X POST "$ENDPOINT/chat/completions" \
  -H 'content-type: application/json' \
  ${KEY:+-H "Authorization: Bearer $KEY"} \
  -d '{"model":"'"$MODEL"'","messages":[{"role":"user","content":"Use a tool to compute 7^9"}]}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); m=d["choices"][0]["message"]; print("content:",repr(m.get("content"))[:80]); print("tool_calls:",[t["function"]["name"] for t in (m.get("tool_calls") or [])])'
```

期望：`tool_calls` 非空。**空列表就说明该模型不会自己发起工具调用 ⇒ 授权段仍走不到**（这本身是读数）。

## 6. 我需要你提供的（我不想猜的部分）

```
① endpoint base URL（是否 OpenAI-compatible；不是的话给一份等价 curl 示例）
② model id
③ 是否需要 key（以及 key 走 config.toml 可以吗——env 无 api_key 变体）
④ 该模型是否会自动发起 tool_calls（若不，需不需要我在提示里显式要求）
```

## 7. 如果你"写了却没生效"——四种可能，各一条判定命令

> 实测记录：连续 4 次检查 `anaphase-helix/config.toml` 的 mtime 仍是 `Oct 9 13:48`、
> `reasoning_endpoint` 计数 0、环境变量 0、全仓 toml 里也没有该键。按下面四步自查一遍。

```bash
# ① 是不是改错了文件（config.toml vs config.toml.example vs 别处的副本）
ls -l anaphase-helix/config.toml anaphase-helix/config.toml.example 2>/dev/null
grep -c '^\s*reasoning_endpoint' anaphase-helix/config.toml      # 期望 1；0 = 没落盘

# ② 是不是没保存（mtime 应是你编辑的时刻，不是 Oct 9）
ls -l anaphase-helix/config.toml | awk '{print $6,$7,$8}'

# ③ 是不是写错段（必须在 [anaphase] 段里；写到 [api] 下会被忽略）
awk '/^\[/{sec=$0} /reasoning_endpoint/{print sec": "$0}' anaphase-helix/config.toml

# ④ 是不是重复键（TOML 严格：同一个键写两次 ⇒ 服务直接退出，报 duplicate key）
grep -c '^\s*reasoning_model' anaphase-helix/config.toml         # >1 = 重复，会 TomlError
```

**一键判定**（本仓已有）：

```bash
bash tools/check_upstream.sh; echo rc=$?
# YES … ⇒ 已落盘（继续跑 run_one_cycle --config-upstream）
# NO  … ⇒ 未落盘（按上面四步查；不要靠"我记得写了"）
```

## 8. 三条可直接粘贴的写入命令（本地实测过，key 不经过对话）

> 命令只在 **`[anaphase]` 段内**插入，且**插完自检**。把 `<网关>` / `<tentacle>` 换成真值；
> 需要 key 的那行由你自己在编辑器里加（`reasoning_api_key = "…"`），不要贴进对话。

```bash
cd /Users/jason/Developer/Jasonmilk/anaphase-helix
cp config.toml config.toml.bak-$(date +%Y%m%d-%H%M%S)

# ① 写 reasoning_endpoint（在 [anaphase] 段内插一行）
awk '/^\[/{insub=($0 ~ /^\[anaphase\]/)} {print} insub && !d && /^\[anaphase\]/{print "reasoning_endpoint = \"https://<网关>\""; d=1}' \
  config.toml > config.toml.new && mv config.toml.new config.toml

# ② 写 tentacle_endpoint（同上；缺它则 pipeline Unbound，tool/call 恒 0）
awk '/^\[/{insub=($0 ~ /^\[anaphase\]/)} {print} insub && !d && /^\[anaphase\]/{print "tentacle_endpoint = \"grpc://<tentacle>\""; d=1}' \
  config.toml > config.toml.new && mv config.toml.new config.toml

# ③ 自检（段位 + 落盘 + 就绪）
awk '/^\[/{s=$0} /reasoning_endpoint|tentacle_endpoint/{print s" :: "$0}' config.toml
cd ../../Cellrix && bash tools/check_upstream.sh; echo "rc=$?"
# 期望：两行都在 [anaphase] 下 · YES … ⇒ 工具段第二道前置已具备 · rc=0
```

**实测记录**：上述 awk 在 `config.toml` 的副本上跑过，插入结果确在 `[anaphase]` 段内；
`check_upstream.sh`（用 `ANAPHASE_DIR` 指向副本）报 `YES … rc=0`。
**它不会防止你写重复键** —— 若已存在同名键，请手工改而不是追加（TOML 会 `duplicate key` 直接退出）。
