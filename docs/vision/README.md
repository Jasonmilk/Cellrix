# vision/ —— VISION 的**被委派产物**（不是第二份愿景）

`docs/VISION.md`（v3.1）头部第 4 行**声明了分层**：

> *"本文件定义「为什么与是什么」；**机制细节、逐格验收归入 v12 / DAG v5.0**；决策历史归入 ADR。"*

**在本次落实之前，这两个被委派的产物**不在仓库里** ⇒ 委派无处可去 ⇒ 所有内容只能留在 VISION.md ⇒ "挤"。
本目录补上它们，使委派可解。**

| 文件 | 是什么 | 来源 |
|---|---|---|
| `architecture-v12.html` | **架构研讨图 v12**（Ω 元公理 · 里程碑目标导向） | 落入前位于工作区 `Cellrix update/`，未入库 |
| `dag-v5.0-milestones.md` | **DAG v5.0 · 里程碑与验收标准**（其标题自述："DAG 版 v5.0（目标导向）"） | 同上 |
| `cppc-v1.1.0.md` | 既有（协议卡） | 已在库 |

**纪律（承 VISION，不在本目录另立）**：**不允许第二份清单**（A5）。
本文件只作**指针与来源说明**，不复制、不重述 v12 / DAG 的内容；冲突时以 `docs/VISION.md` 为准。

**未落**（另议）：`Cellrix update/` 里另有四个验收器脚本
（`cellrix_dag_verify.py` · `cellrix_logic_verify.py` · `cellrix_mutants.py` · `cellrix_mutate_artifacts.py`）——
它们对应 VISION 说的 **"判据真跑"**，应落在 `tools/` 并**实际跑通**再入库（未跑通的不入库）。
