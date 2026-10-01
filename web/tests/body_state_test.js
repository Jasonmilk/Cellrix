#!/usr/bin/env node
/* EMPTY IS NOT ABSENT (ADR-0048 §350; the three-state law of §335/§304.5).
 *
 * MEASURED: `assistant/think` carries `text: ''` when the model produced no reasoning, and carries NO `text`
 * when nothing was recorded. A single placeholder ("—" / `text || '—'`) merges "it produced nothing" with
 * "we have no evidence", which is the confusion this project keeps paying for.
 *
 * The criterion is a MUTATION COMPARISON: the naive `text || fallback` must give the SAME answer for both
 * cases while `bodyState` gives DIFFERENT ones — otherwise the distinction is decoration.
 *
 * Usage: node body_state_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
const w = dom.window;
for (const f of ['three_state.js', 'event_family.js']) {
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8'));
}
const EF = w.CxEventFamily;
ok('the family exposes `bodyState`', typeof EF.bodyState === 'function');

const produced = EF.bodyState({ text: 'reasoning here' });
const empty = EF.bodyState({ text: '' });
const absent = EF.bodyState({});
ok('a produced body is PRESENT (its text is the label)', produced.kind === 'present' && !!produced.text);
ok('an empty string is EMPTY, and says so', empty.kind === 'empty' && empty.label === '有但为空');
ok('a missing field is ABSENT, and says so', absent.kind === 'absent' && absent.label === '未记录');
ok('THE THREE LABELS DIFFER (otherwise one placeholder merged two facts)',
  empty.label !== absent.label && produced.label !== empty.label && produced.label !== absent.label,
  [produced.kind, empty.kind, absent.kind].join(' / '));

/* THE MUTATION: the naive renderer cannot tell them apart. */
const naive = (d) => (d.text || '—');
ok('MUTATION: the naive `text || placeholder` renders empty and absent IDENTICALLY',
  naive({ text: '' }) === naive({}) && EF.bodyState({ text: '' }).label !== EF.bodyState({}).label,
  'naive=' + JSON.stringify(naive({ text: '' })) + ' honest=' + empty.label + ' vs ' + absent.label);

/* WIRED, NOT MERELY AVAILABLE: a helper nobody calls is a criterion about an unused function. The inspector
 * renders through `payloadBody`, which consults the family declaration and names both endings. */
const VIEW = fs.readFileSync(path.join(__dirname, '..', 'assets', 'prove_track.view.js'), 'utf8');
ok('the inspector actually uses it (payloadBody → bodyState)',
  /function payloadBody\(/.test(VIEW) && /EF\.bodyState\(/.test(VIEW) && /esc\(payloadBody\(ev\)\)/.test(VIEW));
ok('MUTATION: the old rendering (`ev.payload || \'—\'`) is GONE from that spot',
  !/esc\(ev\.payload \|\| '—'\)/.test(VIEW), 'the placeholder that merged two facts');

console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
