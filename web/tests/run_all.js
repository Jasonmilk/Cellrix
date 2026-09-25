#!/usr/bin/env node
/* Regression net runner (Cellrix:ADR-0018 T6).
 *
 * Runs every self-contained node suite and reports one line each. Suites that
 * need an input this runner cannot supply are listed as SKIPPED with the reason
 * — a suite that is quietly not running is indistinguishable from a suite that
 * passes, which is the failure mode this exists to prevent.
 *
 * Usage: node run_all.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/* ── 铁律：校验器不得把 [ENG] 阈值写成硬断言 ────────────────────────────────
 *
 * 来源：`Cellrix:ADR-0022` §2.5（工具纪律）。硬度分级见该 ADR §2.4。
 *
 * 理由：**机器把陶土固化成钻石，比手写冒充更隐蔽。** 一条断言「视图数 = 4」「列表 ≤ N
 * 条」的测试，会把一个工程约定变成**看起来有测试保护的事实**，后来者不敢改它。
 *
 * 判据：
 *   ✗ 禁止 —— assert(views.length === 4)          工程约定被当成事实
 *   ✓ 允许 —— assert(views.length > 0)            结构性不变量
 *   ✓ 允许 —— console.log('views =', n)           报告当前值
 *   ✓ 允许 —— assert(n === EXPECTED_FROM_CONFIG)  值来自配置/单一来源
 *
 * 检查器（N1b，已落地）：`checkEngAssertions()` 扫全部测试文件，只抓**导航形态计数**
 * 与字面量的比较（`views` / `navItems` / `navEntries` / `tiers` / `panes`）。做窄是有意的
 * ——N-001/N-002 被判陶土**正因为没有数字可论证**，所以这类断言必然在断言一个**编造的
 * 阈值**；而宽扫描器会误报，**没人信的检查比没有检查更糟**。
 * 非空转已由**变异注入**证明：临时植入 `assert(views.length === 4)` ⇒ 检查器变红；
 * 移除 ⇒ 转绿（见提交信息与 ADR-0022 §4 验收第 2 条）。
 * ────────────────────────────────────────────────────────────────────── */

const SELF_CONTAINED = [
  ['event_family_test.js', 'T0 — event family contract'],
  ['assembly_test.js', 'T2 — fold primitives and coordinates'],
  ['acceptance_test.js', 'T6 — the 11 acceptance clauses'],
  ['chain_merge_test.js', 'L0 — merging periods into one stream'],
  ['dom_contract_test.js', 'DOM contract — inventory matches the sources'],
  ['naming_test.js', 'two naming accidents, made structurally impossible'],
  ['prove_track_nodes_test.js', 'trajectory — real chain through the Node layer'],
  ['pt_replay.js', 'trajectory — metering and panes against real files'],
  ['hash_state_test.js', 'URL hash — the addressable selection state'],
  ['wayout_test.js', 'the exit layer — state to (sentence, action) (ADR-0044)'],
  ['nav_state_test.js', 'ONE selection state — structurally (ADR-0022 N-003)'],
  /* K-088 一族 / Q7 闭环：账本状态列不得让未知冒充通过或失败。
   * 必须是 JS 侧套件 —— `cockpit.js` 经 `include_str!` 烧进二进制，`cargo test`
   * 只能做子串断言，证明不了这段逻辑对不对。见该文件头。 */
  ['cockpit_status_test.js', 'ledger status — unknown is never a pass and never a failure (K-088)'],
  ['ledger_rows_test.js', 'ledger rows — keyed reuse, not a whole-table rebuild'],
  ['prove_track_rows_test.js', 'trajectory rows — keyed reuse, not a whole-table rebuild (PANEL-PLAN §2)'],
  ['session_list_test.js', 'session list — keyed reuse of cards, not a whole-sidebar rebuild (PANEL-PLAN §2)'],
  ['flows_suppliers_test.js', 'flows supplier config — panel proxy contract, key never echoed (PANEL-PLAN §3)'],
  /* The chain's wiring facts have ONE source (anaphase:ADR-0046). This asserts a
   * launcher *derives* rather than restates them — a restated port is a port that
   * will drift, which is exactly how three launchers came to disagree. */
  ['chain_wiring_test.js', 'chain wiring — launchers derive from the one declaration (anaphase:ADR-0046)'],
  /* The render table decides the row set. This pins the SHAPE of a thin
   * (reply-only) turn, so a panel that shows nothing for a real turn can be
   * told apart from a table that has nothing to show. */
  ['row_shape_test.js', 'row shape — a reply-only turn still renders non-reply rows'],
  /* The Anaphase <-> FlowModus reasoning contract. Two vendored .proto copies plus
   * a field whose NAME disagreed with its MEANING: that cost three rounds of
   * diagnosis, because both sides were internally consistent and neither errored. */
  ['proto_contract_test.js', 'proto contract — one fact per field, and the two copies must not drift'],
  /* The chain's soundness over real recordings: a call with no result, a `Met`
   * verdict beside a failing check, or a usage row with only a total are the
   * shapes that let a chain look whole while a leg was never used. */
  ['chain_legs_test.js', 'chain legs — executor/memory/metering exercised, and the pairings hold'],
  /* Not a web suite: this validates the ADR-0022 anchoring table and every ADR
   * reference in the repo (ADR-0022 §4.1). It rides the net because the net is
   * the one entry point that actually gets run — a criterion nobody runs is a
   * sentence, not an acceptance test. */
  ['../../tools/adr_anchor.js', 'ADR anchoring table + references (ADR-0022 §4.1)']
];

