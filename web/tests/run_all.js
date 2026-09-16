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
  ? 'OK — ' + SELF_CONTAINED.length + ' suites green, ' + NEEDS_INPUT.length + ' need input'
  : 'FAILED — ' + failed + ' suite(s) red');
process.exit(failed === 0 ? 0 : 1);
