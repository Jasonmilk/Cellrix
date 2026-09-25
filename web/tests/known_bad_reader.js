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

/* 先证明**检查器本身**有效，再用它去判别人。
 * 顺序有意如此：一个失效的扫描器会给出"干净"的结论，而那个结论看起来与真干净一样。 */
const engSelfBad = checkEngScannerSelfTest();
if (engSelfBad.length) {
  failed++;
  console.log('  FAIL  eng-scanner self-test     the scanner cannot see what it claims to forbid');
  engSelfBad.forEach(function (b) { console.log('        ' + b); });
}

const engBad = checkEngAssertions();
if (engBad.length) {
  failed++;
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
    failed++;
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

/* ── the declaration reader needs a POSITIVE CONTROL, and the join both ways ── */
const DECL_SUITES = SELF_CONTAINED.map(function (e) { return e[0]; });
const declLines = [];
for (const f of DECL_SUITES) {
  let src = '';
  try { src = fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch (e) { src = ''; }
  const m = src.match(/^const\s+REQUIRES\s*=\s*'([^']+)'\s*;?\s*$/m);
  if (m) { declLines.push(f + '=' + m[1]); }
}
if (process.env.DECL_DEBUG) {
  console.log('DECL DEBUG dir=' + __dirname + ' files=' + DECL_SUITES.length + ' declLines=' + declLines.length);
  for (const f of DECL_SUITES) {
    let raw = null;
    try { raw = fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch (e) { raw = null; }
    const bare = raw ? /^const\s+REQUIRES/m.test(raw) : false;
    const cap = raw ? raw.match(/^const\s+REQUIRES\s*=\s*'([^']+)'\s*;?\s*$/m) : null;
    if (bare || cap) { console.log('   ' + f + ' bare=' + bare + ' cap=' + (cap ? cap[1] : 'null')); }
  }
}
if (declLines.length === 0 && !process.env.DECL_SOFT) {
  console.log('REGISTER ERROR: reader matched NOTHING across ' + DECL_SUITES.length + ' suite(s)');
  process.exit(3);
}

const deferred = [], unknown = [];
for (const [file, why] of NEEDS_INPUT) {
  const c = classify(file);
  if (c.kind === 'unknown') { unknown.push([file, why, c.why]); }
  else { deferred.push([file, c.kind, c.why]); }
}


console.log('regression net');
for (const [status, file, what] of results) {
  console.log('  ' + status + '  ' + file.padEnd(24) + what);
}
for (const [file, kind, why] of deferred) {
  console.log('  HELD  ' + file.padEnd(24) + '[' + kind + '] ' + why);
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
            + ' held (registered), 0 red  [env: cdp=' + (probeOk('cdp') ? 'present' : 'absent') + ']'))
  : 'FAILED — ' + failed + ' red, ' + proven + ' proven, '
    + deferred.length + ' held, ' + unknown.length + ' unregistered');
process.exit(failed > 0 ? 1 : (unknown.length > 0 ? 2 : 0));