/* The panel test is RUN when the panel is reachable and SKIPPED only when it is
 * not — never silently skipped while it is up. The base used to be hardcoded to
 * :18932 while the panel actually serves :8080 (the default was 8080 at the time; it is 50050 since Cellrix:ADR-0046), so this test sat idle for as long
 * as that mismatch existed: a passing test that never ran, which is worse than no
 * test because it looks like coverage. Override with CELLRIX_PANEL. */
/* The panel's address comes from the ONE declaration, not from a literal here.
 * Measured 2026-09-24: this file, the shell launcher, the binary and two suites
 * each carried their own default (8080 / 18932 / 50050) for the same fact. */
const WS_ROOT = path.resolve(__dirname, '..', '..', '..');
function declared(kind) {
  try {
    const d = JSON.parse(fs.readFileSync(
      path.join(WS_ROOT, 'anaphase-helix', 'ecosystem', 'chain.json'), 'utf8'));
    const c = (d.components || []).find(function (x) { return x.name === kind; });
    return c ? 'http://127.0.0.1:' + c.port : '';
  } catch (e) { return ''; }
}
const PANEL = process.env.CELLRIX_PANEL || declared('panel');

/* 可达性探针：**超时要宽、失败要重试**。
 *
 * 实测三次（面板两次、浏览器一次）：单一 1500ms 的探测会在机器忙时偶发失败，而
 * 失败一侧的后果是"套件静默消失"——本文件头一句讲的正是这个形状。探不到就等于
 * 没覆盖，所以宁可贵一点：4 秒 × 2 次。 */
function reachable(url, defPort, tries = 2) {
  let host = '127.0.0.1', port = defPort;
  try { const u = new URL(url); host = u.hostname; port = u.port || defPort; } catch { return false; }
  const probe = 'const s=require("net").connect(' + Number(port) + ',' + JSON.stringify(host) + ');' +
    's.on("connect",()=>{s.end();process.exit(0)});' +
    's.on("error",()=>process.exit(1));' +
    'setTimeout(()=>process.exit(1),4000);';
  for (let i = 0; i < tries; i++) {
    try { execFileSync(process.execPath, ['-e', probe], { stdio: 'ignore' }); return true; }
    catch { /* 再试一次 */ }
  }
  return false;
}

const PANEL_UP = reachable(PANEL, 80);

/* ── 几何守卫：能连上浏览器就跑，连不上才 SKIP ────────────────────────────────
 *
 * `layout_test.js` 以前**无条件**列为 SKIP，哪怕 Chrome 就在 9222 上等着。结果是
 * 项目里唯一能看见"盒子按内容长"的检查长期不在网里——而它正是唯一能抓到下面这类
 * 缺陷的检查：切到证轨视图时表格已有 7 行，而装它的容器是 `display:none`（宽 0
 * 高 0），**界面一片空**。jsdom 看得见 textContent、看不见布局，那个 bug 在
 * jsdom 里是隐形的，只有真浏览器能抓。
 *
 * 这正是本文件头一句在讲的形状：一个悄悄没跑的套件与一个通过的套件无法区分。
 * 所以判据与面板套件一致——**可达就跑，不可达才说明原因**。 */
const CDP = process.env.CELLRIX_CDP || 'http://127.0.0.1:9222';
const CDP_UP = reachable(CDP, 9222);

