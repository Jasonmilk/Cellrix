# -*- coding: utf-8 -*-
"""
Cellrix · 逻辑链条闭环验证器
──────────────────────────────────────────────────────────
验证的不是"里程碑表画得对不对"，而是**项目本身的推理链是否闭合**：

    Ω 元公理 → 公理/约定 → 四层+轴 → 概念 → 不变量 → 里程碑 → 判据/变异
                    ↑___________________________________________|

闭合的定义（双向）：
  正向 每个概念都有家、每条不变量都有判据、每个里程碑都证某条不变量
  反向 每条不变量都被至少一个里程碑或判据覆盖（无不变量悬空）
       每个概念都可追溯到一条公理或领域事实（无凭空出现的概念）

设计纪律：
  1. 概念**从真实产物解析**（v12 HTML），不手抄副本 —— 副本会漂移，漂移就是第二本账
  2. 未落地项标 KNOWN-GAP 而非 ERROR —— "声明在案的缺口" ≠ "逻辑错误"
  3. 本验证器自身过 Ω：每条不变量注入缺陷必须报红（见 self_test）
"""
import re, io, os, copy, sys

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

HTML = _find("cellrix-architecture*.html")
# 声明基线：来自架构图 §5 闭环区。C4 必须与之比对 —— 否则 C4 是重言式（永不触发 ⇒ 装饰）
DECLARED_TOTAL = 29
DECLARED_STATUS = {"done": 11, "move": 4, "new": 14}
DECLARED_INVARIANTS = 16   # 不变量条目基线（防"删行无人发现"）
MD   = _find("Cellrix-里程碑*.md")

# ══════════════════════════════════════════════════════════════
# 1. 解析真实产物（判据优先于声明）
# ══════════════════════════════════════════════════════════════
LAYER_OF = {"l1":"① 契约层","l2":"② 事实层","l3":"③ 视图层","l4":"④ 适配层"}

def parse_concepts(path=HTML):
    """从架构图真实解析概念：层 / 状态 / 双标 / 来源。
    返回 (dict, recs)：recs 保留重复名 —— dict 天然去重，
    若只用 dict 做 C2（占两层）检查，该检查永远不触发 ⇒ V=0 装饰。"""
    s = io.open(path, encoding="utf-8").read()
    out, recs = {}, []
    def grab(block, layer):
        for m in re.finditer(r'<div class="mod ([dmnw])"><div class="mn">(.*?)</div>\s*<div class="md">(.*?)</div>', block, re.S):
            cls_st, mn, md = m.group(1), m.group(2), m.group(3)
            body = re.sub(r'<span class="tag t-[^>]*>.*?</span>', '', mn, flags=re.S)
            name = re.sub(r'<[^>]+>', '', body)
            name = re.split(r'(G0② 已定|由轴迁入|由视图层迁入)', name)[0].strip()
            tags = re.findall(r'<span class="tag t-(\w+)">(.*?)</span>', mn)
            cls_st = {"d":"done","m":"move","n":"new"}[cls_st]
            # 状态在 HTML 中被编码两遍：mod 的 class 字母 + tag 文字。
            # 这是双事实源 —— 只解析其一，改另一处就永远发现不了。故两处都读并要求一致。
            tg = re.search(r'<span class="tag t-(done|move|new)">', mn)
            tag_st = {"done":"done","move":"move","new":"new"}[tg.group(1)] if tg else None
            dual = [t[1] for t in tags if t[0] == "ax"]
            rec = dict(name=name, layer=layer, status=cls_st, tag_status=tag_st, dual=dual,
                       desc=re.sub(r'<[^>]+>', '', md).strip())
            recs.append(rec); out[name] = rec
        return out, recs
    for lid, lname in LAYER_OF.items():
        m = re.search(r'<div class="layer ' + lid + r'">(.*?)\n    </div>', s, re.S)
        if m: grab(m.group(1), lname)
    # 轴
    m = re.search(r'<div class="axis">(.*?)\n  </div>', s, re.S)
    if m: grab(m.group(1), "⇢ 进程拓扑轴")
    return out, recs

def parse_gaps(path=MD, src=None):
    """已知缺口：从 MD §0.9 表解析（唯一事实源）。
    此前硬编码在脚本内 ⇒ 第五处双源：改文档脚本不知，改脚本文档不知。"""
    md = src if src is not None else io.open(path, encoding='utf-8').read()
    if '§0.9 已知缺口清单' not in md: return None
    out = {}
    seg = md[md.index('§0.9 已知缺口清单'):]
    seg = seg[:seg.index('\n### ')] if '\n### ' in seg[10:] else seg
    for line in seg.split('\n'):
        if not line.strip().startswith('|'): continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells) < 2: continue
        n = cells[0]
        if n in ('缺口名', '') or set(n) <= set('-: '): continue
        if n.startswith('**'): continue
        out[n] = cells[1] if len(cells) > 1 else ''
    return out

def parse_crash_fixes(path=HTML):
    """撞车清单：原名 → 改法（HTML 表）。"""
    h = io.open(path, encoding='utf-8').read()
    out = []
    for r in re.finditer(r'<tr><td>(\d+)</td><td><b>(.*?)</b></td><td>(.*?)</td><td class="c">(.*?)</td><td>(.*?)</td></tr>', h):
        fix = re.sub(r'<[^>]+>', '', r.group(4))
        out.append((r.group(1), r.group(2).strip(), fix.strip()))
    return out

def parse_gate_edges(path=MD):
    """门禁边：MD §0「门禁的边」表（| `A → B` | ✅ | ... |）。
    此前 L25 跳过门禁边 ⇒ 删掉 G0→T0 / G1→S303 无人发现（5 个真实盲区）。"""
    md = io.open(path, encoding='utf-8').read()
    if '门禁的边' not in md: return set()
    seg = md[md.index('门禁的边'):]
    seg = seg[:seg.index('\n## ')] if '\n## ' in seg[10:] else seg
    E = set()
    for line in seg.split('\n'):
        if not line.strip().startswith('|'): continue
        if '✅' not in line: continue            # ❌ 是"已删边"，不是事实
        m = re.search(r'`\s*([\w.+]+)\s*(?:→|->|⇢)\s*([\w.+]+)\s*`', line)
        if m: E.add((m.group(1), m.group(2)))
    return E

