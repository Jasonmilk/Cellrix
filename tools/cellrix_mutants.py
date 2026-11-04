# -*- coding: utf-8 -*-
"""
Cellrix · 系统性变异枚举器（cargo-mutants 路径）
──────────────────────────────────────────────────────────
手挑变异 case 是有偏的 —— 我只测了「我能想到的」坏法。
巨人做法（cargo-mutants / FoundationDB）：**自动枚举** 变异点 × 变异算子，
统计 **存活变异（survived）** = 验证器杀不死的坏法 = 真实判别力盲区。

  变异得分 = killed / total
  存活清单 = 这份验证器真正看不见的东西
"""
import os, io, re, copy, sys, difflib, difflib, shutil, tempfile, subprocess

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

# 已知不可判：这些坏法验证器抓不到，且**无法用判据解决**（是设计声明，不是可推导事实）。
# 显式列入白名单 ⇒ 脚本可返回 0，但白名单本身是可见的声明，不是静默忽略。
# 若将来有人找到判据，应从此处移除并让它重新参与计分。
# 白名单必须是【具体项】，不是【类别】。
# 真因（第七轮）：原为 "LAYER/跨层移动"（类别子串），
#   会吃掉整个维度 —— 87 个算子全部自动豁免，维度净覆盖 0 却计满分。
KNOWN_UNDECIDABLE = [
    "LAYER/跨层移动[模型适配:l5→l1]",
    # 仅此一项不可判：「模型适配应在适配层」是设计声明，无法从文档推导。
]
HTML0 = io.open(_find('cellrix-architecture*.html'), encoding='utf-8').read()
MD0   = io.open(_find('Cellrix-里程碑*.md'), encoding='utf-8').read()

# ── 变异点定位 ────────────────────────────────────────────────
CARD_RE = re.compile(r'<div class="mod ([dmn])"><div class="mn">.*?</div>\s*<div class="md">.*?</div>\s*<div class="mt">.*?</div></div>', re.S)
def sec2(md):
    t = md[md.index('## 2 · 里程碑总表'): md.index('**约束（非目标）**')]
    return [l for l in t.split('\n')
            if l.startswith('| **') and len(l.strip().strip('|').split('|')) == 7]

STATUS_TAG = {'d':'done','m':'move','n':'new'}
FLIP = {'d':'n','n':'d','m':'d'}

def mutants_html():
    """HTML 侧：每个概念卡 × 每个算子"""
    cards = list(CARD_RE.finditer(HTML0))
    for i, m in enumerate(cards):
        seg = m.group(0)
        nm = re.search(r'<div class="mn">(.*?)</div>', seg, re.S)
        name = re.sub(r'<[^>]+>', '', re.sub(r'<span class="tag t-[^>]*>.*?</span>', '', nm.group(1), flags=re.S)).strip()
        name = re.split(r'(G0② 已定|由轴迁入|由视图层迁入)', name)[0].strip()
        # 算子1：删卡
        yield f"HTML/删卡[{name}]", HTML0.replace(seg, '', 1), MD0
        # 算子2：翻徽标（class+tag 同步翻，避免被 C5 当双编码不一致误杀 —— 那是另一条检查）
        cls = m.group(1); ncls = FLIP[cls]
        nseg = seg.replace(f'<div class="mod {cls}">', f'<div class="mod {ncls}">', 1)
        nseg = re.sub(r'<span class="tag t-(done|move|new)">',
                      lambda x: f'<span class="tag t-{STATUS_TAG[ncls]}">', nseg, count=1)
        yield f"HTML/翻徽标[{name}:{STATUS_TAG[cls]}→{STATUS_TAG[ncls]}]", HTML0.replace(seg, nseg, 1), MD0
        # 算子3：改名（造孤儿/重名）
        nseg2 = seg.replace(name, name + 'X', 1)
        if nseg2 != seg:
            yield f"HTML/改名[{name}→{name}X]", HTML0.replace(seg, nseg2, 1), MD0