const NEEDS_INPUT = [];
if (!(PANEL_UP && CDP_UP)) {
  NEEDS_INPUT.push(['layout_test.js',
    'needs the panel + a browser on ' + CDP + ': node layout_test.js ' + PANEL + ' ' + CDP + ' (see README)']);
  NEEDS_INPUT.push(['measure_test.js',
    'needs the panel + a browser on ' + CDP + ': node measure_test.js ' + PANEL + ' ' + CDP + ' (see README)']);
}

/* 按需渲染的**仪器**（量请求数、字节数与 DOM 重建次数）。
 *
 * 它是仪器而非判据：判据是它在报告里给出的那三条（不在台上 ⇒ 零重建 / 上台 ⇒ 有内容 /
 * 同一份数据不重复渲染）。放在这里登记，是因为本文件头一条就是"一个悄悄没跑的套件
 * 与一个通过的套件无法区分" —— 仪器也一样，不登记就等于没有。 */
if (!(PANEL_UP && CDP_UP)) {
  NEEDS_INPUT.push(['perf_measure.js',
    'needs the panel + a browser on ' + CDP + ': node perf_measure.js ' + PANEL + ' ' + CDP + ' (see README)']);
  NEEDS_INPUT.push(['hit_targets_test.js',
    'needs the panel + a browser on ' + CDP + ': node hit_targets_test.js ' + PANEL + ' ' + CDP + ' (see README)']);
}

if (PANEL_UP) {
  SELF_CONTAINED.push(['all_views_test.js', 'all views against the live panel — ' + PANEL]);
}
if (PANEL_UP && CDP_UP) {
  SELF_CONTAINED.push(['layout_test.js', 'geometry in a real browser — ' + CDP]);
  SELF_CONTAINED.push(['measure_test.js',
    'reading measure — text lines stay inside the token, no overflow — ' + PANEL + ' + ' + CDP]);
  SELF_CONTAINED.push(['perf_measure.js',
    'on-demand render: nothing off-stage is rebuilt — ' + PANEL + ' + ' + CDP]);
  SELF_CONTAINED.push(['hit_targets_test.js',
    'touch targets ≥ 44px on iPhone-class viewports — ' + PANEL + ' + ' + CDP]);
}

/* The concrete instance ADR-0022 §2.5 guards: the panel's own navigation shape.
 * Narrow by design — see the header note above. */
const ENG_FORBIDDEN = /\b(views?|navItems?|navEntries|tiers?|panes?)\b[^\n]*?[=!]==\s*\d+/;
function checkEngAssertions() {
  const bad = [];
  for (const f of fs.readdirSync(__dirname)) {
    if (!/_(test)\.js$/.test(f) && f !== 'pt_replay.js') continue;
    /* 不扫本文件：扫描器的自检夹具就住在这里，而"工具不得把自身算进守卫范围"
     * 与本仓 `guarded_paths.tsv` 的既有原则一致。 */
    if (f === 'run_all.js') continue;
    fs.readFileSync(path.join(__dirname, f), 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (ENG_FORBIDDEN.test(line)) bad.push(f + ':' + (i + 1) + '  ' + t);
    });
  }
  return bad;
}

/* ── 扫描器自检：**"非空转"必须被证明，不能只被写下** ────────────────────────
 *
 * 上面那段注释此前写着"非空转已由变异注入证明" —— 那是**一次人工实验的转述**，
 * 而**没有任何东西在检查它现在是否还成立**。若 `ENG_FORBIDDEN` 被改窄（或写错），
 * 扫描器会安静地对一棵坏树报"干净"，而注释仍然声称它是有效的。
 *
 * ⇒ 按 `nav_state_test.js` 已在本仓立下的形状（把 `scan()` 跑在**合成源**上，
 * 且合成源**必须**被报出来），把"非空转"做成每次运行都执行的**结构性自检**：
 *
 *   - **阳性**：一串**必须**被抓住的货（`assert(views.length === 4)`）⇒ 抓不到就是坏；
 *   - **阴性**：一串**必须**放行的（注释行、从单一来源取值的比较）⇒ 抓到就是误报。
 *
 * 两个方向都要：只测阳性会把"过宽的扫描器"放过去，而**没人信的检查比没有检查更糟**
 * （本文件头与 ADR-0022 §2.5 都这么说）。 */