def parse_mermaid_edges(path=MD):
    """mermaid 图的边。注意正则必须支持：
       · A[标签] --> B   （带节点定义的边）
       · P0.5 / P4+     （ID 含 . 与 +）
       两者任一不支持都会产生"假差异"（本轮亲历：先漏抓带标签边，又把 P0.5 截成 P0）"""
    md = io.open(path, encoding='utf-8').read()
    E = set()
    for b in re.findall(r'```mermaid\n(.*?)```', md, re.S):
        for m in re.finditer(r'^\s*([\w.+]+)(\[[^\]]*\])?\s*(?:-->|-\.[^\n]*?->)\s*([\w.+]+)(\[[^\]]*\])?', b, re.M):
            E.add((m.group(1), m.group(3)))
    return E

def parse_gates(path=MD):
    """门禁 ID 集合（§0 前置门禁表）。不变量/依赖可合法引用它们。"""
    md = io.open(path, encoding='utf-8').read()
    if '## 0 · 前置门禁' not in md: return set()
    seg = md[md.index('## 0 · 前置门禁'):]
    seg = seg[:seg.index('\n## ')] if '\n## ' in seg[10:] else seg
    return set(re.findall(r'\*\*(G\d)\s*·', seg)) | {'E1'}

def parse_milestones(path=MD):
    """从里程碑文档解析：目标 / 退出条件 / 世界对 / 依赖。"""
    s = io.open(path, encoding="utf-8").read()
    tbl = s[s.index("## 2 · 里程碑总表"): s.index("**约束（非目标）**")]
    out = {}
    # 只取 §2 总表内、且列数正确的行（表有 7 列：ID/目标/退出/世界对/依赖/关键路径/变异通道）
    for line in tbl.split("\n"):
        if not line.startswith("| **"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 7:          # 列数不对 ⇒ 不是本表，跳过（防误抓 §0.8 的三列表）
            continue
        mid = cells[0].strip("* ").replace("★", "").strip()
        out[mid] = dict(goal=cells[1], exit=cells[2], world=cells[3],
                        deps=[d.strip() for d in re.split(r"[·+]", cells[4]) if d.strip()],
                        crit=("✅" in cells[5]) or ("—" not in cells[5] and cells[5] != ""),
                        crit_declared=cells[5].strip() not in ("", ),
                        chan=cells[6])
    return out

# ══════════════════════════════════════════════════════════════
# 2. 推理链模型（代码内声明 —— 这部分在文档里是散文，无法解析）
# ══════════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════
# 不变量表：从 MD §3.5 解析（单一事实源）
#   此前 INVARIANTS 是硬编码 dict，与 MD 表格双源 ⇒ 改 MD 无人发现
#   （产物级变异测出 63 个存活变异全部来自这里）
# ══════════════════════════════════════════════════════════════
def parse_axiom_cards(path=HTML):
    """从 HTML 公理区解析公理卡：ID / 标题 / 判据。
    与 AXIOMS 字典互为双源 ⇒ 由 L24 强制一致。"""
    h = io.open(path, encoding='utf-8').read()
    out = {}
    for m in re.finditer(r'<div class="ax[^"]*">\s*<span class="first">', h):
        pass
    for m in re.finditer(r'<div class="n">([^<]+)</div>\s*<div class="t">([^<]*)</div>', h):
        raw = m.group(1).strip()
        aid = re.match(r'(Ω|A\d[a-z]?|T\d)', raw)
        if not aid: continue
        blk = h[m.end(): m.end()+600]
        jm = re.search(r'<div class="j">(.*?)</div>', blk, re.S)
        out[aid.group(1)] = dict(title=m.group(2).strip(),
                                 judge=re.sub(r'<[^>]+>', '', jm.group(1)).strip() if jm else '')
    return out

def parse_invariants(path=MD):
    md = io.open(path, encoding='utf-8').read()
    key = '### 16 条不变量'
    if key not in md:
        key = '不变量 ⇄ 里程碑（双向闭合表'
    if key not in md: return {}
    tbl = md[md.index(key):]
    end = tbl.find('\n### ')
    tbl = tbl[:end] if end > 0 else tbl
    out = {}
    for line in tbl.split('\n'):
        if not line.strip().startswith('|'): continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells) != 4: continue
        # 名称清理：去加粗 ** 与 🆕 标记（顺序不能反，否则留下 **）
        nm = re.sub(r'[\*🆕]', '', cells[0]).strip()
        if not nm or nm == '不变量' or set(nm) <= set('-: '): continue
        # ★ '+' 不是分隔符！"P4+" 被 split(r'[·+]') 切成 P4 ⇒ 文档没错，是解析器错了
        provers = [x.strip() for x in re.split(r'[·、,，]', cells[1]) if x.strip()]
        out[nm] = dict(milestones=provers, axiom=cells[2].strip(),
                       failure=cells[3].strip())
    return out

AXIOMS = {
 "Ω":  dict(kind="元公理", derived=[],            hits=[], meta=["全部判据"], note="判别力：能排除一个世界"),
 "A0": dict(kind="领域事实", derived=[],          hits=["事件流","对象图","删除三旋钮","生命周期","refs 三层","复活 Resurrection"],
            note="以发生为单位记账"),
 "T1": dict(kind="设计约定", derived=["Ω"],       hits=["意图入口 apply","确认门","事件流","事件流契约"],
            note="可拒绝性二分；★不是 A0 的推论"),
 "A2": dict(kind="命名规则", derived=["Ω"],       hits=["终端桥 PTY","对象图","模型适配","agent adapter"]),
 "A3a":dict(kind="命名规则", derived=["Ω"],       hits=["字符网格 grid","TUI","WebUI"]),
 "A3b":dict(kind="命名规则", derived=["Ω"],       hits=["事件流","字符网格 grid","CI-144 意图"]),
 "A4": dict(kind="命名规则", derived=["Ω"],       hits=["终端桥 PTY","bridge 声明","项目注册表","语义快照","事件流契约"]),
 "A5": dict(kind="命名规则", derived=["Ω"],       hits=["运行模式","权限分级 · 模态","段自带序号","Helix-Mind 语义契约","交互模式","语义快照","URL 寻址"]),
}

