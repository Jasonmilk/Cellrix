# -*- coding: utf-8 -*-
"""
Cellrix 里程碑 DAG · 闭环验证器
设计原则：本验证器自身必须过 Ω 检验 —— 每个不变量都要能红（见 self_test）。
"""
import os, io

import glob as _glob

def _find(pat):
    """文档名参数化：按 glob 找唯一匹配；0 或多于 1 ⇒ 具名失败（读到空不是通过）。"""
    here = os.path.dirname(os.path.abspath(__file__))
    # 两处布局都要能跑：仓库内 <repo>/docs/…；变异夹具把文档摆在脚本**同目录**
    hits = sorted(_glob.glob(os.path.join(here, '..', 'docs', pat))) or sorted(_glob.glob(os.path.join(here, pat)))
    if len(hits) != 1:
        raise SystemExit("UNMEASURABLE: 期望恰好 1 份 %s，实际 %d 份（不是通过）" % (pat, len(hits)))
    return hits[0]

HERE = os.path.dirname(os.path.abspath(__file__))
def P(n): return os.path.join(HERE, n)
import re, itertools, copy

# ────────────────────────────────────────────────────────────────
# 数据：里程碑 = 目标导向（每格 = 一个「要达成的状态」，不是一段时间）
# ────────────────────────────────────────────────────────────────
# ★ 单一事实源：P 系格一律从 MD §2 表解析，此处不再硬编码副本。
#   （此前本文件硬编码了 16 个节点的完整副本，与 MD 漂移 8 处仍在报"闭环成立"：
#     P0.5↔P05、P4+ 缺失、3 处 exit 文本不同 —— 这是双事实源，必须消灭）
def check_no_duplicate_source():
    """X1 防复发：本文件不得再硬编码里程碑副本。
    此前 NODES 硬编码 16 个节点，与 MD 漂移 8 处仍报"闭环成立"。
    这条检查用源码自身做判据：若再出现 `  "P0a"=dict(` 之类的结构 ⇒ 红。"""
    src = io.open(__file__, encoding='utf-8').read()
    body = src[src.index('def load_nodes'):]
    bad = re.findall(r'^\s{1,4}"(G\d|P\d|S\d|T\d|E\d)[^"]*"\s*=\s*dict\(', body, re.M)
    return [f'硬编码节点副本 {b}' for b in bad]

def load_nodes():
    """从 MD 解析全部节点。门禁来自 §1 门禁表，工作格来自 §2 里程碑总表。"""
    md = io.open(_find('Cellrix-里程碑*.md'), encoding='utf-8').read()

    # ── 门禁：§1 门禁表（| **G0 · ...** | ... | 状态 |）
    nodes = {}
    gate_sec = md[md.index('## 0 · 前置门禁'):] if '## 0 · 前置门禁' in md else md
    for m in re.finditer(r'\|\s*\*\*(G\d)\s*·\s*([^\*]+)\*\*[^|]*\|([^\|]*)\|', gate_sec):
        gid = m.group(1)
        if gid in nodes: continue
        nodes[gid] = dict(kind="gate", goal=m.group(2).strip(),
                          exit=m.group(3).strip() or "门禁达成",
                          deps=[], world=(f"{gid} 达成", f"{gid} 未达成"),
                          judges=[m.group(3).strip() or "门禁达成"],
                          mutations=["门禁未达成即放行 ⇒ 红"], crit=False, chan="—",
                          crit_declared=True)

    # ── 已完工 E1
    if 'E1' not in nodes:
        nodes['E1'] = dict(kind="done", goal="M4 收尾已完成", exit="端到端 2 passed（§370）",
                           deps=[], world=("已完成", "未完成"),
                           judges=["§370 端到端 2 passed"], mutations=["G3 跑出不符 ⇒ 回滚 ⇒ 红"],
                           crit=False, chan="集成", crit_declared=True)

    # ── 工作格：复用 logic_verify 的解析器（唯一实现，不复制）
    import importlib.util as _iu
    _sp = _iu.spec_from_file_location("lv", P('cellrix_logic_verify.py'))
    _lv = _iu.module_from_spec(_sp); _sp.loader.exec_module(_lv)
    for k, v in _lv.parse_milestones().items():
        w = v.get("world") or ""
        # MD 中世界对写作 "A / B"；dag 侧用 tuple。在此做唯一一次转换（不存第二份）
        wt = tuple(x.strip() for x in w.split("/")) if "/" in w else (w, "" if w else "")
        nodes[k] = dict(v, world=wt, kind="work",
                        judges=[v.get("exit") or ""],
                        mutations=[f"通道={v.get('chan')}；世界对={v.get('world')}" ])

    # ── 门禁边：从 MD「门禁的边」表解析（此前硬编码，同样是双源）
    for m in re.finditer(r'\|\s*`(\w+)\s*(?:→|->)\s*(\w+)`\s*\|\s*(✅|✔|✓)', md):
        a, b = m.group(1), m.group(2)
        if a in nodes and b in nodes and a not in nodes[b].setdefault('deps', []):
            nodes[b]['deps'].append(a)
    return nodes