const ENG_SELFTEST = {
  /* 必须被抓住。
   *
   * ⚠️ 用**字符串拼接**构造，不让这些字面量以完整形态出现在源码里 ——
   * 否则 `checkEngAssertions()` 会把 `run_all.js` **自己**报成违规
   * （本仓既有先例：`guarded_paths.tsv` 里 "the tool itself must not be able to
   * guard itself in"）。这同时也是对扫描器的一次真实检验：它扫的是**行**，
   * 拼接后的源码行不含完整禁形。 */
  mustCatch: [
    'check("nav", assert(views' + '.length === 4));',
    '  assert(navItems' + '.length === 3);',
    'if (panes' + '.length !== 2) fail();',
    'check("t", tiers' + '.length === 5);'
  ],
  /* 必须放行：结构性不变量 / 注释 / 值来自单一来源 */
  mustPass: [
    'check("structural", views.length > 0);',
    '// assert(views' + '.length === 4);',
    '  /* navItems' + '.length === 3 — historical note */',
    'check("from config", views.length === EXPECTED_FROM_CONFIG);'
  ]
};
function checkEngScannerSelfTest() {
  const bad = [];
  for (const line of ENG_SELFTEST.mustCatch) {
    if (!ENG_FORBIDDEN.test(line)) bad.push('MISSED (false negative): ' + line.trim());
  }
  for (const line of ENG_SELFTEST.mustPass) {
    const t = line.trim();
    const isComment = t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
    if (!isComment && ENG_FORBIDDEN.test(line)) bad.push('OVERREACH (false positive): ' + t);
  }
  return bad;
}

let failed = 0;
const results = [];
const failedRoster = [];

/* 先证明**检查器本身**有效，再用它去判别人。
 * 顺序有意如此：一个失效的扫描器会给出"干净"的结论，而那个结论看起来与真干净一样。 */
const engSelfBad = checkEngScannerSelfTest();
if (engSelfBad.length) {
  failed++; if (typeof file !== "undefined") { failedRoster.push(file + (typeof e !== "undefined" && e && e.status ? " (exit " + e.status + ")" : "")); }
  console.log('  FAIL  eng-scanner self-test     the scanner cannot see what it claims to forbid');
  engSelfBad.forEach(function (b) { console.log('        ' + b); });
}

const engBad = checkEngAssertions();
if (engBad.length) {
  failed++; if (typeof file !== "undefined") { failedRoster.push(file + (typeof e !== "undefined" && e && e.status ? " (exit " + e.status + ")" : "")); }
  console.log('  FAIL  eng-assertion check        ADR-0022 §2.5 — hard-asserted [ENG] value');
  engBad.forEach(function (b) { console.log('        ' + b); });
}

/* ── Exit code 3 = "this machine cannot supply one input I need" ─────────────
 *
 * The suite names what it is missing on its last line (`NEEDS-INPUT: <reason>`);
 * the runner records it as a **SKIP with the reason**, the same shape as
 * `NEEDS_INPUT` above. The reason is the file header's first sentence: **a suite
 * that quietly did not run is indistinguishable from one that passed** — and a
 * suite that is **permanently red with no information in the red** is worse,
 * because it trains people to ignore red, and then the real reds go too.
 *
 * Measured (2026-09-24 review): the real event files that
 * `prove_track_nodes_test.js` / `pt_replay.js` need
 * (`<workspace>/.helix/events/*.events.jsonl`, runtime output, never committed)
 * were lost in the machine migration, so both suites went **permanently red**
 * here. `layout_test.js`'s three checks need a real period, same story. None of
 * them was reporting "the product is broken".
 *
 * ⚠️ **This code is honoured only when the output contains no FAIL at all.**
 * Otherwise one real red would be buried under "needs input" — the exact thing
 * this file exists to prevent. */
const NEEDS_INPUT_EXIT = 3;

for (const [file, what] of SELF_CONTAINED) {
  const target = path.join(__dirname, file);
  /* Addresses are passed IN, so no suite needs a default of its own. */
  const extra = file === 'all_views_test.js' ? [PANEL]
    : (file === 'layout_test.js' || file === 'measure_test.js'
       || file === 'perf_measure.js' || file === 'hit_targets_test.js') ? [PANEL, CDP] : [];
  try {
    execFileSync(process.execPath, [target, ...extra], { stdio: 'pipe' });
    results.push(['PASS', file, what]);
  } catch (e) {
    const out = (e.stdout || Buffer.from('')).toString();
    const lines = out.trim().split('\n').filter(Boolean);
    const why = lines.filter(function (l) { return l.indexOf('NEEDS-INPUT:') === 0; }).pop();
    if (e.status === NEEDS_INPUT_EXIT && why && !/\bFAIL\b/.test(out)) {
      NEEDS_INPUT.push([file,
        why.replace(/^.*NEEDS-INPUT:\s*/, '') + '  — ' + what]);
      continue;
    }
    failed++; if (typeof file !== "undefined") { failedRoster.push(file + (typeof e !== "undefined" && e && e.status ? " (exit " + e.status + ")" : "")); }
    results.push(['FAIL', file, what]);
    if (lines.length) { console.log('    ' + lines.pop().trim()); }
  }
}

