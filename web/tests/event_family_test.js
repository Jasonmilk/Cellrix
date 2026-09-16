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
  'verdict/status', 'assistant/reply', 'turn/end',
  'assistant/usage'
];
check('vocabulary has 12 types', EF.KNOWN_TYPES.length === 12, 'got ' + EF.KNOWN_TYPES.length);
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
    var schema = EF.DATA_SCHEMA[t];
    var req = schema.required || {}, opt = schema.optional || {};
    function sample(k) {
      var k0 = (req[k] || opt[k])[0];
      return k0 === 'boolean' ? false : (k0 === 'number' ? 0 : (k0 === 'array' ? [] : (k0 === 'object' ? {} : 'x')));
    }
    var data = {};
    Object.keys(req).forEach(function (k) { data[k] = sample(k); });
    Object.keys(opt).forEach(function (k) { data[k] = sample(k); });
    // null out every optional field that declares nullability
    Object.keys(opt).filter(function (k) { return opt[k].indexOf('null') >= 0; })
      .forEach(function (k) { data[k] = null; });
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

// ---- the semantic layer selects over the same facts; it is not a second
// vocabulary. KIND_OF's key set must equal TYPES' value set, or the lists drift
// and the kind names become a third copy of the type facts.
{
  const typeNames = Object.keys(EF.TYPES).map(function (k) { return EF.TYPES[k]; }).sort();
  const kindKeys = Object.keys(EF.KIND_OF).sort();
  check('KIND_OF covers every protocol type and nothing else',
    JSON.stringify(kindKeys) === JSON.stringify(typeNames),
    JSON.stringify(kindKeys) + ' vs ' + JSON.stringify(typeNames));

  const kinds = Object.keys(EF.KINDS).map(function (k) { return EF.KINDS[k]; });
  const used = kindKeys.map(function (k) { return EF.KIND_OF[k]; });
  check('every declared kind is reachable from a protocol type',
    kinds.filter(function (k) { return used.indexOf(k) === -1; }).length === 0);

  const bad = typeNames.filter(function (n) {
    const r = EF.interpret(n, {});
    return !r || !r.kind || !r.payload || typeof r.payload !== 'object';
  });
  check('interpret() answers for every protocol type', bad.length === 0, JSON.stringify(bad));
  check('interpret() refuses an unknown type instead of inventing meaning',
    EF.interpret('nonsense/type', {}) === null);
  const call = EF.interpret(EF.TYPES.TOOL_CALL, { tool: 'x', index: 0, expect: 's' });
  const res = EF.interpret(EF.TYPES.TOOL_RESULT, { tool: 'x', ok: true, duration_ms: 3 });
  // interpret() must be a lookup, not twelve branches. If PAYLOAD_MAP does not
  // cover the types, the code is dispatching per type again — hardcoding that
  // merely moved into the contract layer.
  check('PAYLOAD_MAP covers every protocol type',
    JSON.stringify(Object.keys(EF.PAYLOAD_MAP).sort()) === JSON.stringify(typeNames),
    JSON.stringify(Object.keys(EF.PAYLOAD_MAP).sort()));
  check('the contract exposes no per-type interpreter functions',
    typeof EF.INTERPRETERS === 'undefined');

  // P0-1: PAYLOAD_MAP and DATA_SCHEMA both answer "which fields does this type
  // have". A name in one and not the other is a field fact that has split.
  const undeclared = [];
  Object.keys(EF.PAYLOAD_MAP).forEach(function (typeName) {
    const decl = EF.DATA_SCHEMA[typeName] || {};
    const known = Object.keys(decl.required || {}).concat(Object.keys(decl.optional || {}));
    Object.keys(EF.PAYLOAD_MAP[typeName]).forEach(function (payloadKey) {
      const from = EF.PAYLOAD_MAP[typeName][payloadKey][0];
      if (from.charAt(0) === '?') { return; }        // a literal, not a field
      if (known.indexOf(from) === -1) { undeclared.push(typeName + '.' + from); }
    });
  });
  check('every field PAYLOAD_MAP reads is declared in DATA_SCHEMA',
    undeclared.length === 0, JSON.stringify(undeclared));

  // P0-2: an optional field the producer omitted is counted, not silent.
  {
    const missing = [];
    EF.interpret(EF.TYPES.ASSISTANT_REPLY, { text: 'x', chars: 1 }, missing);
    check('an omitted optional field is counted, not silently dropped',
      missing.length === 1 && missing[0] === 'assistant/reply.model',
      JSON.stringify(missing));
    check('a present optional field is not counted',
      (function () { const m = []; EF.interpret(EF.TYPES.ASSISTANT_REPLY,
        { text: 'x', chars: 1, model: 'm' }, m); return m.length === 0; })());
    check('a required field is null, not counted, when absent',
      (function () { const m = []; const r = EF.interpret(EF.TYPES.USER_MESSAGE, {}, m);
        return r.payload.text === null && m.length === 0; })());
  }

  // The track table must cover every kind, or a row silently draws as nothing.
  const kinds2 = Object.keys(EF.KINDS).map(function (k) { return EF.KINDS[k]; });
  const missing = kinds2.filter(function (k) { return !EF.KIND_CLASS[k]; });
  check('KIND_CLASS covers every declared kind', missing.length === 0, JSON.stringify(missing));
  check('every KIND_CLASS entry names a class and a track',
    kinds2.every(function (k) { return EF.KIND_CLASS[k].cls && EF.KIND_CLASS[k].track; }));

  // turn/start and turn/end share a kind; only the payload tells them apart
  const startN = { kind: EF.KINDS.TURN, payload: { start: true } };
  const endN = { kind: EF.KINDS.TURN, payload: { end: true } };
  check('classOf separates the two ends of a turn without the protocol name',
    EF.classOf(startN).cls === 'SYSTEM' && EF.classOf(endN).cls === 'END',
    EF.classOf(startN).cls + '/' + EF.classOf(endN).cls);
  check('classOf refuses an unknown kind instead of guessing',
    EF.classOf({ kind: 'nonsense', payload: {} }) === null);

  check('tool call and result share the kind, differ by stage',
    call.kind === res.kind && call.payload.stage === 'call' && res.payload.stage === 'result');
}

console.log(failures === 0 ? '\nOK — all passed' : '\nFAILED: ' + failures);
process.exit(failures === 0 ? 0 : 1);