TIME_WORDS = re.compile(r"(\d+(\.\d+)?\s*(天|周|人日|工作日)|工期|Deadline|截止)")

MD_ALL_TEXT = io.open(_find("Cellrix-里程碑*.md"), encoding="utf-8").read()
def verify(nodes, strict_goal=True, md_all=""):
    """返回 (issues, stats)。issues 为空 = 闭环成立。"""
    iss, ids = [], set(nodes)
    global MD_ALL_TEXT
    md_all = md_all or MD_ALL_TEXT
    def bad(k, msg): iss.append(f"[{k}] {msg}")

    # V1 依赖引用完整
    for i, n in nodes.items():
        for d in n["deps"]:
            if d not in ids: bad("V1 悬空依赖", f"{i} -> {d} 不存在")

    # V2 无环（Kahn：入度 = 该节点未完成的前置数 = len(deps)）
    indeg = {i: len(nodes[i]["deps"]) for i in ids}
    q = sorted([i for i in ids if indeg[i] == 0]); order = []
    while q:
        c = q.pop(0); order.append(c)
        for j in sorted(ids):
            if c in nodes[j]["deps"]:
                indeg[j] -= 1
                if indeg[j] == 0: q.append(j)
    if len(order) != len(ids):
        cyc = sorted(ids - set(order))
        bad("V2 有环", f"无法拓扑排序，环内节点 {cyc}")

    # V3 目标 + 退出条件齐备
    for i, n in nodes.items():
        if not n.get("goal"): bad("V3 无目标", i)
        if not n.get("exit"): bad("V3 无退出条件", i)

    # V4 世界对（Ω）：必须存在且两世界不同
    for i, n in nodes.items():
        w = n.get("world")
        if not w or len(w) != 2: bad("V4 无世界对", f"{i} ⇒ V=0 ⇒ 装饰")
        elif w[0] == w[1]: bad("V4 世界对相同", f"{i}: {w} ⇒ 不可分 ⇒ V=0")

    # V5 结构事实：声明了判据 + 声明了变异通道。
    # 「变异是否声明为能红」是语义检查 —— 归 logic_verify 的 L14，此处不重复判（一处一事）
    for i, n in nodes.items():
        if n.get("kind") == "work":
            if not (n.get("judges") and any(n["judges"])): bad("V5 无判据", i)
            ch = (n.get("mutations") or [""])[0]
            if not ch or ch in ("—", "未知"): bad("V5 无变异通道", f"{i} ⇒ 不知道靠什么跑")

    # V6 世界对全局唯一（两格排除同一对世界 ⇒ 其中一个是装饰）
    seen = {}
    for i, n in nodes.items():
        w = n.get("world")
        if not w or len(w) != 2: continue
        w = tuple(sorted(w))
        if w in seen: bad("V6 世界对重复", f"{i} 与 {seen[w]} 排除同一对世界 ⇒ 其一为装饰")
        else: seen[w] = i

    # V7 可达性（从源点出发）
    src = [i for i in ids if not nodes[i]["deps"]]
    reach, st = set(src), list(src)
    while st:
        c = st.pop()
        for j in ids:
            if c in nodes[j]["deps"] and j not in reach: reach.add(j); st.append(j)
    for i in ids - reach: bad("V7 不可达", f"{i} 无法从任何源点到达")

    # V13 门禁基线：门禁数必须 = 4 且 G0..G3 全在
    # （真因：G3 行写成 **G3 · 门对账**（v4 新增），旧正则要求 ** 后紧跟 | ⇒ G3 被静默跳过，
    #   验证器仍报"闭环成立" —— 东西丢了而检查看不见，这是第五次同类）
    gates = [i for i in ids if re.fullmatch(r'G\d', i)]
    if len(gates) != 4:
        bad("V13 门禁数不符", f"解析到 {len(gates)} 个门禁 {gates}，应为 4（G0/G1/G2/G3）⇒ 有门禁被静默跳过")
    for g in ("G0", "G1", "G2", "G3"):
        if g not in ids:
            bad("V13 门禁缺失", f"{g} 不在节点集中 ⇒ 门禁表解析失败，但图仍报闭环（静默失败）")

    # V14 mermaid 节点 ⇄ 解析节点（双源）
    mm = re.search(r'```mermaid\n(.*?)```', md_all, re.S)
    if mm:
        mids = set(re.findall(r'^\s*([A-Za-z0-9.+]+)(\[|\s*-->|\s*-\.|\s*$)', mm.group(1), re.M))
        mids = {x[0] if isinstance(x, tuple) else x for x in mids}
        mids = {i for i in mids if re.fullmatch(r'[A-Za-z0-9.+]+', i)}
        miss = mids - set(ids)
        if miss:
            bad("V14 图有表无", f"mermaid 中有 {sorted(miss)}，解析节点集中没有 ⇒ 双源漂移")

    # V8 孤儿（有入边或有出边；done 类豁免）
    has = lambda i: bool(nodes[i]["deps"]) or any(i in nodes[j]["deps"] for j in ids)
    for i in ids:
        if not has(i) and nodes[i]["kind"] != "done": bad("V8 孤儿", i)

    # V9 终端节点必须有退出条件（不会无限）
    for i in ids:
        if not any(i in nodes[j]["deps"] for j in ids) and not n.get("exit"):
            bad("V9 终端无出口", i)

    # V10 —— 已删除。原因：它是装饰（永不触发）。
    #   判据演进：① 硬编码关键路径列表（含 P05，双源漂移）
    #             ② 改为从 ✅ 推导 + 检查相邻格可达 ⇒ 对 P0b‖P0d 假红（二者必须并行，互不可达）
    #             ③ 改为检查依赖逆序 ⇒ DAG 无环时恒真 ⇒ 永不触发 ⇒ 装饰
    #   结论：「关键路径」在含并行分支的 DAG 中不可计算（要算最长链必须有工期，
    #         而工期是参考估计）。MD §2 表的 ✅ 真实含义是「要害格」，非「在链上」。
    #   诚实处理：删规则 + 在文档标注其为声明，不用恒真的规则假装验证。

    # V11 要害格必须有世界对且非重复（已在 V4/V6 覆盖）——此处校验标注一致性
    for i, n in nodes.items():
        if n.get("star") and not n.get("world"): bad("V11 要害格无世界对", i)

    # V12 目标导向：退出条件不得是时间/日期
    if strict_goal:
        for i, n in nodes.items():
            if TIME_WORDS.search(n.get("exit","")):
                bad("V12 非目标导向", f"{i} 的退出条件含时间词：{n['exit']}")

    stats = dict(nodes=len(ids), edges=sum(len(n["deps"]) for n in nodes.values()),
                 crit=len([i for i,n in nodes.items() if n.get("crit")]), sources=len(src), terminals=sum(
                 1 for i in ids if not any(i in nodes[j]["deps"] for j in ids)),
                 order=" → ".join(order) if len(order)==len(ids) else "CYCLE")
    return iss, stats

