/* Assembly layer tests (Cellrix:ADR-0018 T2).
 *
 * Pure-logic harness: the assets are browser IIFEs that only touch `window`,
 * so they load under node with a one-line shim. No browser, no mocks.
 *
 * Usage: node assembly_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = {};
const A = path.join(__dirname, '..', 'assets');
eval(fs.readFileSync(path.join(A, 'event_family.js'), 'utf8'));
eval(fs.readFileSync(path.join(A, 'period_normalize.js'), 'utf8'));
eval(fs.readFileSync(path.join(A, 'assembly.js'), 'utf8'));
const ASM = global.window.CxAssembly;
const NORM = global.window.CxNormalize;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

/* Build one event. seq is explicit because the whole point is that the tape —
 * not arrival order — decides the result. */
function ev(type, seq, data) {
  return { type: type, seq: seq, time: '2026-09-15T00:00:00Z', data: data || {} };
}

/* A small but complete window: two turns, the second one still open. */
/* UNREAL: seq is globally unique here (1..6). Real periods restart seq at 0
 * each turn — see the MULTI-TURN clause below, which feeds the real shape and
 * currently fails.
 *
 * This fixture exercises single-sequence mechanics only. It must NOT be read
 * as evidence that multi-turn works: the "second turn is t2" assertion below
 * passes against it, and that pass means nothing about a real period. */
const WINDOW_SINGLE_SEQ = [
  ev('turn/start', 1),
  ev('user/message', 2, { text: 'hi' }),
  ev('assistant/think', 3, { text: 'hmm' }),
  ev('turn/end', 4, { done: true, success: true, impasse: false, reply: 'ok', model: null }),
  ev('turn/start', 5),
  ev('user/message', 6, { text: 'again' })
];

console.log('assembly layer ' + ASM.VERSION + ' (T2)');

// ---- D4: pending until a turn/start exists
{
  const a = ASM.create();
  a.feed([ev('user/message', 1, { text: 'x' })]);
  check('pending without a turn/start', a.status() === 'pending', a.status());
  a.feed([ev('turn/start', 2)]);
  check('ready once a turn/start arrives', a.status() === 'ready', a.status());
}

// ---- acceptance 1: replaying the same window is idempotent
{
  const a = ASM.create();
  a.feed(WINDOW_SINGLE_SEQ);
  const first = a.digest();
  a.feed(WINDOW_SINGLE_SEQ);
  check('replay of the same window is idempotent', a.digest() === first,
    first + ' vs ' + a.digest());
}

// ---- acceptance 9: split invariance — replay(k) + live(k..n) == replay(all)
{
  const all = ASM.create(); all.feed(WINDOW_SINGLE_SEQ);
  let ok = true;
  let detail = '';
  for (let k = 0; k <= WINDOW_SINGLE_SEQ.length; k++) {
    const split = ASM.create();
    split.feed(WINDOW_SINGLE_SEQ.slice(0, k));
    split.feed(WINDOW_SINGLE_SEQ.slice(k));
    if (split.digest() !== all.digest()) { ok = false; detail = 'k=' + k; break; }
  }
  check('split invariance (acceptance 9)', ok, detail);
}

// ---- acceptance 4: an earlier page arriving late is an insert, not a rewind
{
  const a = ASM.create();
  a.feed(WINDOW_SINGLE_SEQ.slice(2));
  const wmBefore = a.watermark();
  a.feed(WINDOW_SINGLE_SEQ.slice(0, 2));
  check('late earlier page does not lower the watermark', a.watermark() === wmBefore,
    wmBefore + ' -> ' + a.watermark());
  const seqs = a.events().map(function (e) { return e.seq; });
  const sorted = seqs.slice().sort(function (x, y) { return x - y; });
  check('late earlier page keeps the tape seq-ordered',
    JSON.stringify(seqs) === JSON.stringify(sorted), JSON.stringify(seqs));
  check('late earlier page is still counted',
    a.events().length === WINDOW_SINGLE_SEQ.length, String(a.events().length));
}

// ---- acceptance 10: chunk invariance
{
  const all = ASM.create(); all.feed(WINDOW_SINGLE_SEQ);
  let ok = true, detail = '';
  [1, 3, 7, WINDOW_SINGLE_SEQ.length].forEach(function (size) {
    const a = ASM.create();
    for (let i = 0; i < WINDOW_SINGLE_SEQ.length; i += size) {
      a.feed(WINDOW_SINGLE_SEQ.slice(i, i + size));
    }
    if (a.digest() !== all.digest()) { ok = false; detail = 'chunk=' + size; }
  });
  check('chunk invariance (acceptance 10)', ok, detail);
}