/* ── registered exceptions, and DEFAULT DENY ──────────────────────────────
 * Every unproven suite is one of: `requires` (a probed capability is absent),
 * `deferral` (the criterion is unreachable and has a retirement plan), or
 * `unknown` — and ONLY `unknown` blocks. There is deliberately no global
 * "allow" flag: a switch that exists gets used once, and then the gate is dead.
 * A `requires` entry is decided by its PROBE, not by the register: if the
 * probe says the capability IS here, the suite has no excuse and falls back to
 * unknown. Probe failure is never read as capability-absent. */
const DEFERRALS = (function () {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'deferrals.json'), 'utf8')); }
  catch (e) { return null; }
})();
function probeOk(name) {
  if (name !== 'cdp') { return null; }            // unknown probe => inconclusive
  try {
    execFileSync(process.execPath, ['-e',
      "fetch(process.env.CELLRIX_CDP||'http://127.0.0.1:9222/json/version',"
      + "{signal:AbortSignal.timeout(1500)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"],
      { stdio: 'ignore', timeout: 4000 });
    return true;
  } catch (e) { return false; }
}
function declaredRequires(file) {
  /* The SUITE says what it needs; the register cannot attach one. */
  try {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const m = src.match(/^const\s+REQUIRES\s*=\s*'([^']+)'/m);
    return m ? m[1] : null;
  } catch (e) { return null; }
}
function classify(file) {
  if (!DEFERRALS) { return { kind: 'unknown', why: 'no deferrals.json — nothing is registered' }; }
  const cap = declaredRequires(file);
  if (cap) {
    const entry = (DEFERRALS.requires || []).filter(function (r) { return r.id === cap; })[0];
    if (!entry) {
      return { kind: 'unknown', why: 'the suite declares REQUIRES=' + cap
        + ' but the register has no such capability' };
    }
    if (!entry.owner || !entry.probe) {
      return { kind: 'unknown', why: 'REGISTER-CORRUPT: capability ' + cap + ' lacks owner/probe' };
    }
    const p = probeOk(entry.probe);
    if (p === true) {
      return { kind: 'unknown', why: 'capability ' + cap
        + ' IS present (probed), yet this suite is unproven — that is not an absent capability' };
    }
    if (p === null) { return { kind: 'unknown', why: 'probe ' + entry.probe + ' is inconclusive' }; }
    return { kind: 'requires', why: cap + ' absent (probed, not dated)' };
  }
  for (const d of (DEFERRALS.deferrals || [])) {
    if (d.suite === file) {
      const plan = d.retirement_plan;
      const badPlan = !plan || typeof plan !== 'string' || plan.length < 40
        || plan.indexOf(d.id) === -1;
      if (badPlan) {
        return { kind: 'unknown', why: 'deferral ' + d.id + ': retirement_plan must be non-empty,'
                 + ' at least 40 characters, and name ' + d.id };
      }
      if (!d.depends_on) {
        return { kind: 'unknown', why: 'deferral ' + d.id + ' must DECLARE the input it depends on'
                 + ' (depends_on) instead of discovering it: a scanned input is a HIDDEN input,'
                 + ' and a hidden input drifts — measured 2026-09-24, this very deferral flipped'
                 + ' between unproven and red as runs wrote into the shared events directory' };
      }
      if (!d.expiry || isNaN(Date.parse(d.expiry))) {
        return { kind: 'unknown', why: 'deferral ' + d.id
                 + ': expiry must be a parseable ISO date (a prose date is not a check)' };
      }
      if (Date.parse(d.expiry) < Date.now()) {
        return { kind: 'unknown', why: 'deferral ' + d.id + ' EXPIRED on ' + d.expiry };
      }
      return { kind: 'deferral', why: d.id + ' (owner ' + d.owner + ', expires ' + d.expiry + ')' };
    }
  }
  return { kind: 'unknown', why: 'not registered in deferrals.json' };
}
/* My OWN un-done items live in the same register, with the same mandatory fields.
 * If they lived in a todo file they would be the exact failure mode this register
 * exists to kill — suites must be registered, but my own work need not. */
