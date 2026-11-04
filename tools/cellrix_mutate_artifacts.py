# -*- coding: utf-8 -*-
"""产物级变异测试：直接改坏真实 HTML / MD，验证器必须红。
   这是验证器自身的 V>0 检验 —— 比内存注入更硬，因为它测的是「真实文件改坏了会不会被发现」。"""
import os

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
import io,re,os,shutil,subprocess,tempfile,sys

def load():
    return (io.open(_find('cellrix-architecture*.html'),encoding='utf-8').read(),
            io.open(_find('Cellrix-里程碑*.md'),encoding='utf-8').read())

def sec2_rows(md):
    t=md[md.index('## 2 · 里程碑总表'):md.index('**约束（非目标）**')]
    return [l for l in t.split('\n')
            if l.startswith('| **') and len([c for c in l.strip().strip('|').split('|')])==7]

def replace_row(md, ident, fn):
    for r in sec2_rows(md):
        cells=[c.strip() for c in r.strip().strip('|').split('|')]
        if cells[0].strip('* ').replace('★','').strip()==ident:
            new=fn(cells)
            return md.replace(r, '| '+' | '.join(new)+' |', 1)
    raise KeyError(ident)

def build():
    HTML,MD=load(); C={}
    # ── 概念侧
    m=re.search(r'<div class="mod [dmn]"><div class="mn"><span class="tag t-done">现状</span>事件流</div>.*?</div></div>\n',HTML,re.S)
    C['删掉一张概念卡（29→28）']=(HTML.replace(m.group(0),'',1),MD)
    # 定位到「层图卡片内部」再改徽标（否则会打到 §1 公理卡里的同名文字，变异无效）
    _l2=re.search(r'<div class="layer l2">(.*?)\n    </div>',HTML,re.S).group(1)
    _new=_l2.replace('<span class="tag t-done">现状</span>对象图','<span class="tag t-new">新</span>对象图',1)
    C['把一张卡徽标改成"新"（11/4/14 失衡）']=(HTML.replace(_l2,_new,1),MD)
    C['制造同层重名']=(HTML.replace('<span class="tag t-done">现状</span>生命周期</div>','<span class="tag t-done">现状</span>对象图</div>',1),MD)
    # ── 里程碑侧（精确命中 §2 表）
    C['删掉 P0d 整行']=(HTML,replace_row(MD,'P0d',lambda c:None) if False else MD.replace(sec2_rows(MD)[[r for r in sec2_rows(MD) if 'P0d' in r][0] and 0] if False else [r for r in sec2_rows(MD) if 'P0d' in r][0],'',1))
    C['清空 P0b 的世界对']=(HTML,MD.replace([r for r in sec2_rows(MD) if 'P0b' in r][0],
        '| **P0b** | 确定性：重放能重建同一状态 | 20 个结构性操作 `kill -9` 后重放 hash A == B | — | P0a | ✅ | CI |',1))
    C['P1 退出条件写成工期']=(HTML,MD.replace([r for r in sec2_rows(MD) if 'P1 ★' in r or r.startswith('| **P1 ★')][0],
        '| **P1 ★** | 事实源活过界面退出 | 做完 5 天即可 | 界面退出后内容存活 / 内容随界面停止 | P0.5 | ✅ | 集成 |',1))
    C['P3 依赖改成不存在的格']=(HTML,replace_row(MD,'P3',lambda c: c[:4]+['ZZZ']+c[5:]))
    C['P2 世界对抄 P1']=(HTML,replace_row(MD,'P2',lambda c: c[:3]+['界面退出后内容存活 / 内容随界面停止']+c[4:]))
    C['P0a 变异通道清空']=(HTML,replace_row(MD,'P0a',lambda c: c[:6]+['—']))
    C['T0 删掉目标']=(HTML,replace_row(MD,'T0',lambda c: ['**T0**','']+c[2:]))
    return C

def main():
    tmp=tempfile.mkdtemp(); shutil.copy(P('cellrix_logic_verify.py'),tmp)
    H0,M0=load()
    io.open(os.path.join(tmp,'cellrix-architecture-v12.html'),'w',encoding='utf-8').write(H0)
    io.open(os.path.join(tmp,'Cellrix-里程碑与验收标准.md'),'w',encoding='utf-8').write(M0)
    b=subprocess.run(['python3','cellrix_logic_verify.py'],cwd=tmp,capture_output=True,text=True)
    print(f"基线：rc={b.returncode} {'✓ 无 ERROR' if b.returncode==0 else '✗ 基线就红了，测试无意义'}")
    if b.returncode!=0: print(b.stdout[:600]); return 1
    print("-"*66)
    ok=0; cases=build()
    for name,(h,md) in cases.items():
        io.open(os.path.join(tmp,'cellrix-architecture-v12.html'),'w',encoding='utf-8').write(h)
        io.open(os.path.join(tmp,'Cellrix-里程碑与验收标准.md'),'w',encoding='utf-8').write(md)
        p=subprocess.run(['python3','cellrix_logic_verify.py'],cwd=tmp,capture_output=True,text=True)
        out=p.stdout
        if '✗ 未闭合' in out:                      # 只取 ERROR 段，排除 ⚠ 已知缺口 段
            blk=out[out.index('✗ 未闭合'): out.index('⚠ 已知缺口') if '⚠ 已知缺口' in out else len(out)]
        else:
            blk=''
        errs=[l.strip()[2:] for l in blk.split('\n') if l.strip().startswith('- [')]
        red = p.returncode!=0 and bool(errs)
        print(f"  {'PASS' if red else 'FAIL'}  {name}")
        print(f"        ↳ {errs[0][:70] if errs else '★未报红★'}")
        ok+=red
    print("-"*66)
    print(f"产物级变异 {ok}/{len(cases)}" + (" ✓ 真实文件改坏必红" if ok==len(cases) else " ✗ 存在真实文件改坏却不红"))
    return 0 if ok==len(cases) else 1

if __name__=='__main__': sys.exit(main())