# 不变量 ⇄ 里程碑（双向闭合的核心表）
INVARIANTS = {
 # ── 已有 14 条：每条补 failure（崩溃/中断时的断言）
 "棘轮(绕过不增长)": dict(milestones=["P0c"],      axiom="T1",
    failure="计数器持久化：进程重启后计数不归零、不重复计数"),
 "C1 反查唯一":      dict(milestones=["T0"],       axiom="A5",
    failure="概念清单是唯一事实源：HTML 卡片只引用 ID，不得自带定义"),
 "C2 无概念占两层":  dict(milestones=["T0"],       axiom="A5",
    failure="同维度内重名即红；跨维度双标需显式标注双属主"),
 "C3 无概念无家":    dict(milestones=["T0"],       axiom="A5",
    failure="孤儿检测脚本独立于排版：改卡片边界不影响清单"),
 "C4 计数自洽":      dict(milestones=["G2","T0"],  axiom="A5",
    failure="计数由清单生成而非手写：手写数一旦与清单不符即红"),
 "T1 二分无第三类":  dict(milestones=["P0a","P0d"],axiom="T1",
    failure="重放中遇到非意图非事实的变更单元 ⇒ 即时红（不许静默归类）"),
 "确定性(可重放)":   dict(milestones=["P0b"],      axiom="A0",
    failure="杀进程于任意时刻（含写入中途）⇒ 恢复后仍能重放到同一 hash；半行必须拒绝而非截断接受"),
 "单一性(单写入者)": dict(milestones=["P0d"],      axiom="T1",
    failure="并发下仍唯一：并发写入者的冲突由串行化吸收，不产生第二写入路径"),
 "渲染纯度":         dict(milestones=["P0.5"],     axiom="A4",
    failure="渲染中途被中断 ⇒ 已输出部分与完整渲染的前缀一致（无半帧状态）"),
 "进程存活":         dict(milestones=["P1"],       axiom="A0",
    failure="daemon 崩溃而非优雅退出 ⇒ 重启后状态仍可恢复；客户端断连期间状态不丢"),
 "协议稳定":         dict(milestones=["P2"],       axiom="A5",
    failure="keymap 文件损坏/缺失 ⇒ 回落到默认且不改事实层；不许半加载"),
 "外部零改动接入":   dict(milestones=["P3"],       axiom="A4",
    failure="外部进程崩溃/退出 ⇒ pane 记录退出码并转终态，不得留下悬空 pane"),
 "续接可达":         dict(milestones=["S303"],     axiom="A0",
    failure="发送中途失败 ⇒ 目标不被改写为最新段（保持原选定目标）"),
 "声明即门配置":     dict(milestones=["P4+"],      axiom="A5",
    failure="审批中途进程退出 ⇒ pending 保持待批，重放后不得自动执行"),

 # ── 缺口 3 新增：事件流物理契约（正确性，非运维）
 "序号单调无重复":   dict(milestones=["P0b","P1"], axiom="A0",
    failure="并发追加下 max+1 竞态 ⇒ 序号重复即红；崩溃后不得出现空洞或重号"),
 "无副作用窗口":     dict(milestones=["P1"],       axiom="A0",
    failure="事件已记/效果未做（或反之）⇒ 由 outbox 或等价机制收敛；崩溃后窗口可检测"),
}

# 已知缺口（声明在案 —— 不是逻辑错误，但不闭合）
KNOWN_GAPS = {
 "意图入口 apply":    "未进代码（M5 适配器 ADR 才接入）⇒ G1① 首要审计对象",
 "终端桥 PTY":        "未实现（P3）",
 "bridge 声明":       "未实现（P3）",
 "项目注册表":        "仅加字段（P3 才填实现）",
 "确认门":            "未实现（依赖 P0d 写入者收敛）",
 "复活 Resurrection": "未实现（P0b 验收后成立）",
 "keymap 数据化":     "未实现（P2）",
 "守护进程边界":      "未实现（P1）",
 "URL 寻址":          "能力在服务端、客户端只认 current ⇒ 线未接（P1）",
 "attach / detach":   "未实现（P1）",
 "事件广播双编码":    "未实现（P1）",
 "权限分级 · 模态":   "未实现（P4+）",
 "模型适配":          "接口已命名空间化，过滤未做",
 "字符网格 grid":     "依赖 render 纯函数（P0.5 才成立）",
 "交互模式":          "owner=②事实层，实现在 P2",
 "段自带序号":        "契约变更，待落",
}

TIME_WORDS = re.compile(r"(\d+(\.\d+)?\s*(天|周|人日|工作日|小时)|Deadline|截止|上线日期)")

# ══════════════════════════════════════════════════════════════
# 3. 验证
# ══════════════════════════════════════════════════════════════
_HTML_TEXT = ""

