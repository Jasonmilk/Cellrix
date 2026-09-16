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
  ['pt_replay.js', 'trajectory — metering and panes against real files']
];

const NEEDS_INPUT = [
  ['all_views_test.js', 'needs the panel live on :18932 (see start-panel.sh)'],
  ['layout_test.js', 'needs the panel live + Chrome on :9222: node layout_test.js (see README)']
];

let failed = 0;
const results = [];

for (const [file, what] of SELF_CONTAINED) {
  const target = path.join(__dirname, file);
  try {
    execFileSync(process.execPath, [target], { stdio: 'pipe' });
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