const pendingBad = [], pendingOverdue = [];
for (const w of (DEFERRALS.pending || [])) {
  const bad = !w.id || !w.owner || !w.due || isNaN(Date.parse(w.due))
    || !w.retirement_plan || String(w.retirement_plan).length < 40
    || String(w.retirement_plan).indexOf(w.id) === -1;
  if (bad) { pendingBad.push(w.id || '(no id)'); continue; }
  if (Date.parse(w.due) < Date.now()) { pendingOverdue.push(w.id + ' due ' + w.due); }
}
const attachAttempts = (DEFERRALS.requires || []).filter(function (r) { return r.suites; })
  .map(function (r) { return r.id; });
if (attachAttempts.length) {
  console.log('REGISTER ERROR: ' + attachAttempts.join(', ')
    + ' tries to ATTACH suites from the register. A suite declares its own requirement;'
    + ' attaching from here is how a suite gets hidden.');
  process.exit(3);
}
if (pendingBad.length) {
  console.log('REGISTER ERROR: pending item(s) missing id/owner/due/retirement_plan: '
    + pendingBad.join(', '));
  process.exit(3);
}

const DECL_SUITES = fs.readdirSync(__dirname).filter(function (f) {
  return f.endsWith('.js') && f.indexOf('known_bad') === -1;
});
const declLines = [];
for (const f of DECL_SUITES) {
  let src = '';
  try { src = fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch (e) { src = ''; }
  const m = src.match(/^const\s+REQUIRES\s*=\s*'([^']+)'\s*;?\s*$/m);
  if (m) { declLines.push(f + '=' + m[1]); }
}
/* POSITIVE CONTROL with an INDEPENDENT known-answer fixture (not self-proof):
 * a fixture file whose declarations are known by construction. If the reader
 * cannot read THAT, it is broken; if it reads N there but 0 in the suites, the
 * SET is wrong — which is the bug this control was written after. */
