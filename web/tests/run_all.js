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
  /* Not a web suite: this validates the ADR-0022 anchoring table and every ADR
   * reference in the repo (ADR-0022 §4.1). It rides the net because the net is
   * the one entry point that actually gets run — a criterion nobody runs is a
   * sentence, not an acceptance test. */
  ['../../tools/adr_anchor.js', 'ADR anchoring table + references (ADR-0022 §4.1)']
];

/* The panel test is RUN when the panel is reachable and SKIPPED only when it is
 * not — never silently skipped while it is up. The base used to be hardcoded to
 * :18932 while the panel actually serves :8080, so this test sat idle for as long
 * as that mismatch existed: a passing test that never ran, which is worse than no
 * test because it looks like coverage. Override with CELLRIX_PANEL. */
const PANEL = process.env.CELLRIX_PANEL || 'http://127.0.0.1:8080';

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
}

/* 按需渲染的**仪器**（量请求数、字节数与 DOM 重建次数）。
 *
 * 它是仪器而非判据：判据是它在报告里给出的那三条（不在台上 ⇒ 零重建 / 上台 ⇒ 有内容 /
 * 同一份数据不重复渲染）。放在这里登记，是因为本文件头一条就是"一个悄悄没跑的套件
 * 与一个通过的套件无法区分" —— 仪器也一样，不登记就等于没有。 */
if (!(PANEL_UP && CDP_UP)) {
  NEEDS_INPUT.push(['perf_measure.js',
    'needs the panel + a browser on ' + CDP + ': node perf_measure.js ' + PANEL + ' ' + CDP + ' (see README)']);
}

if (PANEL_UP) {
  SELF_CONTAINED.push(['all_views_test.js', 'all views against the live panel — ' + PANEL]);
}
if (PANEL_UP && CDP_UP) {
  SELF_CONTAINED.push(['layout_test.js', 'geometry in a real browser — ' + CDP]);
  SELF_CONTAINED.push(['perf_measure.js',
    'on-demand render: nothing off-stage is rebuilt — ' + PANEL + ' + ' + CDP]);
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

for (const [file, what] of SELF_CONTAINED) {
  const target = path.join(__dirname, file);
  try {
    const extra = file === 'all_views_test.js' ? [PANEL]
      : file === 'layout_test.js' ? [PANEL, CDP] : [];
    execFileSync(process.execPath, [target, ...extra], { stdio: 'pipe' });
    results.push(['PASS', file, what]);
  } catch (e) {
    failed++;
    results.push(['FAIL', file, what]);
    const out = (e.stdout || Buffer.from('')).toString();
    const lastLine = out.trim().split('\n').filter(Boolean).pop();
    if (lastLine) console.log('    ' + lastLine.trim());
  }
}

console.log('regression net');
for (const [status, file, what] of results) {
  console.log('  ' + status + '  ' + file.padEnd(24) + what);
}
for (const [file, why] of NEEDS_INPUT) {
  console.log('  SKIP  ' + file.padEnd(24) + why);
}
console.log('');
console.log(failed === 0
  ? 'OK — ' + results.filter(function (r) { return r[0] === 'PASS'; }).length + ' suites green, ' + NEEDS_INPUT.length + ' need input'
  : 'FAILED — ' + failed + ' suite(s) red');
process.exit(failed === 0 ? 0 : 1);
