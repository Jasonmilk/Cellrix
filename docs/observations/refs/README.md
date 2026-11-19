# refs/ — 外部规范的**本地副本**（只读证据，不是我们的实现）

用途：让「我们与官方协议差在哪」这句话**可复跑**，而不是靠会话里贴过一段话。

| 文件 | 来源（取用命令） | sha256（前 16） |
|---|---|---|
| `ag-ui-1.0-schema.json` | `curl -sSL https://docs.ag-ui.com/spec/1.0/schema.json -o ag-ui-1.0-schema.json` | `4b5c93226838a0e7`（96 KB · `$defs` 98） |
| `ag-ui-README.md` | `curl -sSL https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/main/README.md -o ag-ui-README.md` | `667422d2a16f79ba`（19,476 B） |
| `ag-ui-EventType.java` | `curl -sSL https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/main/sdks/community/java/ag-ui/core/src/main/java/com/agui/community/core/event/EventType.java -o ag-ui-EventType.java` | `9e1cce4a1d2c8b1b` |

取用时间：2026-11-19 / README 2026-11-20。**基准以 `ag-ui-1.0-schema.json` 为准**；`ag-ui-EventType.java` 只作旁证（它比 schema 少 SUBAGENT_* 3 类、多 META_EVENT 之差 —— 两个官方工件本身不同步）。**不随上游自动更新**；要更新就重跑上面的命令并改本表（旧的 sha 留在提交历史里）。

## 边界（免得把副本当成合规证明）

```
· 这两个文件是**证据**，不是我们的 schema：我们的投影仍写在 anaphase-helix/src/agui.rs，
  自有子集仍叫 agui-1.0-min（那是自称，不与官方版本号互证）。
· 官方 schema 每个事件定义带 `unevaluatedProperties: false`（文件内 73 处）
  ⇒ **额外键会被拒**，不是"未见禁止"。
· 校验器我们**没有官方实现**；任何"通过/不通过"的读数都要写明用的是哪个最小校验器。
```
