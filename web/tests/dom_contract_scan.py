# -*- coding: utf-8 -*-
"""Rebuild the inventory with two corrections, and make it executable.

Correction 1: the scan only understood ids. The e2e reads classes too —
doc.querySelector(".foot") and doc.querySelectorAll(".e-trk-nm") are both live
assertions, and the first inventory said "classes are free to change" on the
strength of a scan that could not see them. That is the sixth time a negative
conclusion rested on a pattern that silently matched nothing.

Correction 2: the classes were mutually exclusive, so an item read by another
asset AND by the e2e landed in the looser bucket. Severity is now the maximum:
cross-asset > test-criterion > style-hook.

The scan is also written to disk and compared against the committed inventory,
so the page cannot drift away from the sources it claims to describe. A
hand-copied fact that is never rechecked is the same shape as the ADR index
rebuilt by hand.
"""
import io
import os
import re

# 路径全部从 __file__ 派生：脚本搬到哪里，WEB/OUT 就指到哪里。
# 此前是三处硬编码绝对路径（旧工作区 /Users/jason/Doubao/chats/Jasonmilk/...），
# 工作区迁移后扫描器静默指向不存在的位置 —— 它连资产都读不到，却报告"干净"。
# 相对派生 = 可搬移 = 单一来源（本仓 0 硬编码原则）。
SCAN = os.path.abspath(__file__)                       # .../Cellrix/web/tests/dom_contract_scan.py
WEB = os.path.dirname(os.path.dirname(SCAN))           # .../Cellrix/web
OUT = os.path.join(os.path.dirname(WEB), "docs", "dom-contract.md")  # .../Cellrix/docs/...

assets = sorted(os.listdir(WEB + "/assets"))
html_files = [f for f in assets if f.endswith(".html")]
js_files = [f for f in assets if f.endswith(".js")]
all_files = html_files + js_files

declared = {}   # name -> [files]   (id= or class= in markup)
read = {}       # name -> [files]   (read from script)
kinds = {}      # name -> "id" | "class"

for f in html_files:
    t = io.open(WEB + "/assets/" + f, encoding="utf-8").read()
    for m in re.finditer(r'\sid="([^"]+)"', t):
        declared.setdefault(m.group(1), []).append(f)
        kinds[m.group(1)] = "id"
    for m in re.finditer(r'\sclass="([^"]+)"', t):
        for c in m.group(1).split():
            declared.setdefault(c, []).append(f)
            kinds.setdefault(c, "class")

for f in all_files:
    t = io.open(WEB + "/assets/" + f, encoding="utf-8").read()
    for m in re.finditer(r"getElementById\('([^']+)'\)", t):
        read.setdefault(m.group(1), []).append(f)
        kinds.setdefault(m.group(1), "id")
    for m in re.finditer(r"getElementsByClassName\('([^']+)'\)", t):
        read.setdefault(m.group(1), []).append(f)
        kinds.setdefault(m.group(1), "class")
    # querySelector / querySelectorAll, # and . forms
    for m in re.finditer(r"querySelector(?:All)?\(\s*['\"]([#.][^'\"]+)['\"]", t):
        sel = m.group(1)
        name = sel[1:].split()[0].split(".")[0].split("[")[0]
        if name:
            read.setdefault(name, []).append(f)
            kinds.setdefault(name, "id" if sel[0] == "#" else "class")

e2e = io.open(WEB + "/tests/all_views_test.js", encoding="utf-8").read()
e2e_names = set()
for m in re.finditer(r"getElementById\(['\"]([^'\"]+)['\"]", e2e):
    e2e_names.add(m.group(1))
for m in re.finditer(r"getElementsByClassName\(['\"]([^'\"]+)['\"]", e2e):
    e2e_names.add(m.group(1))
for m in re.finditer(r"querySelector(?:All)?\(\s*['\"]([#.][^'\"]+)['\"]", e2e):
    sel = m.group(1)
    name = sel[1:].split()[0].split(".")[0].split("[")[0]
    if name:
        e2e_names.add(name)