def verify(concepts, milestones, axioms=None, invariants=None, gaps=None, recs=None, cards=None,
           md_src=None, html_src=None):
    axioms = AXIOMS if axioms is None else axioms
    invariants = parse_invariants() if invariants is None else invariants
    err, warn = [], []
    def E(k, m): err.append(f"[{k}] {m}")
    def W(k, m): warn.append(f"[{k}] {m}")

    # ── 推导链层面 ─────────────────────────────────────────
    # L1 推导链无环
    indeg = {a: len(v["derived"]) for a, v in axioms.items()}
    q = sorted([a for a in axioms if indeg[a] == 0]); order = []
    while q:
        c = q.pop(0); order.append(c)
        for j in axioms:
            if c in axioms[j]["derived"]:
                indeg[j] -= 1
                if indeg[j] == 0: q.append(j)
    if len(order) != len(axioms):
        E("L1 推导链有环", f"环内 {sorted(set(axioms)-set(order))}")

    # L2 无未定义符号
    for a, v in axioms.items():
        for d in v["derived"]:
            if d not in axioms: E("L2 未定义符号", f"{a} 派生自 {d}（不存在）")
    for name, iv in invariants.items():
        if iv["axiom"] not in axioms: E("L2 未定义符号", f"不变量 {name} 引公理 {iv['axiom']}")

    # L3 T1 不得派生自 A0（v10 已撤回该推导）
    if "A0" in axioms.get("T1", {}).get("derived", []):
        E("L3 撤回的推导复活", "T1 派生自 A0 —— A0 为真时 T1 仍可为假，该推导不成立")

    # L4 每条公理至少一次命中
    used = set()
    for a, v in axioms.items():
        for h in v.get("hits", []): used.add(h)
    for a, v in axioms.items():
        if a in ("Ω",): continue
        if not v.get("hits"): E("L4 公理零命中", f"{a} 从未开火 ⇒ 填充物")

    # ── 概念层面（C 组）─────────────────────────────────────
    # C1 每概念唯一家
    bylayer = {}
    for n, c in concepts.items(): bylayer.setdefault(c["layer"], []).append(n)
    # C3 无概念无家
    for n, c in concepts.items():
        if not c["layer"]: E("C3 概念无家", n)
    # C2 无概念占两层（必须用 recs 而非 dict —— dict 去重会让本检查永不触发）
    if recs is None: recs = [dict(name=n, **c) for n, c in concepts.items()]
    seen = {}
    for r in recs:
        n = r["name"]
        if n in seen: E("C2 概念占两层", f"{n} 同时出现在 {seen[n]} 与 {r['layer']}")
        else: seen[n] = r["layer"]
    # C5 状态双编码一致（class 字母 vs tag 文字）—— 二者是同一事实的两处编码，必须相等
    for r in (recs or [dict(name=n, **c) for n, c in concepts.items()]):
        if r.get("tag_status") is not None and r.get("tag_status") != r.get("status"):
            E("C5 状态双编码不一致",
              f"{r['name']}: class 标 {r['status']}、tag 标 {r['tag_status']} ⇒ 图自相矛盾")

    # C4 计数自洽 —— 必须是「与声明基线比对」，不能是 sum(分类) != len(总数)
    # （后者恒为假 ⇒ 永不触发 ⇒ V=0 ⇒ 装饰。此为自测抓到的真实缺陷）
    total = len(concepts)
    by_status = {}
    for n, c in concepts.items(): by_status[c["status"]] = by_status.get(c["status"], 0) + 1
    if total != DECLARED_TOTAL:
        E("C4 计数不自洽", f"解析到 {total} 个概念，声明基线是 {DECLARED_TOTAL} ⇒ 图与声明不符")
    for k, want in DECLARED_STATUS.items():
        got = by_status.get(k, 0)
        if got != want:
            E("C4 计数不自洽", f"{k}: 解析 {got} ≠ 声明 {want}")

    # ── 不变量 ⇄ 里程碑 双向闭合 ────────────────────────────
    # L5 每个里程碑都证某条不变量（无悬空里程碑）
    covered_ms = set()
    for name, iv in invariants.items(): covered_ms.update(iv["milestones"])
    for m in milestones:
        if m not in covered_ms: E("L5 里程碑悬空", f"{m} 不证任何不变量 ⇒ 它是装饰")
    # L23 不变量条目数 = 声明基线（删一行不被发现 ⇒ 该不变量悄悄消失）
    if len(invariants) != DECLARED_INVARIANTS:
        E("L23 不变量条目数不符",
          f"解析 {len(invariants)} 条，声明基线 {DECLARED_INVARIANTS} ⇒ 有条目被删或新增未同步")

    # L24 公理卡 ⇄ AXIOMS 一致（HTML 公理区与 Python 字典是双源）
    cards = parse_axiom_cards() if cards is None else cards
    for aid in axioms:
        if aid in ("Ω",): continue          # Ω 是元公理，允许单独呈现
        if aid not in cards:
            E("L24 公理卡缺失", f"{aid} 在 AXIOMS 中，但架构图公理区没有该卡 ⇒ 双源漂移")
    for aid, c in cards.items():
        if aid not in axioms:
            E("L24 公理卡多余", f"架构图有 {aid} 卡，但 AXIOMS 中没有 ⇒ 双源漂移")
        if not c["judge"] or c["judge"] in ("—", "判据：—"):
            E("L24 公理无判据", f"{aid}（{c['title']}）没有判据 ⇒ 无法执行")

    # L25 mermaid 图 ⇄ §2 表（第三处双源）
    _edges = None
    _gate_edges = None
    if md_src is not None:
        _gate_edges = set()
        if '门禁的边' in md_src:
            sg = md_src[md_src.index('门禁的边'):]
            sg = sg[:sg.index('\n## ')] if '\n## ' in sg[10:] else sg
            for line in sg.split('\n'):
                if not line.strip().startswith('|') or '✅' not in line: continue
                m = re.search(r'`\s*([\w.+]+)\s*(?:→|->|⇢)\s*([\w.+]+)\s*`', line)
                if m: _gate_edges.add((m.group(1), m.group(2)))
        _edges = set()
        for b in re.findall(r'```mermaid\n(.*?)```', md_src, re.S):
            for m in re.finditer(r'^\s*([\w.+]+)(\[[^\]]*\])?\s*(?:-->|-\.[^\n]*?->)\s*([\w.+]+)(\[[^\]]*\])?', b, re.M):
                _edges.add((m.group(1), m.group(3)))
    #   实例：图里写 P05 / P4，表里是 P0.5 / P4+ ⇒ 同一格两个名字（A5 违反）
    G = _edges if md_src is not None else parse_mermaid_edges()
    T = set((dp, k) for k, v in milestones.items() for dp in v["deps"])
    GE = _gate_edges if md_src is not None else parse_gate_edges()
    # 合法边 = §2 表依赖 + §0 门禁表边 + 门禁→工作格（G1→P0a 属 §0 表）
    legal = T | GE
    for a, b_ in sorted(legal - G):
        E("L25 图缺边", f"{a} → {b_} 在表中，mermaid 图中没有 ⇒ 图与表双源漂移")
    for a, b_ in sorted(G - legal):
        E("L25 图多余边", f"mermaid 有 {a} → {b_}，表中没有该依赖 ⇒ 图与表双源漂移")

    # K13 缺口清单 ⇄ 层图（第五处双源）
    _mdg = parse_gaps(src=md_src) if md_src is not None else parse_gaps()
    if _mdg is not None:
        gaps = _mdg          # MD 是唯一事实源；脚本内 KNOWN_GAPS 仅作比对基线
    if _mdg is None:
        E("K13 缺口清单缺失", "MD 无 §0.9 已知缺口清单 ⇒ 缺口回到脚本内硬编码（双源复活）")
    else:
        if set(_mdg) != set(KNOWN_GAPS):
            E("K13 缺口清单漂移",
              f"MD 声明 {len(_mdg)} 条，脚本残留副本 {len(KNOWN_GAPS)} 条 ⇒ 两份不一致")
        for g in _mdg:
            if g not in concepts and not any(g in n or n in g for n in concepts):
                E("K13 缺口不在层图", f"「{g}」声明为缺口，但层图里没有对应概念 ⇒ 图外漂浮")

    # L28 撞车清单的【改法】必须真的落地（否则改名只是纸面动作）
    layer_names = {v["layer"] for v in concepts.values()}
    _hsrc = html_src if html_src is not None else None
    if _hsrc is None:
        _fixes = parse_crash_fixes()
    else:
        _fixes = []
        for r in re.finditer(r'<tr><td>(\d+)</td><td><b>(.*?)</b></td><td>(.*?)</td><td class="c">(.*?)</td><td>(.*?)</td></tr>', _hsrc):
            _fixes.append((r.group(1), r.group(2).strip(), re.sub(r'<[^>]+>', '', r.group(4)).strip()))
    for no, old, fix in _fixes:
        if '⚠' in fix or '研讨' in fix: continue
        parts = [x.strip() for x in re.split(r'[/（(、]', fix) if x.strip()]
        ok = False
        for pt in parts:
            pt = pt.rstrip('）)')
            if not pt: continue
            if pt in concepts or any(pt in n for n in concepts) or pt in layer_names \
               or any(pt in ln for ln in layer_names) or pt in _HTML_TEXT:
                ok = True; break
        if not ok:
            E("L28 改名未落地", f"撞车清单 #{no}「{old}」的改法「{fix}」在全文找不到 ⇒ 改名只是纸面动作")

    # C6 每个概念必须有非空描述（否则它是个空名字，不是概念）
    for n, c in concepts.items():
        d_ = re.sub(r'<[^>]+>', '', c.get("desc", "")).strip()
        if not d_ or d_ in ("—", "-", "?"):
            E("C6 概念无描述", f"「{n}」没有描述 ⇒ 只是一个名字，不是概念")

    # L26 近名概念必须可分（Ω 应用于概念本身）
    #   实例：「事件流契约」⇄「事件流」名字只差后缀，描述却都在列同一组属性
    #   ⇒ 读者分不清哪个是规则哪个是数据 ⇒ V=0 ⇒ 装饰
    MARK = re.compile(r'不是|在\s*①|在\s*②|在\s*③|在\s*④|规则|数据|契约|内容|产物|机制')
    names = list(concepts)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b_ = names[i], names[j]
            if not (a in b_ or b_ in a): continue
            da = concepts[a].get("desc", ""); db = concepts[b_].get("desc", "")
            if not MARK.search(da) or not MARK.search(db):
                E("L26 近名概念不可分",
                  f"「{a}」与「{b_}」名字互为子串，但描述缺少区分标记 ⇒ 分不清谁是规则谁是数据")

    # L27 跨文档版本引用（第四处双源）
    #   实例：MD 写「架构图 v8」，HTML 实际是 v12 ⇒ 引用的是过时版本
    try:
        hsrc = html_src if html_src is not None else io.open(HTML, encoding='utf-8').read()

        mdsrc = md_src if md_src is not None else io.open(MD, encoding='utf-8').read()
        hv = re.search(r'架构(?:研讨)?图 v(\d+)', hsrc) or re.search(r'<title>.*?v(\d+)', hsrc)
        if hv:
            hv = hv.group(1)
            for v in set(re.findall(r'架构(?:研讨)?图 v(\d+)', mdsrc)):
                if v != hv:
                    E("L27 版本引用过时", f"MD 引用「架构图 v{v}」，HTML 实际是 v{hv} ⇒ 跨文档引用漂移")
        dv = set(re.findall(r'DAG v([\d.]+)', hsrc))
        mv = set(re.findall(r'v([\d.]+)\s*[··]\s*(?:目标|DAG)|^# .*?v([\d.]+)', mdsrc, re.M))
        mv = {x for t in mv for x in (t if isinstance(t, tuple) else (t,)) if x}
        if dv and mv and not (dv & mv):
            E("L27 版本引用过时", f"HTML 引用 DAG v{sorted(dv)}，MD 声明 v{sorted(mv)} ⇒ 不一致")
    except OSError:
        pass

    # L22 不变量引用的里程碑 ID 必须真实存在
    #   （区别于 L6「无人证它」：L22 是「引用了不存在的 ID」，诊断更精确。
    #     实例：解析器按 '+' split 把 P4+ 切成 P4 ⇒ 文档没错，是解析器错了）
    _legal = set(milestones) | parse_gates()
    for iv, v in invariants.items():
        for m in v.get("milestones", []):
            if m not in _legal:
                E("L22 不变量引用不存在", f"{iv} 引用「{m}」，§2 表与门禁表中都没有 ⇒ 标识符不一致")

    # L6 每条不变量都被覆盖（无不变量悬空）
    ms_ids = set(milestones) | parse_gates()
    for name, iv in invariants.items():
        if not (set(iv["milestones"]) & ms_ids): E("L6 不变量悬空", f"{name} 无任何里程碑证它")
    # L7 每条不变量有判据+变异（Ω 检验）
    PLACEHOLDER = ("", "—", "-", "无", "待定", "TBD", "?", "待补")
    for m, v in milestones.items():
        if (v["world"] or "").strip() in PLACEHOLDER:
            E("Ω 无世界对", f"{m} ⇒ V=0 ⇒ 装饰")
        # 退出条件是目标导向的核心：占位符必须红（此前只查空串，"—" 可绕过 ⇒ 存活变异 15 个）
        if (v["exit"] or "").strip() in PLACEHOLDER:
            E("L7 无退出条件", f"{m} 退出条件是占位符 ⇒ 不知道何时算达成")
        # 关键路径列：— 表示"非关键"（合法），空表示未声明（红）
        # ★原写法 `and "crit" not in v` 恒为假 ⇒ 永不触发 ⇒ 装饰规则。已修。
        if not v.get("crit_declared", True):
            E("L16 关键路径未声明", f"{m} 未声明是否在关键路径上 ⇒ 无法排期")
    # L8 世界对全局唯一
    wp = {}
    for m, v in milestones.items():
        w = v["world"]
        if not w or w in ("—", ""): continue
        if w in wp: E("L9 世界对重复", f"{m} 与 {wp[w]} 排除同一对世界 ⇒ 其一为装饰")
        else: wp[w] = m
    # L9 目标导向：退出条件不含时间词
    for m, v in milestones.items():
        if TIME_WORDS.search(v["exit"]): E("L10 非目标导向", f"{m} 退出条件含时间词")
    # L15 每格必须有非空目标（此前只验了退出条件，目标为空无人管）
    for m, v in milestones.items():
        g = (v.get("goal") or "").strip().strip("*")
        if not g or g in ("—", "待定", "TBD"):
            E("L15 无目标", f"{m} 没有目标 ⇒ 不知道要达成什么状态")

    # L10 里程碑依赖完整
    for m, v in milestones.items():
        for d in v["deps"]:
            if d not in milestones and d not in ("G0", "G1", "G2", "G3"):
                E("L11 悬空依赖", f"{m} -> {d}")

    # L14 每格必须声明变异通道（此前该列被正则吞掉，从未校验 ⇒ 装饰列）
    for m, v in milestones.items():
        ch = (v.get("chan") or "").strip()
        if ch in ("", "—", "未知"):
            E("L14 无变异通道", f"{m} 未声明执行通道 ⇒ 不知道这条判据靠什么跑起来")

    # L13 每条不变量必须声明失败路径（缺口 1：不能只验成功路径）
    for name, iv in invariants.items():
        f = (iv.get("failure") or "").strip()
        if not f or f in ("—", "无", "待定", "TBD"):
            E("L13 无失败路径", f"{name} 只定义了成功路径 ⇒ 崩溃时不变量无人负责")

    # L17 引用完整性：公理声称命中的概念必须真实存在
    # （改名后若无人发现 ⇒ 公理与概念集断了引用 —— 存活变异 13 个的真因）
    for a, v in axioms.items():
        for h in v.get("hits", []):
            if h not in concepts:
                E("L17 公理引用断裂", f"{a} 声称命中「{h}」，但概念集中没有 ⇒ 改名未同步")
    for g in (gaps or {}):
        if g not in concepts:
            E("L17 缺口引用断裂", f"KNOWN-GAPS 引用「{g}」，但概念集中没有 ⇒ 改名未同步")

    # L18 概念可追溯性：每个概念必须被至少一条公理命中，或已声明为缺口
    # （文档一直写着"每个概念可追溯到一条公理"，但从未检查 ⇒ 13 个概念无引用 ⇒ 改名不被发现）
    referenced = set()
    for v in axioms.values(): referenced.update(v.get("hits", []))
    referenced.update(gaps or {})
    for n in concepts:
        if n not in referenced:
            E("L18 概念不可追溯", f"「{n}」未被任何公理或已知缺口引用 ⇒ 改名无人发现")

    # ── 已知缺口 → 警告（不是错误）──────────────────────────
    for n, why in (gaps or {}).items():
        if n in concepts:
            W("KNOWN-GAP", f"{n}：{why}")
        else:
            E("缺口表漂移", f"{n} 不在概念集中（缺口清单与图不一致）")
    # 未落地但未声明的概念 → 错误（不能在案外）
    for n, c in concepts.items():
        if c["status"] == "new" and n not in (gaps or {}):
            E("L12 缺口未声明", f"{n} 标为'新'但不在 KNOWN-GAPS ⇒ 图外漂浮")

    stats = dict(concepts=total, layers=len(bylayer), milestones=len(milestones),
                 invariants=len(invariants), axioms=len(axioms),
                 status={k: by_status.get(k, 0) for k in ("done", "move", "new")},
                 gaps=len(gaps or set()),
                 failure=sum(1 for v in invariants.values() if (v.get("failure") or "").strip()),
                 order=" → ".join(order) if len(order) == len(axioms) else "CYCLE")
    # L29 概念层归属 ⇄ owner 声明一致（第七轮）
    CN2L = {"\u2460":"l1","\u2461":"l2","\u2462":"l3","\u2463":"l4","\u2464":"l5"}
    if hsrc:
        for _m in re.finditer(r'<div class="layer (l\d)">(.*?)\n    </div>', hsrc, re.S):
            _cur = _m.group(1)
            for _c in re.finditer(r'<div class="mod [dmn]"><div class="mn">(.*?)</div>.*?<div class="mt">(.*?)</div></div>',
                                  _m.group(2), re.S):
                _nm = re.sub(r'<[^>]+>', '', _c.group(1))
                _nm = re.sub(r'<span class="tag t-[^>]*>.*?</span>', '', _nm, flags=re.S).strip()
                _d = re.search(r'(?:\u5f52\u5c5e\u5728|owner\s*=\s*)\s*([\u2460\u2461\u2462\u2463\u2464])', _c.group(2))
                if not _d: continue
                _want = CN2L[_d.group(1)]
                if _want != _cur:
                    E("L29 归属与声明不符", f"「{_nm}」声明归属 {_d.group(1)}（{_want}），实际在 {_cur} ⇒ 自相矛盾")

    return err, warn, stats

