/* Event family contract tests (Cellrix:ADR-0018 T0).
 *
 * Pure-logic harness: the asset is a browser IIFE that only touches `window`,
 * so it loads under node with a one-line shim — same trick as pt_replay.js.
 * No browser, no mocks, no build step.
 *
 * Usage: node event_family_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = {};
eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'event_family.js'), 'utf8'));
const EF = global.window.CxEventFamily;

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  PASS  ' + name);
  } else {
    failures++;
    console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''));
  }
}

function ev(type, data, seq) {
  return { type: type, seq: seq === undefined ? 1 : seq, time: '2026-09-15T00:00:00Z', data: data };
}

console.log('event family contract (' + EF.VERSION + ')');

// ---- vocabulary is the frozen protocol list from anaphase:ADR-0026 D2
const EXPECTED = [
  'turn/start', 'user/message', 'context/inject', 'assistant/think',
  'assistant/attempt', 'tool/call', 'tool/result', 'check/status',
  'verdict/status', 'assistant/reply', 'turn/end'
];
check('vocabulary has 11 types', EF.KNOWN_TYPES.length === 11, 'got ' + EF.KNOWN_TYPES.length);
EXPECTED.forEach(function (t) {
  check('vocabulary contains ' + t, EF.KNOWN_TYPES.indexOf(t) >= 0);
});

// ---- structural validation
check('turn/start with empty data is valid', EF.isValidEvent(ev('turn/start', {})));
check('user/message with text is valid', EF.isValidEvent(ev('user/message', { text: 'hi' })));
check('assistant/reply with null model is valid (ADR-0036)',
  EF.isValidEvent(ev('assistant/reply', { text: 'a', chars: 1, model: null })));
check('turn/end with null model is valid (ADR-0036)',
  EF.isValidEvent(ev('turn/end', { done: true, success: true, impasse: false, reply: 'ok', model: null })));

check('every type declaring a nullable field accepts null',
  EF.KNOWN_TYPES.every(function (t) {
    var shape = EF.DATA_SCHEMA[t];
    var fields = Object.keys(shape).filter(function (k) { return shape[k].indexOf('null') >= 0; });
    if (!fields.length) return true;
    var data = {};
    Object.keys(shape).forEach(function (k) { data[k] = shape[k][0] === 'boolean' ? false : (shape[k][0] === 'number' ? 0 : 'x'); });
    fields.forEach(function (k) { data[k] = null; });
    return EF.isValidEvent({ type: t, seq: 1, time: 'z', data: data });
  }));

check('assistant/reply with string model is valid',
  EF.isValidEvent(ev('assistant/reply', { text: 'a', chars: 1, model: 'x' })));

check('missing text is rejected',
  !EF.isValidEvent(ev('user/message', {})));
check('wrong field type is rejected',
  !EF.isValidEvent(ev('user/message', { text: 42 })));
check('unknown type is rejected',
  !EF.isValidEvent(ev('made/up', {})));
check('non-numeric seq is rejected',
  !EF.isValidEvent(ev('turn/start', {}, '1')));
check('missing time is rejected',
  !EF.isValidEvent({ type: 'turn/start', seq: 1, data: {} }));
check('missing data is rejected',
  !EF.isValidEvent({ type: 'turn/start', seq: 1, time: 'x' }));
check('null is rejected', !EF.isValidEvent(null));

// ---- determinism: same tape, same verdicts. No clock, no randomness, no DOM.
const tape = JSON.stringify(EXPECTED.map(function (t) { return ev(t, {}); }));
const verdicts = JSON.parse(tape).map(function (e) { return EF.isValidEvent(e); });
const again = JSON.parse(tape).map(function (e) { return EF.isValidEvent(e); });
check('validation is a pure function', JSON.stringify(verdicts) === JSON.stringify(again));
// `turn/start` is the only type whose data shape is empty, so it is the only
// one that accepts an empty payload. Every other type must reject it.
check('empty data validates only for turn/start',
  verdicts.filter(function (v) { return v; }).length === 1,
  'got ' + verdicts.filter(function (v) { return v; }).length + ' accepted');

console.log(failures === 0 ? '\nOK — all passed' : '\nFAILED: ' + failures);
process.exit(failures === 0 ? 0 : 1);