all_names = sorted(set(declared) | set(read) | e2e_names)
cross, test, style = [], [], []
for n in all_names:
    readers = set(read.get(n, []))
    # a name is cross-asset when something other than the file that declares it reads it
    decl_files = set(declared.get(n, []))
    external = readers - decl_files
    if external:
        cross.append(n)
    elif n in e2e_names:
        test.append(n)
    else:
        style.append(n)


def rows(names):
    out = []
    for n in names:
        where = ", ".join(sorted(set(declared.get(n, []) + read.get(n, []))))
        out.append("| `%s%s` | %s |" % ("." if kinds.get(n) == "class" else "", n, where or "—"))
    return "\n".join(out) if out else "| — | — |"


doc = """# DOM 契约清单

> **在动布局之前读这一页。**
>
> e2e 断言是 **DOM 断言**，而 F13 把「找不到元素」从 **FAIL 改成 SKIP**。
> 布局一改，断言找不到元素 ⇒ **静默 SKIP** ⇒ `49/0/1` 变成 `30/0/20`，
> **依然全绿**。这个陷阱被侥幸躲过一次；这一页是让它**不靠侥幸**。
>
> **本页由 `web/tests/dom_contract_scan.py` 生成**，并与 `dom_contract_test.js`
> 比对 —— 清单与源码不一致即红。手抄一份事实且永不校验，与手工重建 ADR 索引同形。

## 三类，三条规矩（**取最严**）

| 类别 | 规矩 | 判据 |
|---|---|---|
| **跨资产契约** | ❌ **冻结**，改名 = 运行期断链 | 被**声明处之外**的资产读取 |
| **测试判据** | ⚠️ **可改，断言必须同步改** | 出现在 **e2e** 里 |
| **纯样式钩子** | ✅ **随便改** | 无人按名字读取 |

**分类取最严**：同时命中多条时按 **跨资产 > 测试判据 > 纯样式** 归入最严的一档。
（初版分类互斥，`view-prove-track` 被 `prove_track.js` 读取却落进「可改」档。）

**id 与 class 都在册**：初版只扫 `id`，于是 `.foot` 与 `.e-trk-nm`
（**e2e 实际断言的两个 class**）被判成「随便改」—— 一个**没有阳性对照的否定性结论**。

## 一、跨资产契约（冻结）

| 名字 | 声明 / 读取处 |
|---|---|
%s

**两条非名字的跨资产契约**（同样冻结）：

| 契约 | 说明 |
|---|---|
| `script.html` 调 `__proveTrackLoad` | 占位符拼装后的全局入口名 |
| `selectPeriod` 驱动 `#s-side` | 选中一条经历 ⇒ 侧栏重绘 |

## 二、测试判据（可改，断言必须同步）

| 名字 | 声明处 |
|---|---|
%s

**验证方式**（每次改布局后）：

```bash
./web/tests/ab_verify.sh     # 记下 RESULT 行
# 判据：skip 数不得增加。增加了 ⇒ 有断言被静默绕过，先修断言再继续。
```

## 三、纯样式钩子（随便改）

| 名字 | 声明处 |
|---|---|
%s

## 维护

- **重生成**：`python3 web/tests/dom_contract_scan.py`
- **校验**：`node web/tests/dom_contract_test.js`（清单 ≠ 扫描结果即红）
- **加新名字时**：被别的资产读取 ⇒ 冻结；被 e2e 读取 ⇒ 同步断言
""" % (rows(cross), rows(test), rows(style))

io.open(OUT, "w", encoding="utf-8").write(doc)

# the scanner, committed so the page can be regenerated and checked
scanner = io.open(__file__, encoding="utf-8").read()
io.open(SCAN, "w", encoding="utf-8").write(scanner)

print("ok  %s" % OUT)
print("    跨资产 %d / 测试判据 %d / 纯样式 %d" % (len(cross), len(test), len(style)))
print("    测试判据含 class: %s" % ", ".join(
    "." + n for n in test if kinds.get(n) == "class") or "  (none)")
print("ok  scanner -> %s" % SCAN)
