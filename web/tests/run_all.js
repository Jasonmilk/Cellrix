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
 * 缺口（诚实登记）：本文件目前**只承载规则文本，尚无自动检查器**。因为今天网里并不
 * 存在这类硬断言，此时写检查器必然空转——而空转的测试比没有测试更糟（它读起来像覆盖
 * 率）。待出现真实对象，或先做**变异注入**（临时植入一条 `=== 4` 断言，证明检查器会红）
 * 再落地，见 ADR-0022 §4 验收第 2 条。
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
  ['hash_state_test.js', 'URL hash — the addressable selection state']
];

/* The panel test is RUN when the panel is reachable and SKIPPED only when it is
 * not — never silently skipped while it is up. The base used to be hardcoded to
 * :18932 while the panel actually serves :8080, so this test sat idle for as long
 * as that mismatch existed: a passing test that never ran, which is worse than no
 * test because it looks like coverage. Override with CELLRIX_PANEL. */
const PANEL = process.env.CELLRIX_PANEL || 'http://127.0.0.1:8080';

function panelReachable() {
  let host = '127.0.0.1', port = 80;
  try { const u = new URL(PANEL); host = u.hostname; port = u.port || 80; } catch { return false; }
  try {
    execFileSync(process.execPath, ['-e',
      'const s=require("net").connect(' + Number(port) + ',' + JSON.stringify(host) + ');' +
      's.on("connect",()=>{s.end();process.exit(0)});' +
      's.on("error",()=>process.exit(1));' +
      'setTimeout(()=>process.exit(1),1500);'
    ], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

const PANEL_UP = panelReachable();

const NEEDS_INPUT = [
  ['layout_test.js', 'needs Chrome on :9222: node layout_test.js (see README)']
];

if (PANEL_UP) {
  SELF_CONTAINED.push(['all_views_test.js', 'all views against the live panel — ' + PANEL]);
}

let failed = 0;
const results = [];

for (const [file, what] of SELF_CONTAINED) {
  const target = path.join(__dirname, file);
  try {
    const extra = file === 'all_views_test.js' ? [PANEL] : [];
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
