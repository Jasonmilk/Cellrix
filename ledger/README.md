# ledger/ · 三本账之一（append-only）

承 phyt-DNA `template/ledger/README.md`，**规则不另立**：

* **只追加，永不改写**。纠正 = 追加一条 `verdict: correction` 的新记录
* `kind` 必填：`task` | `probe` | `scan` | `selftest` | `sim` | `correction`
* **生产指标只算 `kind: task`**（探针 / 扫描 / 自检 / 模拟不计入）
* 断言的 schema：`{"ts","gate_id","task","verdict","kind","source","event_id","note",…}`

## 为什么 Cellrix 需要它（本会话换来的理由）

harness 每次打印的那句 **"this count is read from a HAND-WRITTEN table, so it is self-declared —
structurally a claim, not evidence"**，就是这本账要替掉的东西：
手写的 `CRITERIA-INVENTORY.md` 是**声明**，`hits-*.jsonl` 是**生成物** ⇒ 后者才是证据。

## 独立申诉账

`appeals-<年>.jsonl` —— 破解"运营者自己分类自己"的自证陷阱（承模板）。
