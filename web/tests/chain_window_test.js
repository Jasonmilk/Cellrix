#!/usr/bin/env node
/* THE WINDOW IS NAMED, AND THE DEFAULT IS A PERIOD (ADR-0048 §270).
 *
 * Measured before this: the default load passed `list[0].job_id` (a JOB) into a walk keyed by PERIOD
 * id, got `start-absent`, and the next line silently substituted `[start]` — so the default window was
 * ONE round while the data held four. Two invariants, both testable without a browser:
 *   · the walk's ending is one of root | truncated | cycle | start-absent  (four NAMES, not one blank)
 *   · the loader's default start is a PERIOD id, and an empty window is returned AS SUCH (named)
 *
 * Usage: node chain_window_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const REQUIRES = 'jsdom';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } }

const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
const w = dom.window;
for (const f of ['three_state.js', 'event_family.js', 'period_normalize.js']) {
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8'));
}
const N = w.CxNormalize;
const P = [
  { period_id: 'p1', parent: null, job_id: 'J1' },
  { period_id: 'p2', parent: 'p1', job_id: 'J2' },
  { period_id: 'p3', parent: 'p2', job_id: 'J3' },
  { period_id: 'p4', parent: 'p3', job_id: 'J4' }
];

ok('the leaf walks the WHOLE chain (4 of 4)', N.chainJobIds(P, 'p4').length === 4);
ok('and the ending is named `root`  [' + (N.lastWalk() || {}).kind + ']', (N.lastWalk() || {}).kind === 'root');
ok('the root alone walks 1 (by design: no past)', N.chainJobIds(P, 'p1').length === 1);

ok('an ABSENT start yields an EMPTY window, not a substituted one  [' + N.chainJobIds(P, 'nope').length + ']',
  N.chainJobIds(P, 'nope').length === 0);
ok('and it is NAMED `start-absent`  [' + (N.lastWalk() || {}).kind + ']',
  (N.lastWalk() || {}).kind === 'start-absent');
ok('a parent outside the window is NAMED `truncated`',
  (function () { const q = [{ period_id: 'x', parent: 'ghost', job_id: 'J' }]; N.chainJobIds(q, 'x'); return (N.lastWalk() || {}).kind === 'truncated'; })());

/* MUTATION: the old loader produced `[start]` when the walk was empty — one unnamed round. */
ok('MUTATION: substituting [start] would give 1 round where the walk said start-absent  [' + N.chainJobIds(P, 'nope').length + ']',
  N.chainJobIds(P, 'nope').length !== 1);

/* CONTRACT (source-level, labelled): the loader must not silently substitute, and its default start
 * must be a period id. Both are one-line properties that a future edit could quietly undo. */
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'script.html'), 'utf8');
ok('the loader does NOT contain the silent fallback `ids = [start]`', src.indexOf('ids = [start]') < 0);
ok('the loader default start reads `period_id`, not `job_id`',
  /var start = jobId \|\| \(list\[0\] && list\[0\]\.period_id\)/.test(src));
ok('and the loader reports the window state to its caller', /windowState: windowState/.test(src));

dom.window.close();
console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