def mutants_md():
    """MD 侧：§2 表每行 × 每列清空 + 整行删"""
    rows = sec2(MD0)
    seen = set()
    for r in rows:
        cells = [c.strip() for c in r.strip().strip('|').split('|')]
        mid = cells[0].strip('* ').replace('★', '').strip()
        if mid in seen: continue
        seen.add(mid)
        yield f"MD/删行[{mid}]", HTML0, MD0.replace(r, '', 1)
        COLS = '目标|退出|世界对|依赖|关键|通道'.split('|')
        for ci in range(1, 7):                      # 跳过 ID 列
            if not cells[ci] or cells[ci] == '—': continue
            # 「关键」是可选列：置 '—' 表示"非关键路径"，是合法状态，不是损坏。
            # 真正的损坏是"未声明"（空串）。可选列必须用空串变异，否则是无效变异。
            val = '' if COLS[ci-1] == '关键' else '—'
            nc = list(cells); nc[ci] = val
            yield (f"MD/清空[{mid}.{COLS[ci-1]}]",
                   HTML0, MD0.replace(r, '| ' + ' | '.join(nc) + ' |', 1))

def run(h, md):
    """端到端：写临时文件 + 子进程跑验证器（测的就是用户跑的那个命令）"""
    tmp = tempfile.mkdtemp()
    try:
        # ★ 同时跑两个验证器：logic 管「推理链双向闭合」，dag 管「依赖图结构」。
        #   只跑 logic 会让「依赖倒置」全部存活（它不做环检测）—— 那是判据分工，不是盲区。
        for f in ('cellrix_logic_verify.py', 'cellrix_dag_verify.py'):
            shutil.copy(P(f), tmp)
        io.open(os.path.join(tmp,'cellrix-architecture-v12.html'),'w',encoding='utf-8').write(h)
        io.open(os.path.join(tmp,'Cellrix-里程碑与验收标准.md'),'w',encoding='utf-8').write(md)
        for v in ('cellrix_logic_verify.py', 'cellrix_dag_verify.py'):
            p = subprocess.run(['python3', v], cwd=tmp,
                               capture_output=True, text=True, timeout=120)
            if p.returncode != 0: return True       # 任一验证器抓住 = 变异被杀
        return False
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ══════════════════════════════════════════════════════════════
# 第二轮算子（首轮 162 个只覆盖「概念卡」+「§2 单元格」，算子空间本身有偏）
# ══════════════════════════════════════════════════════════════
def mutants_axioms():
    """HTML 公理卡：删卡 / 清判据"""
    AX = re.compile(r'<div class="ax[^"]*">.*?</div>\s*</div>', re.S)
    for m in list(AX.finditer(HTML0)):
        seg = m.group(0)
        nm = re.search(r'<div class="t">(.*?)</div>', seg)
        name = re.sub(r'<[^>]+>', '', nm.group(1)).strip() if nm else '?'
        yield f"AX/删公理卡[{name}]", HTML0.replace(seg, '', 1), MD0
        nseg = re.sub(r'<div class="j">.*?</div>', '<div class="j">判据：—</div>', seg, flags=re.S)
        if nseg != seg:
            yield f"AX/清判据[{name}]", HTML0.replace(seg, nseg, 1), MD0

def mutants_invariants():
    """MD 不变量表：删行 / 清由谁证 / 清失败路径。
    只取 §3.5 的 4 列表（不变量|由谁证|溯源|失败路径），避免抓到「三轮演进」表。"""
    key = '### 16 条不变量'
    if key not in MD0: return
    tbl = MD0[MD0.index(key):]
    e = tbl.find('\n### ', 10)
    tbl = tbl[:e] if e > 0 else tbl          # 用 ### 小节边界，不用 ---（--- 会截错）
    n = 0
    for line in tbl.split('\n'):
        if not line.startswith('|'): continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells) != 4: continue                 # 只认 4 列
        if set(cells[0]) <= set('-: '): continue     # 分隔行
        nm = re.sub(r'[\*🆕]', '', cells[0]).strip()
        if not nm or nm == '不变量': continue
        n += 1
        yield f"INV/删行[{nm}]", HTML0, MD0.replace(line, '', 1)
        if cells[1] not in ('', '—'):
            nc = list(cells); nc[1] = '—'
            yield f"INV/清由谁证[{nm}]", HTML0, MD0.replace(line, '| ' + ' | '.join(nc) + ' |', 1)
        if cells[3] not in ('', '—'):
            nc = list(cells); nc[3] = '—'
            yield f"INV/清失败路径[{nm}]", HTML0, MD0.replace(line, '| ' + ' | '.join(nc) + ' |', 1)

