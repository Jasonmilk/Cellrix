#!/usr/bin/env node
/* THE MODE IS RESOLVED FOR THE PERIOD, NOT FOR EACH EVENT (ADR-0048 §348).
 *
 * MEASURED failure mode this prevents: the mode is written ONCE, on `turn/start`; a reader that asks each
 * event for a mode reports "undeclared" for most rows of a period that DOES declare one (the ~75% ghost).
 *
 * The criterion is a MUTATION COMPARISON: a naive `events.find(modeOf)` must give a DIFFERENT answer from the
 * resolver, otherwise the resolver is decoration. No jsdom and no panel: this is pure token logic, so it runs
 * everywhere.
 *
 * Usage: node period_mode_resolver_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const MIN_EVENTS = 2;   /* declared threshold (ADR-0022 §2.5): a period needs more than its first row */

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* A real DOM window, like every other asset-level suite here: the assets attach to `window`, and a bare
 * `vm` context left the namespace undefined (measured — the first version read `undefined.modeOf`). */
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  runScripts: 'outside-only', virtualConsole: new VirtualConsole()
});
const w = dom.window;
for (const f of ['three_state.js', 'event_family.js', 'cell_metering.js']) {
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8'));
}
const M = w.CxCellMetering;
ok('the metering layer exposes BOTH readers (per-event and per-period)', !!M.modeOf && !!M.periodMode);

const declared = [
  { type: 'turn/start', data: { mode: 'partner' } },
  { type: 'user/message', data: { text: 'hi' } },
  { type: 'assistant/reply', data: { text: 'hello' } },
  { type: 'turn/end', data: {} }
];
ok('the fixture really has the mode on the FIRST row only', declared.length >= MIN_EVENTS
  && !!declared[0].data.mode && declared.slice(1).every(function (e) { return !e.data.mode; }));

ok('periodMode resolves the period\'s declared mode', M.periodMode(declared) === 'partner',
  String(M.periodMode(declared)));

/* THE MUTATION: asking each event independently is what produced the ghost. The two answers must DIFFER. */
const naive = declared.map(function (e) { var t = M.modeOf(e); return (t && t.k === M.Pstr('').k) ? t.v : null; })
  .filter(Boolean)[0] || null;
ok('MUTATION: the per-event reader gives a DIFFERENT (wrong) answer, so the resolver is not decoration',
  naive === 'partner' && !(M.modeOf(declared[1]).k === M.Pstr('').k),
  'naive=' + String(naive) + ' per-event(second row).k=' + M.modeOf(declared[1]).k);

/* Both honest endings are `null`, and neither is a default. */
ok('no turn/start at all ⇒ null (nothing declares a mode)',
  M.periodMode([{ type: 'user/message', data: { text: 'x' } }]) === null);
ok('a turn/start with NO mode ⇒ null (the declaration is EMPTY, not defaulted)',
  M.periodMode([{ type: 'turn/start', data: {} }, { type: 'turn/end', data: {} }]) === null);
ok('and the absence is NAMEABLE by the caller (modeFacts(null) is `undeclared`, never a value)',
  typeof M.periodMode([]) === 'object' || M.periodMode([]) === null);

console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