// ---- acceptance 8: purity — same tape twice, byte-identical result
{
  const coordsA = ASM.deriveCoordinates(WINDOW_SINGLE_SEQ, { job_id: 'j1' });
  const coordsB = ASM.deriveCoordinates(WINDOW_SINGLE_SEQ, { job_id: 'j1' });
  check('deriveCoordinates is a pure function',
    JSON.stringify(coordsA) === JSON.stringify(coordsB));
}

// ---- D3: idempotent upsert on (kind, id)
{
  const state = {};
  ASM.upsert(state, { kind: 'turn', id: 't1', note: 'first' });
  ASM.upsert(state, { kind: 'turn', id: 't1', note: 'second' });
  check('upsert replaces rather than appends',
    Object.keys(state).length === 1 && state['turn\u0000t1'].note === 'second',
    JSON.stringify(state));
}

// ---- coordinates come from the tape, not from arrival order
{
  const forward = ASM.deriveCoordinates(WINDOW_SINGLE_SEQ, { job_id: 'j1' });
  const shuffled = WINDOW_SINGLE_SEQ.slice().reverse();
  const a = ASM.create();
  a.feed(shuffled);
  const viaTape = a.coordinates({ job_id: 'j1' });
  check('coordinates ignore arrival order',
    JSON.stringify(viaTape) === JSON.stringify(forward),
    JSON.stringify(viaTape.map(function (c) { return c.seq; })));
  check('turn numbers are ordinal (second turn is t2)',
    viaTape[5].turn === 't2', viaTape[5].turn);
  check('node ids are job-scoped',
    viaTape[0].node === 'j1#1', viaTape[0].node);
}

// ---- unknown / malformed events never enter the tape
{
  const a = ASM.create();
  a.feed([{ type: 'nope/nope', seq: 1, time: 't', data: {} },
          { type: 'turn/start', seq: 2, time: 't', data: {} },
          null]);
  check('malformed events are rejected, not counted',
    a.events().length === 1, String(a.events().length));
  check('unknown type does not become a turn',
    a.coordinates()[0].turn === 't1', a.coordinates()[0].turn);
}

// ---- the renderer's type table is a subset of the contract's vocabulary
//
// Not derived: a renderer needs `track` and a validator does not, so one table
// cannot serve both without letting UI concerns dictate the contract. What
// must hold is that the renderer never names a type the contract does not
// know — otherwise a render row exists for an event the tape will refuse.
{
  // the renderer table lives in prove_track.data.js; it needs CxAssembly, which
  // is already loaded above
  eval(fs.readFileSync(path.join(A, 'prove_track.data.js'), 'utf8'));
  const PT = global.window.CxProveTrack;
  const EFX = global.window.CxEventFamily;
  const unknown = Object.keys(PT.TYPES).filter(function (k) { return !EFX.isKnownType(k); });
  check('renderer types are all known to the contract', unknown.length === 0,
    JSON.stringify(unknown));
}

const EFX = global.window.CxEventFamily;

// ---- MULTI-TURN (RED until the seq work lands)
//
// The fixture above numbers its events 1..6, one global sequence, so "second
// turn is t2" passed while real periods were rejected wholesale — a green
// assertion proving a false conclusion.
//
// A real period restarts seq at 0 each turn (measured: run-7efbf0f8 has
// 0..10 five times). This clause feeds that shape and is EXPECTED TO FAIL
// until `comparePosition`, the dedupe key and the watermark all learn about
// turn together. Red here means "the fix is not in yet" — not "the test is
// wrong". It is the only thing standing between us and believing multi-turn
// already works.
{
  const a = ASM.create();
  const twoTurns = [
    ev('turn/start', 0), ev('user/message', 1, { text: 'q1' }),
    ev('assistant/reply', 2, { text: 'a1', chars: 2 }),
    ev('turn/end', 3, { done: true, success: true, impasse: false }),
    ev('turn/start', 0), ev('user/message', 1, { text: 'q2' }),
    ev('assistant/reply', 2, { text: 'a2', chars: 2 }),
    ev('turn/end', 3, { done: true, success: true, impasse: false })
  ];
  /* Through the REAL read boundary. The spike hand-assigned gseq, which was
   * fairly criticised: that tests the consumer with an input no caller
   * produces. */
  a.feed(NORM.normalize(twoTurns, { job_id: 'j1' }).events);
  const rej = a.rejections();
  check('MULTI-TURN: a second turn is not refused as duplicate (RED = fix pending)',
    rej.total === 0, JSON.stringify(rej.counts));
  check('MULTI-TURN: every event of both turns reaches the tape (RED = fix pending)',
    a.events().length === twoTurns.length,
    a.events().length + ' of ' + twoTurns.length);
  const nodes = a.coordinates({ job_id: 'j1' }).map(function (c) { return c.node; });
  check('MULTI-TURN: node ids are unique across turns (RED = fix pending)',
    new Set(nodes).size === twoTurns.length,
    new Set(nodes).size + ' unique of ' + nodes.length);
}