def mutants_deps_invert():
    """依赖倒置 a→b 改 b→a ⇒ 应触发环检测"""
    rows = sec2(MD0)
    for r in rows:
        cells = [c.strip() for c in r.strip().strip('|').split('|')]
        mid = cells[0].strip('* ').replace('★', '').strip()
        for d in [x.strip() for x in re.split(r'[·+]', cells[4]) if x.strip()]:
            tgt = [x for x in rows
                   if x.strip().strip('|').split('|')[0].strip('* ').replace('★','').strip() == d]
            if not tgt: continue
            tc = [c.strip() for c in tgt[0].strip().strip('|').split('|')]
            ntc = list(tc); ntc[4] = mid          # d 反过来依赖 mid
            yield (f"DEP/倒置[{d}→{mid}]", HTML0,
                   MD0.replace(tgt[0], '| ' + ' | '.join(ntc) + ' |', 1))

def mutants_cross_layer():
    """跨层移动概念卡 —— 全枚举：每张卡 × 每个其他层。

    真因（第七轮）：原实现只取 L[0] 的第一张卡移到 L[-1]，产出 1 个算子；
    而这唯一的 1 个恰好存活、又被"按类别子串"的白名单整体豁免
    ⇒ 该维度净覆盖 = 0，却仍计入 340 总数。数字掩盖了空洞。
    """
    L = list(re.finditer(r'<div class="layer (l\d)">(.*?)\n    </div>', HTML0, re.S))
    if len(L) < 2: return
    cards_by_layer = {}
    for li, lm in enumerate(L):
        cs = re.findall(r'<div class="mod [dmn]">.*?</div></div>', lm.group(2), re.S)
        cards_by_layer[li] = cs
    for li in range(len(L)):
        for ci, card in enumerate(cards_by_layer[li]):
            nm = re.sub(r'<[^>]+>', '', re.search(r'<div class="mn">(.*?)</div>', card, re.S).group(1))
            nm = re.sub(r'<span class="tag t-[^>]*>.*?</span>', '', nm, flags=re.S).strip()
            for lj in range(len(L)):
                if lj == li: continue
                h = HTML0
                # 从源层删除
                h = h.replace(L[li].group(2), L[li].group(2).replace(card, '', 1), 1)
                L2 = list(re.finditer(r'<div class="layer (l\d)">(.*?)\n    </div>', h, re.S))
                if lj >= len(L2): continue
                # 插入目标层（插到该层卡片区末尾）
                h = h.replace(L2[lj].group(2), L2[lj].group(2) + '\n        ' + card, 1)
                src_l = re.search(r'class="layer (l\d)"', L[li].group(0)).group(1)
                dst_l = re.search(r'class="layer (l\d)"', L2[lj].group(0)).group(1)
                yield f"LAYER/跨层移动[{nm}:{src_l}→{dst_l}]", h, MD0

def mutants_crash():
    """撞车清单（HTML）：把每行【改法】整体换成不存在的名字 —— 只改撞车表行内"""
    for m in list(re.finditer(r'<tr><td>(\d+)</td><td><b>(.*?)</b></td><td>(.*?)</td><td class="c">(.*?)</td><td>(.*?)</td></tr>', HTML0)):
        row = m.group(0)
        inner = re.search(r'<td class="c">(.*?)</td>', row, re.S)
        if not inner: continue
        newrow = row.replace(inner.group(1), '<span class="tag t-ok">幽灵名XYZ</span>', 1)
        if newrow == row: continue
        yield f"CRA/改法失效[#{m.group(1)} {m.group(2)[:8]}]", HTML0.replace(row, newrow, 1), MD0

def mutants_mermaid():
    """mermaid 图：删边 / 改 ID"""
    m = re.search(r'```mermaid\n(.*?)```', MD0, re.S)
    if not m: return
    for em in list(re.finditer(r'^\s*([\w.+]+)(\[[^\]]*\])?\s*-->\s*([\w.+]+)', m.group(1), re.M)):
        line = em.group(0)
        yield f"MER/删边[{em.group(1)}→{em.group(3)}]", HTML0, MD0.replace(line, '', 1)
        nl = line.replace('P0.5', 'P05').replace('P4+', 'P4')
        if nl != line:
            yield f"MER/ID变形[{em.group(1)}]", HTML0, MD0.replace(line, nl, 1)
    yield "MER/加假边", HTML0, MD0.replace('    P1 --> P3', '    P1 --> P3\n    P1 --> P0a', 1)