const FIXTURE = path.join(__dirname, 'decl_fixture.txt');
let fixtureN = 0;
try {
  const fx = fs.readFileSync(FIXTURE, 'utf8');
  fixtureN = (fx.match(/^const\s+REQUIRES\s*=\s*'[^']+'\s*;?\s*$/gm) || []).length;
} catch (e) { fixtureN = -1; }
if (fixtureN !== 3) {
  console.log('REGISTER ERROR: the reader failed its INDEPENDENT fixture (read ' + fixtureN
    + ' of a known 3). The reader is broken — not the suites.');
  process.exit(3);
}
if (declLines.length === 0) {
  console.log('REGISTER ERROR: the fixture reads fine, but no SUITE declared anything across '
    + DECL_SUITES.length + ' file(s) — the SET is wrong, not the reader.');
  process.exit(3);
}

/* The INPUT SHA is the capture for the drift bug: hash what the gate actually
 * looked at, so "same input, same result" becomes checkable instead of hoped for. */
function inputSha(rel) {
  try {
    const base = path.join(WS_ROOT, rel);
    const entries = fs.readdirSync(base).sort();
    const h = require('crypto').createHash('sha256');
    for (const e2 of entries) {
      try { h.update(e2 + ':' + fs.statSync(path.join(base, e2)).size + '\n'); } catch (x) { h.update(e2 + ':?\n'); }
    }
    return h.digest('hex').slice(0, 10);
  } catch (x) { return 'absent'; }
}
const DEFERRAL_INPUTS = (DEFERRALS.deferrals || []).map(function (d) {
  return d.id + '@' + (d.depends_on || '?') + '=' + inputSha(d.depends_on || '.');
});

const deferred = [], unknown = [];
/* XPASS — the semantic of `test.failing()` / `xfail(strict=True)`: a registered
 * deferral that PASSES means the criterion became reachable again, so the entry
 * must be retired NOW. A DATE is a heuristic (expiring is not the same as
 * reachable); XPASS is EVIDENCE (it really ran). This is also the missing
 * "the door can open" direction for deferrals. */
/* ABSENCE IS NOT A PASS. The first version of this tested only "not in
 * NEEDS_INPUT", which is equally true of a suite that was NEVER EXECUTED — it
 * would have reported XPASS for a suite that never ran. Positive evidence is
 * required: the suite must be one the runner actually EXECUTES (SELF_CONTAINED)
 * and it must not have reported unproven. This is the `0` / `null` / absent
 * family again, inside the detector for that family. */
const EXECUTED = SELF_CONTAINED.map(function (e) { return e[0]; });
const xpass = [];
for (const d of (DEFERRALS.deferrals || [])) {
  if (EXECUTED.indexOf(d.suite) > -1
      && !NEEDS_INPUT.some(function (e) { return e[0] === d.suite; })) {
    xpass.push(d.suite + ' [' + d.id + ']');
  }
}

for (const [file, why] of NEEDS_INPUT) {
  const c = classify(file);
  if (c.kind === 'unknown') { unknown.push([file, why, c.why]); }
  else { deferred.push([file, c.kind, c.why]); }
}

/* Derived AFTER the loop populates `deferred`. Computing these earlier made every
 * label vanish while the summary still said "5 held": the gate looked normal and
 * had silently dropped the information. Order matters. */
/* REGISTER-DRIVEN JOIN (the other direction). Iterate the REGISTER, locate each
 * named suite file, and require it to exist and to be something that can actually
 * be re-tested. A scan-driven version would move the SET bug instead of killing
 * it: measured 2026-09-24, the scanned set and the declaring set were different.
 * A deferral whose suite is neither declared nor executed is a suite nothing will
 * ever re-test -> it must carry an expiry or it is a permanent exemption. */
const joinProblems = [];
for (const d of (DEFERRALS.deferrals || [])) {
  let src = null;
  try { src = fs.readFileSync(path.join(__dirname, d.suite), 'utf8'); } catch (e) { src = null; }
  if (src === null) {
    joinProblems.push('deferral ' + d.id + ': suite file ' + d.suite + ' does not exist');
    continue;
  }
  const declared = /^const\s+REQUIRES/m.test(src);
  if (!declared && EXECUTED.indexOf(d.suite) === -1 && !d.expiry) {
    joinProblems.push('deferral ' + d.id + ': suite ' + d.suite
      + ' is neither declared nor executed, so nothing re-tests it — it must carry an expiry');
  }
}
if (joinProblems.length) {
  console.log('REGISTER ERROR: ' + joinProblems.join('; '));
  process.exit(3);
}

const heldAttempted = deferred.filter(function (r) { return EXECUTED.indexOf(r[0]) > -1; });
const heldNever = deferred.filter(function (r) { return EXECUTED.indexOf(r[0]) === -1; });



console.log('regression net');
for (const [status, file, what] of results) {
  console.log('  ' + status + '  ' + file.padEnd(24) + what);
}
for (const [file, kind, why] of heldAttempted) {
  console.log('  HELD  ' + file.padEnd(24) + '[' + kind + '] ' + why);
}
/* NEVER ATTEMPTED is not the same as ATTEMPTED BUT UNPROVEN — the first says
 * nothing about reachability, so it is the one that must carry an expiry. */
for (const [file, kind, why] of heldNever) {
  console.log('  HELD? ' + file.padEnd(24) + '[' + kind + '] NEVER ATTEMPTED — ' + why);
}
for (const [file, why, kwhy] of unknown) {
  console.log('  ????  ' + file.padEnd(24) + 'UNREGISTERED/BLOCKING — ' + kwhy);
}

console.log('');
/* THREE VERDICTS, not two.
 *
 * `proven` = a criterion was EXERCISED and passed. `unproven` = it was never
 * exercised (no fixture, no browser) — which is NOT the same as passing, and this
 * line used to lead with a bare `OK` while six suites had never run: the headline
 * read as a clean bill of health for a net that had not been applied.
 *
 * The exit code comes from CI-144's registered table, not from taste:
 *   0 all PASS · 1 has FAIL · 2 AMBIGUOUS · 3 the checker's own error.
 * "Not exercised" is precisely AMBIGUOUS — we can say neither pass nor fail. It
 * gets 2, and only when the caller ASKS to be held to full proof (`--require-all`,
 * the release-gate mode). A dev run stays 0 while nothing is red, so an absent
 * fixture cannot hold the tree hostage — that failure mode is on record here
 * (`K12`: "an unattended run stayed red" taught everyone to ignore it). */
const proven = results.filter(function (r) { return r[0] === 'PASS'; }).length;
const requireAll = process.argv.indexOf('--require-all') > -1;
/* ── SENTINEL PAIR: the roster's own calibration ─────────────────────────────
 * Two directions, both asserted, and NEITHER may change the exit code (a permanent
 * red that counted would weld the gate shut). Admission is by DECLARATION only. */
const SENT = DEFERRALS.sentinels || { red: [], held: [] };
const SENT_DIR = path.join(__dirname, SENT.dir || 'sentinels');
/* TWO-WAY JOIN with an INDEPENDENT directory. A declared set alone still lets an
 * ordinary suite be ADDED here, which would silently absorb a real red (it would
 * stop counting toward the exit code). Membership must be checkable, not asserted:
 * every declared name must exist, and every file present must be declared. */
{
  const declared = (SENT.red || []).concat(SENT.held || []).slice().sort();
  let present = [];
  try { present = fs.readdirSync(SENT_DIR).filter(function (f) { return f.endsWith('.js'); }).sort(); }
  catch (e) { present = []; }
  const bad = [];
  for (const nm of declared) { if (present.indexOf(nm) === -1) { bad.push('declared but absent: ' + nm); } }
  for (const nm of present) { if (declared.indexOf(nm) === -1) { bad.push('present but UNDECLARED: ' + nm); } }
  if (bad.length) {
    console.log('REGISTER ERROR: the sentinel declaration and ' + (SENT.dir || 'sentinels')
      + '/ disagree — ' + bad.join('; ') + ' (an undeclared suite here stops counting toward'
      + ' the exit code, so a real red would be silently absorbed)');
    process.exit(3);
  }
}
function runSentinel(f) {
  try { execFileSync(process.execPath, [path.join(SENT_DIR, f)], { stdio: 'pipe' }); return 0; }
  catch (e) { return (e && typeof e.status === 'number') ? e.status : -1; }
}
const sentProblems = [];
/* AN EMPTY DECLARED SET IS SILENT DEATH: deleting the sentinel from the register
 * would otherwise remove the control and every assertion with it. */
if (!(SENT.red || []).length || !(SENT.held || []).length) {
  sentProblems.push('the sentinel pair must be DECLARED (red and held): an empty set'
    + ' removes the control and its assertions silently');
}
for (const f of (SENT.red || [])) {
  const code = runSentinel(f);
  if (code === 1) {
    console.log('  RED ROSTER (sentinel, NOT counted): ' + f + ' (exit ' + code + ')');
  } else {
    sentProblems.push('SENTINEL_RED ' + f + ' returned ' + code + ', expected 1'
      + ' — the negative control is dead, so "the roster works" is unproven');
  }
}
for (const f of (SENT.held || [])) {
  const code = runSentinel(f);
  if (code !== 3) {
    sentProblems.push('SENTINEL_HELD ' + f + ' returned ' + code + ', expected 3');
  } else if (failedRoster.some(function (x) { return String(x).indexOf(f) > -1; })) {
    sentProblems.push('SENTINEL_HELD ' + f + ' appeared in the RED ROSTER'
      + ' — held and failed are being conflated, which is the bug this pair exists for');
  } else {
    console.log('  HELD  ' + f.padEnd(24) + '[sentinel] unproven on purpose, NOT counted');
  }
}
if (sentProblems.length) {
  console.log('REGISTER ERROR: ' + sentProblems.join('; '));
  process.exit(3);
}

if (failedRoster.length) {
  console.log('  RED ROSTER (a count is not attributable — name the members): '
    + failedRoster.join(', '));
}
if (xpass.length) {
  console.log('  XPASS ' + xpass.join(', ')
    + ' — registered as a deferral but it PASSED. The criterion is reachable again:'
    + ' retire the entry (a date is a heuristic; this is evidence).');
}
if (pendingOverdue.length) {
  console.log('  WARN  own un-done items past due: ' + pendingOverdue.join('; '));
}
console.log(failed === 0
  ? (unknown.length > 0
      ? 'BLOCKED — ' + proven + ' proven, ' + deferred.length + ' held (registered), '
        + unknown.length + ' UNREGISTERED, 0 red'
      : (NEEDS_INPUT.length === 0
          ? 'OK — ' + proven + ' proven, 0 unproven, 0 red'
          : 'NOT FULLY PROVEN — ' + proven + ' proven, ' + deferred.length
            + ' held (registered), 0 red  [in:' + DEFERRAL_INPUTS.join(' ') + ' pinned:' + (DEFERRALS.deferrals || []).filter(function (d) { return d.depends_on; }).length + '/' + SELF_CONTAINED.length + ' env: cdp=' + (probeOk('cdp') ? 'present' : 'absent') + ']'))
  : (xpass.length ? 'LEDGER STALE — ' + xpass.length + ' registered deferral(s) PASSED, ' : 'FAILED — ' + failed + ' red, ') + proven + ' proven, '
    + deferred.length + ' held, ' + unknown.length + ' unregistered');
/* XPASS is NOT a red test: a red test means "fix the code", XPASS means "fix the
 * ledger". Merging them into exit 1 would guarantee the wrong remedy, so XPASS
 * rides the register channel (3 = the checker's own bookkeeping is stale). */
process.exit(failed > 0 ? 1 : (xpass.length > 0 ? 3 : (unknown.length > 0 ? 2 : 0)));
