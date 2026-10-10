#!/usr/bin/env node
/* ROUND ROLE IS NAMED (ADR-0048 §269).
 *
 * Why: `chainJobIds` returns the LINEAGE PATH (root -> the opened period) and deliberately does not walk
 * forward, so opening the ROOT shows one round while opening the LATEST round shows the whole
 * conversation. Measured on the live chain: root => 1, middle => 2, leaf => 4 of 4. Correct behaviour
 * that reads as "the chain is broken" unless the rows say which is which.
 *
 * Usage: node panel_roles_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REQUIRES = 'jsdom';

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('NEEDS-INPUT: jsdom not installed'); process.exit(3); }

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } }

const dom = new JSDOM('<!doctype html><div id="s-side"></div>', { runScripts: 'outside-only' });
const w = dom.window;
w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'panel_tree.js'), 'utf8'));
const P = [
  { period_id: 'root1', parent: null, job_id: 'j', preview: 'a', first_ts: '2026-09-29T04:00:00Z', reply: 'x' },
  { period_id: 'mid1', parent: 'root1', job_id: 'j', preview: 'b', first_ts: '2026-09-29T04:01:00Z', reply: 'y' },
  { period_id: 'leaf1', parent: 'mid1', job_id: 'j', preview: 'c', first_ts: '2026-09-29T04:02:00Z', reply: 'z' }
];
const host = w.document.getElementById('s-side');
w.CxPanelTree.mountSidebar(P, {});
const rowOf = (id) => Array.from(host.querySelectorAll('.ses-item')).filter((e) => e.getAttribute('data-period') === id)[0];

ok('every period is listed (no round lost)', host.querySelectorAll('.ses-item').length === 3);
ok('the root is named as the START  [' + (rowOf('root1') || {}).getAttribute?.('data-role') + ']',
  rowOf('root1').getAttribute('data-role') === 'start');
ok('the leaf is named as the LATEST  [' + rowOf('leaf1').getAttribute('data-role') + ']',
  rowOf('leaf1').getAttribute('data-role') === 'latest');
ok('and the leaf SAYS opening it shows the whole chain', /\u770b\u6574\u6bb5/.test(rowOf('leaf1').textContent));
ok('a middle round carries neither tag (a prefix, not an endpoint)', rowOf('mid1').getAttribute('data-role') === null);
ok('MUTATION: dropping the tag removes the only cue that 4/4 exists (measured root=1, leaf=4)',
  /latest/.test(String(rowOf('leaf1').getAttribute('data-role'))));
ok('NO row is marked (the sidebar starts with NO selection — human ruling 2026-10-09)', host.querySelectorAll('.ses-item.sel').length === 0);
dom.window.close();

console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