# ────────────────────────────────────────────────────────────────
# 自测：验证器自身的判别力 —— 每个不变量注入缺陷后必须变红
# ────────────────────────────────────────────────────────────────
def self_test():
    dup = check_no_duplicate_source()
    if dup:
        print("✗ X1 双源复发：" + "; ".join(dup)); sys.exit(1)
    base, _ = verify(load_nodes()), None
    assert not base[0], f"基线应全绿，实际：{base[0]}"
    cases = {
     "V1 悬空依赖":      lambda n: n["P1"].__setitem__("deps", ["NOPE"]),
     "V2 有环":          lambda n: n["P0a"].__setitem__("deps", ["T0","P0b"]),
     "V3 无目标":        lambda n: n["P0b"].__setitem__("goal", ""),
     "V4 无世界对":      lambda n: n["P0b"].__setitem__("world", None),
     "V4 世界对相同":    lambda n: n["P0d"].__setitem__("world", ("X","X")),
     "V5 无变异":        lambda n: n["P1"].__setitem__("mutations", []),
     "V5 无变异通道":    lambda n: n["P2"].__setitem__("mutations", ["—"]),
     "V6 世界对重复":    lambda n: n["P2"].__setitem__("world", n["P1"]["world"]),
     "V7 不可达":        lambda n: n["P3"].__setitem__("deps", ["GHOST"]),
     "V8 孤儿":          lambda n: n.__setitem__("X9", dict(kind="work",goal="g",exit="e",deps=[],
                                        world=("a","b"),judges=["j"],mutations=["m ⇒ 红"])),
     "V13 门禁数不符":   lambda n: n.pop("G3", None),
     "V13 门禁缺失":     lambda n: n.pop("G2", None),
     "V14 图有表无":     lambda n: n.pop("E1", None),
     "V12 非目标导向":   lambda n: n["P1"].__setitem__("exit", "做完 5 天即可"),
    }
    rows = []
    for name, mutate in cases.items():
        n = load_nodes(); mutate(n)
        iss, _ = verify(n)
        caught = any(name.split()[0] in x for x in iss)
        rows.append((name, "PASS" if caught else "FAIL", iss[:1]))
    return rows

if __name__ == "__main__":
    nodes = load_nodes()
    iss, st = verify(nodes, md_all=io.open(_find("Cellrix-里程碑*.md"), encoding="utf-8").read())
    print("="*64); print("Cellrix 里程碑 DAG · 闭环验证"); print("="*64)
    print(f"节点 {st['nodes']} · 边 {st['edges']} · 源点 {st['sources']} · 终端 {st['terminals']}")
    print(f"拓扑序：{st['order']}\n")
    if iss:
        print("✗ 未闭合，问题：")
        for x in iss: print("   -", x)
    else:
        print("✓ 闭环成立：无环 · 无悬空 · 无孤儿 · 全部可达 · 每格有目标/世界对/判据/变异")
    print("\n" + "-"*64); print("验证器自测（每个不变量注入缺陷 ⇒ 必须报红）"); print("-"*64)
    rows = self_test()
    for name, res, first in rows:
        print(f"  {res}  {name:16s} {'' if res=='PASS' else first}")
    ok = sum(1 for r in rows if r[1]=="PASS")
    print(f"\n自测 {ok}/{len(rows)} 通过" + (" ✓ 验证器自身 V>0" if ok==len(rows) else " ✗ 验证器有判别力盲区"))