// ---- gseq + back-fill: the invariant gseq exists for
//
// Until now the back-fill assertions ran only on the single-sequence fixture,
// i.e. through the fallback path. The invariant gseq is meant to protect was
// never exercised in the mode that uses it.
{
  const rows = [
    ev('turn/start', 0), ev('user/message', 1, { text: 'q1' }),
    ev('turn/start', 0), ev('user/message', 1, { text: 'q2' })
  ];
  /* Normalised ONCE on the complete stream; the chunks fed below are slices of
   * that normalised array, not separately normalised. Doing it per chunk
   * restarts gseq at 0 and collides — measured while writing this. */
  const norm = NORM.normalize(rows, { job_id: 'j1' }).events;
  const whole = ASM.create();
  whole.feed(norm);
  const back = ASM.create();
  back.feed(norm.slice(2));       // later half first
  back.feed(norm.slice(0, 2));    // then the earlier half
  check('gseq: back-fill converges to the same tape',
    back.digest() === whole.digest(), back.digest() + ' vs ' + whole.digest());
  const nw = whole.coordinates({ job_id: 'j1' }).map(function (c) { return c.node; }).sort();
  const nb = back.coordinates({ job_id: 'j1' }).map(function (c) { return c.node; }).sort();
  check('gseq: existing node ids survive back-fill unchanged',
    JSON.stringify(nw) === JSON.stringify(nb), JSON.stringify(nb));
  /* gseqFallback is module-level, so other fixtures in this file have already
   * contributed to it. The delta is the fact; the absolute value is not. */
  const fbBefore = ASM.create().diagnostics().gseqFallback;
  const probe = ASM.create();
  probe.feed(norm);
  check('gseq: a normalised feed adds no fallback',
    probe.diagnostics().gseqFallback === fbBefore,
    fbBefore + ' -> ' + probe.diagnostics().gseqFallback);
}

// ---- the fallback counter has its own negative test
//
// A guard whose counter has never been seen to move is indistinguishable from
// one that cannot move.
{
  const a = ASM.create();
  const before = a.diagnostics().gseqFallback;
  a.feed([ev('turn/start', 0), ev('user/message', 1, { text: 'raw' })]);
  const after = a.diagnostics().gseqFallback;
  check('gseq: raw events raise the fallback counter (guard is testable)',
    after - before === 2, 'delta=' + (after - before));
}

// ---- the contract's alias table is complete against its own schema
{
  const listed = Object.keys(EFX.TYPES).map(function (k) { return EFX.TYPES[k]; }).sort();
  const known = EFX.KNOWN_TYPES.slice().sort();
  check('contract TYPES is complete against DATA_SCHEMA',
    JSON.stringify(listed) === JSON.stringify(known),
    'TYPES=' + listed.length + ' KNOWN=' + known.length +
    ' missing=' + JSON.stringify(known.filter(function (t) { return listed.indexOf(t) < 0; })));
}

// ---- the target registry does no work at registration (D5)
{
  const a = ASM.create();
  a.register('prove_track');
  check('registered target is not active', a.activeTargets().length === 0);
  a.activate('prove_track');
  check('activated target is active',
    JSON.stringify(a.activeTargets()) === '["prove_track"]');
  a.deactivate('prove_track');
  check('deactivation stops the driving', a.activeTargets().length === 0);
}

console.log(failures === 0 ? '\nOK — all passed' : '\nFAILED: ' + failures);
process.exit(failures === 0 ? 0 : 1);