# ══════════════════════════════════════════════════════════════
# 4. 自测：本验证器自身过 Ω
# ══════════════════════════════════════════════════════════════
def self_test(concepts, milestones):
    base = verify(concepts, milestones, recs=RECS)
    assert not base[0], f"基线应无 ERROR，实际：{base[0][:3]}"
    cases = {
     "L1 推导链有环":   lambda a, i, g: a["Ω"].__setitem__("derived", ["A5"]),
     "L2 未定义符号":   lambda a, i, g: a["T1"].__setitem__("derived", ["Z9"]),
     "L3 撤回的推导复活":lambda a, i, g: a["T1"].__setitem__("derived", ["A0"]),
     "L4 公理零命中":   lambda a, i, g: a["A2"].__setitem__("hits", []),
     "L5 里程碑悬空":   lambda a, i, g: None,
     "L6 不变量悬空":   lambda a, i, g: i["单一性(单写入者)"].__setitem__("milestones", ["ZZ"]),
     "L9 世界对重复":   lambda a, i, g: None,
     "L10 非目标导向":  lambda a, i, g: None,
     "L11 悬空依赖":    lambda a, i, g: None,
     "L12 缺口未声明":  lambda a, i, g: g.pop("终端桥 PTY", None),
     "缺口表漂移":      lambda a, i, g: g.__setitem__("幽灵概念", "不在图里"),
     "C2 概念占两层":   lambda a, i, g: None,
     "C4 计数不自洽":   lambda a, i, g: None,
     "C5 状态双编码不一致": lambda a, i, g: None,
     "L13 无失败路径":  lambda a, i, g: i["确定性(可重放)"].__setitem__("failure", ""),
     "L14 无变异通道":  lambda a, i, g: None,
     "L15 无目标":      lambda a, i, g: None,
     "L7 无退出条件":   lambda a, i, g: None,
     "L17 公理引用断裂": lambda a, i, g: None,
     "L18 概念不可追溯": lambda a, i, g: None,
     "L22 不变量引用不存在": lambda a, i, g: None,
     "L23 不变量条目数不符":  lambda a, i, g: i.pop(next(iter(i)), None),
     "L24 公理卡缺失":       lambda a, i, g: None,
     "L24 公理卡多余":       lambda a, i, g: None,
     "L24 公理无判据":       lambda a, i, g: None,
     "L25 图缺边":           lambda a, i, g: None,
     "L25 图多余边":         lambda a, i, g: None,
     "L26 近名概念不可分":    lambda a, i, g: None,
     "C6 概念无描述":        lambda a, i, g: None,
     "K13 缺口清单缺失":      lambda a, i, g: None,
     "K13 缺口清单漂移":      lambda a, i, g: None,
     "K13 缺口不在层图":      lambda a, i, g: None,
     "L29 归属与声明不符": lambda a, i, g: None,
     "L28 改名未落地":        lambda a, i, g: None,
     "L27 版本引用过时":      lambda a, i, g: None,
     "L16 关键路径未声明": lambda a, i, g: None,
     "C3 概念无家":        lambda a, i, g: None,
     "L17 缺口引用断裂":    lambda a, i, g: g.__setitem__("幽灵引用", "不在图中"),
     "Ω 无世界对":         lambda a, i, g: None,
    }
    rows = []
    for name, mut in cases.items():
        a, i, g = copy.deepcopy(AXIOMS), copy.deepcopy(INVARIANTS), copy.deepcopy(KNOWN_GAPS)
        c2, m2 = copy.deepcopy(concepts), copy.deepcopy(milestones)
        RECS2 = copy.deepcopy(RECS)
        cards2 = parse_axiom_cards()          # 公理卡副本（HTML 侧），用于 L24 注入
        msrc, hsrc2 = None, None
        _md = io.open(MD, encoding='utf-8').read()
        _html = io.open(HTML, encoding='utf-8').read()
        if name == "L9 世界对重复":
            ks = [k for k in m2 if m2[k]["world"] not in ("—", "")]
            m2[ks[1]]["world"] = m2[ks[0]]["world"]
        elif name == "L5 里程碑悬空":
            m2["ZZ"] = dict(goal="孤立格", exit="达成某状态",
                            world="达成 / 未达成", deps=["T0"], crit=False)
        elif name == "L14 无变异通道":
            m2["P3"]["chan"] = "—"
        elif name == "L15 无目标":
            m2["T0"]["goal"] = ""
        elif name == "L7 无退出条件":
            m2["P1"]["exit"] = "—"
        elif name == "L17 公理引用断裂":
            c2.pop("事件流", None)
        elif name == "L18 概念不可追溯":
            c2["凭空概念"] = dict(layer="② 事实层", status="new", tag_status="new", dual=[], desc="")
            RECS2.append(dict(c2["凭空概念"], name="凭空概念"))
        elif name == "L16 关键路径未声明":
            m2["P1"]["crit_declared"] = False
        elif name == "C3 概念无家":
            c2["无家概念"] = dict(layer="", status="new", tag_status="new", dual=[], desc="")
            RECS2.append(dict(c2["无家概念"], name="无家概念"))
        elif name == "Ω 无世界对":
            m2["P1"]["world"] = ""
        elif name == "L22 不变量引用不存在":
            i["确定性(可重放)"]["milestones"] = ["P0b", "P9"]
        elif name == "L24 公理卡缺失":
            cards2.pop(next(iter(cards2)), None)     # 删一张公理卡
        elif name == "L24 公理卡多余":
            cards2["A9"] = dict(title="幽灵公理", judge="有判据")
        elif name == "L24 公理无判据":
            k0 = next(iter(cards2)); cards2[k0]["judge"] = "—"
        elif name == "L25 图缺边":
            msrc = _md.replace("T0 --> P0a", "", 1)
        elif name == "L25 图多余边":
            msrc = _md.replace("P1 --> P3", "P1 --> P3\n    P1 --> P0a", 1)
        elif name == "K13 缺口清单缺失":
            msrc = _md.replace("§0.9 已知缺口清单", "§0.9 缺口清单", 1)
        elif name == "K13 缺口清单漂移":
            msrc = _md.replace("| 段自带序号 | 契约层已定，代码未落 | T0 |",
                               "| 段自带序号 | 契约层已定，代码未落 | T0 |\n| 幽灵缺口XYZ | 未实现 | T0 |", 1)
        elif name == "K13 缺口不在层图":
            msrc = _md.replace("| 终端桥 PTY |", "| 终端桥ZZZ |", 1)
        elif name == "L12 缺口未声明":
            msrc = _md.replace("| 段自带序号 | 契约层已定，代码未落 | T0 |\n", "", 1)
        elif name == "缺口表漂移":
            msrc = _md.replace("| 确认门 |", "| 确认门ZZZ |", 1)
        elif name == "L17 缺口引用断裂":
            msrc = _md.replace("| 模型适配 |", "| 模型适配ZZZ |", 1)
        elif name == "L28 改名未落地":
            hsrc2 = _html.replace('<span class="tag t-ok">对象图</span>',
                                  '<span class="tag t-ok">对象图ZZZ</span>', 1)
        elif name == "C6 概念无描述":
            c2["事件流"]["desc"] = "—"
        elif name == "L26 近名概念不可分":
            c2["事件流契约"]["desc"] = "追加 · max+1 · 尾换行"
            c2["事件流"]["desc"] = "追加 · max+1 · 尾换行"
        elif name == "L27 版本引用过时":
            hsrc2 = _html.replace("架构研讨图 v12", "架构研讨图 v9", 1)
        elif name == "L10 非目标导向":
            m2["P1"]["exit"] = "做完 5 天即可"
        elif name == "L11 悬空依赖":
            m2["P3"]["deps"] = ["GHOST"]
        elif name == "C5 状态双编码不一致":
            RECS2[0]["tag_status"] = ("new" if RECS2[0]["status"] != "new" else "done")
        elif name == "C4 计数不自洽":
            c2.pop(next(iter(c2)))      # 删一个概念 ⇒ 总数 28 ≠ 声明 29
        elif name == "L29 归属与声明不符":
            hsrc2 = _html.replace('归属在 ② 事实层', '归属在 ④ 适配层', 1)
        elif name == "C2 概念占两层":
            dup = dict(RECS2[0]); dup["layer"] = "⑨ 幽灵层"
            RECS2.append(dup)
        else:
            mut(a, i, g)
        e, w, _ = verify(c2, m2, a, i, g, recs=RECS2, cards=cards2, md_src=msrc, html_src=hsrc2)
        caught = any(name.split()[0] in x for x in e)
        rows.append((name, "PASS" if caught else "FAIL", (e or ["<未捕获>"])[0]))
    return rows