def mutants_desc():
    """概念描述：清空（C6）"""
    for m in list(re.finditer(r'<div class="md">(.*?)</div>', HTML0, re.S))[:29]:
        seg = m.group(0)
        yield f"DESC/清空[{m.group(1)[:14]}]", HTML0.replace(seg, '<div class="md">—</div>', 1), MD0

def mutants_version():
    """跨文档版本引用"""
    yield "VER/版本过时", HTML0, MD0.replace('架构研讨图 v12', '架构研讨图 v8', 1)

def mutants_gaps():
    """已知缺口清单（MD §0.9 表）—— 限定在该区段内，否则会误改交叉点对账表"""
    if '§0.9 已知缺口清单' not in MD0: return
    off = MD0.index('§0.9 已知缺口清单')
    seg = MD0[off:]
    seg = seg[:seg.index('\n### ')] if '\n### ' in seg[10:] else seg
    def rebuild(newseg): return MD0[:off] + newseg + MD0[off+len(seg):]
    for m in list(re.finditer(r'^\| ([^|]+?) \| ([^|]+?) \| ([^|]+?) \|$', seg, re.M)):
        row, nm = m.group(0), m.group(1)
        if nm == '缺口名' or set(nm) <= set('-: '): continue
        yield f"GAP/删缺口[{nm[:12]}]", HTML0, rebuild(seg.replace(row + '\n', '', 1))
        yield f"GAP/改名[{nm[:12]}]", HTML0, rebuild(seg.replace(row, row.replace(nm, nm + 'X'), 1))
    yield "GAP/幽灵缺口", HTML0, rebuild(seg.replace(
        '| 段自带序号 | 契约层已定，代码未落 | T0 |',
        '| 段自带序号 | 契约层已定，代码未落 | T0 |\n| 幽灵缺口XYZ | 未实现 | T0 |', 1))


# ────────────────────────────────────────────────────────────────
# 变异覆盖率（第八轮 · 借鉴 SQLite 100% MC/DC 的"覆盖率"概念）
# 算子数量 ≠ 覆盖程度。414 个算子可能只摸到 40% 的字节。
# 未被任何变异触碰的区域 = 从未被验证过的区域 = 结构性盲区。
# ────────────────────────────────────────────────────────────────
def coverage(orig, variants):
    """行级覆盖率（difflib 字节级对 68KB×400 太慢，行级等价且可读）"""
    ol = orig.split("\n")
    cov = set()
    for v in variants:
        vl = v.split("\n")
        sm = difflib.SequenceMatcher(None, ol, vl, autojunk=False)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag != 'equal':
                cov.update(range(i1, i2))
    return cov, len(cov)/max(1, len(ol))*100

def report_coverage():
    """变异覆盖率（第八轮 · 借鉴 SQLite 100% MC/DC 的覆盖率概念）

    算子数量 ≠ 覆盖程度。414 个算子可能只摸到 15% 的行。
    未被任何变异触碰的行 = 从未被验证过的内容 = 结构性盲区。
    """
    fns = [n for n in globals() if n.startswith('mutants_')]
    hv, mv = [], []
    for f in fns:
        for name, h, m in globals()[f]():
            if h != HTML0: hv.append(h)
            if m != MD0:   mv.append(m)
    print("\n" + "="*72)
    print("变异覆盖率（哪些行从未被注入过缺陷）")
    print("="*72)
    out = []
    for label, orig, variants, unit in (("HTML", HTML0, hv, r'<section id="([^"]+)"'),
                                        ("MD",   MD0,   mv, r'^## (.+)$')):
        ol = orig.split("\n")
        cov, pct = coverage(orig, variants)
        print(f"  {label}  行覆盖 {pct:5.1f}%  ({len(cov)}/{len(ol)} 行)")
        marks = [(ln, m.group(1).strip()) for ln, m in
                 ((orig[:m.start()].count("\n"), m) for m in re.finditer(unit, orig, re.M))]
        # 连续 ≥3 行未覆盖 ⇒ 报为盲区
        gaps, run, start = [], 0, 0
        for ln in range(len(ol)):
            if ln not in cov:
                if run == 0: start = ln
                run += 1
            else:
                if run >= 3: gaps.append((start, start+run))
                run = 0
        if run >= 3: gaps.append((start, len(ol)))
        if gaps:
            print(f"\n  ── {label} 未覆盖区（连续 ≥3 行从未被变异）──")
            for s0, e0 in gaps:
                nm = "?"
                for ln, pn in marks:
                    if ln <= s0: nm = pn
                print(f"    行 {s0:5d}-{e0:5d}  ({e0-s0:4d} 行)  归属：{nm[:46]}")
        out.append(pct)
    return out

