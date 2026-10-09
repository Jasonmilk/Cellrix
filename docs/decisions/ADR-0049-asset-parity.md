# ADR-0049：构建产物必须逐字节携带源资产

---
id: ADR-0049-asset-parity
seq: 0049
status: accepted
hard: true
applies-to: ["web/assets/*.js"]
effective-from: 2026-10-09
timing: post
redtest: "bash tools/validate.sh --probe ADR-0049-asset-parity"
revisit-on: 2027-04-09
expires-on: null
owner: "@jason"
origin: "真实经历：本会话两次因资产陈旧而误判 —— 一次是面板服务了旧的嵌入页，一次是我用 mtime 做旧骗过了旧判据"
risk: normal
check: |
  node web/tests/asset_parity_test.js >/dev/null 2>&1 || echo "资产未被构建产物携带（stale include_str! 嵌入）"
last-hit: null
hit-count: 0
supersedes: null
---

## 真实经历

本会话两次同族现身：

1. 面板服务了**旧的嵌入页**（资产是 `include_str!` 编译期嵌入，改完资产不重建就看不到）；
2. 我写的**第一版判据比对 mtime** —— 而 mtime 是**签出**的属性、不是**内容**的属性。
   `touch target/debug/cellrix-web` 就能把它变绿，**内容漂移时它是假绿**。

## 决策

**判据 = 内容在场**：`web/src/boot.rs` 的清单里每个资产的字节必须能在构建产物里找到。
不比较任何时钟 ⇒ 时间戳无法满足它。

## 反例（redtest）

`bash tools/validate.sh --probe ADR-0049-asset-parity` —— 夹具给资产追加一个字节，
闸门**必须**报 RED；不报 RED 即"闸门已腐化"。

## 两种契约如何共存（本文件就是判例）

Cellrix 的 pre-commit 钩子要求**首行是 ADR 头**；phyt-DNA 的闸门契约把元数据放在 YAML front-matter。
`tools/validate.sh` 用 `grep`/`awk` 读取，**不要求元数据在文件开头** ⇒ 把 H1 放第一位、front-matter 紧随其后，
**两套契约同时成立**，无需改动任何一方。