def meta_check():
    """L19 元验证：代码中每条 E() 规则都必须有对应的自测 case。
    没有 case 的规则 = 从未被验证过的规则 —— L16 就是这样漏掉的：
    写得出来、显示不出来、没人发现。"""
    import re as _re
    src = io.open(__file__, encoding="utf-8").read()
    declared = set(_re.findall(r'E\(\s*"([^"]+)"', src))
    cases = set()
    for m in _re.finditer(r'"([^"]+)":\s*lambda a, i, g', src):
        cases.add(m.group(1))
    missing = sorted(declared - cases)
    return missing

# ══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    C, RECS = parse_concepts(); M = parse_milestones()
    err, warn, st = verify(C, M, recs=RECS)
    print("=" * 68); print("Cellrix · 逻辑链条闭环验证"); print("=" * 68)
    print(f"概念 {st['concepts']}（{st['status']['done']} 现状 / {st['status']['move']} 待更新 / {st['status']['new']} 新）"
          f" · 层 {st['layers']} · 里程碑 {st['milestones']} · 不变量 {st['invariants']} · 公理 {st['axioms']}")
    print(f"推导链：{st['order']}\n")
    if err:
        print(f"✗ 未闭合（{len(err)} 处 ERROR）：")
        for x in err: print("   -", x)
    else:
        print("✓ 逻辑链条闭合：推导无环 · 无未定义符号 · 概念有唯一家 · 不变量⇄里程碑双向闭合")
    print(f"\n⚠ 已知缺口 {st['gaps']} 处（声明在案，非错误）：")
    for x in warn[:8]: print("   -", x)
    if len(warn) > 8: print(f"   … 另 {len(warn)-8} 处")
    print("\n" + "-" * 68); print("验证器自测（每条不变量注入缺陷 ⇒ 必须报红）"); print("-" * 68)
    rows = self_test(C, M)
    for n, r, first in rows: print(f"  {r}  {n:18s} {'' if r=='PASS' else first}")
    miss = meta_check()
    if miss:
        print(f"\n✗ L19 元验证失败：以下 {len(miss)} 条规则没有自测 case ⇒ 从未被验证：")
        for m in miss: print("   -", m)
    else:
        print(f"\n✓ L19 元验证通过：{len(rows)} 条规则全部有自测 case")
    ok = sum(1 for r in rows if r[1] == "PASS")
    print(f"\n自测 {ok}/{len(rows)}" + (" ✓ 验证器自身 V>0" if ok == len(rows) else " ✗ 有判别力盲区"))
    sys.exit(1 if err or ok != len(rows) or miss else 0)