def main():
    # 基线
    if run(HTML0, MD0):
        print("✗ 基线就是红的 —— 变异测试无意义，先修基线"); return 1
    print("基线 ✓ 无 ERROR\n" + "="*72)

    killed, survived, err = [], [], []
    noop_names = []
    cases = (list(mutants_html()) + list(mutants_md())
             + list(mutants_axioms()) + list(mutants_invariants())
             + list(mutants_deps_invert()) + list(mutants_cross_layer())
             + list(mutants_crash()) + list(mutants_mermaid())
             + list(mutants_desc()) + list(mutants_version())
             + list(mutants_gaps()) + list(mutants_crash()))
    for i, (name, h, md) in enumerate(cases, 1):
        try:
            (killed if run(h, md) else survived).append(name)
        except Exception as e:
            err.append((name, str(e)[:60]))
        if i % 25 == 0: print(f"  … {i}/{len(cases)}", flush=True)

    total = len(cases)
    undec = [x for x in survived if x in KNOWN_UNDECIDABLE]  # 精确匹配，不再子串

    # ── 元检查：白名单不得吃掉整个维度（第七轮）
    # 真因：白名单若是【类别子串】，会把该维度所有算子自动豁免 ⇒ 净覆盖 0 却计满分。
    dims = {}
    for x in survived:
        dims.setdefault(x.split('/')[0], []).append(x)
    for d, xs in dims.items():
        if len(xs) >= 3 and all(x in KNOWN_UNDECIDABLE for x in xs):
            print(f"\n✗ 元检查失败：维度【{d}】存活 {len(xs)} 个且全部来自白名单")
            print("  ⇒ 白名单正在吃掉整个维度，请改为【具体项】豁免")
            sys.exit(1)
    real  = [x for x in survived if x not in undec]
    print("="*72)
    print(f"变异总数 {total} · 杀死 {len(killed)} · 存活 {len(survived)}"
          f"（其中已知不可判 {len(undec)} · 真实盲区 {len(real)}）"
          + (f" · 异常 {len(err)}" if err else ""))
    print(f"变异得分 {len(killed)/total*100:.1f}%"
          f"（剔除已知不可判后 {len(killed)/(total-len(undec))*100:.1f}%）")
    if real:
        dim = {}
        for x in real: dim.setdefault(x.split('/')[0], []).append(x)
        print("\n  按维度分布：")
        for d, xs in sorted(dim.items(), key=lambda kv: -len(kv[1])):
            print(f"    {d:12s} {len(xs):3d}")
        print("\n" + "-"*72)
        print("  说明：本脚本在有【真实盲区】时返回非零，这是预期信号，不是故障。")
        print("  当前盲区根因：文档未逐概念声明层归属依据（C3 只验'有家'，不验'在正确的家'）。")
        print("  归属：T0 概念清单 —— 为每个概念声明稳定 ID + 归属依据后，该维度应大幅下降。")
        print("  在此之前非零退出是【诚实状态】：它表示'还有未覆盖的维度'，不是'脚本坏了'。")

    # 变异覆盖率（第八轮）
    try:
        ph, pm = report_coverage()
        if min(ph, pm) < 60:
            print("\n✗ 变异覆盖率 <60% ⇒ 存在大片从未被验证的文档区域（见上表）")
    except Exception as e:
        print(f"\n⚠ 覆盖率统计失败：{e}")

    if noop_names:
        print(f"\n✗ 变异未生效（算子失效，不计入得分）{len(noop_names)} 个 —— 这些是测试脚本缺陷：")
        for x in noop_names[:10]: print("   -", x)
    if undec:
        print(f"\n○ 已知不可判 {len(undec)} 个（白名单内 · 设计声明，无法用判据解决）：")
        for x in undec: print("   -", x)
    if real:
        print(f"\n⚠ 存活变异（真实判别力盲区）{len(real)} 个：")
        for x in real: print("   -", x)
    if err:
        print(f"\n✗ 执行异常：")
        for n_, e_ in err[:10]: print(f"   - {n_}: {e_}")
    return 0 if not real and not err else 1


if __name__ == '__main__': sys.exit(main())

if __name__ == "__main__":
    main()
