#!/usr/bin/env node
/* A recorded turn has a SHAPE, and the render table decides it.
 *
 * Measured 2026-09-24: with the live white-box trail on (anaphase:ADR-0046 C4)
 * the panel's trajectory table rendered **0 event rows** for a real turn
 * (`all_views_test.js`: "event rows rendered [0 rows]").
 *
 * Before blaming the render table, ask it directly. This suite feeds a
 * synthetic reply-only turn — the thinnest real turn there is: turn/start,
 * user/message, context/inject, assistant/reply, turn/end — through the
 * production tape and the production buildSession, and asserts the row set.
 *
 * Why it is worth a criterion of its own: it splits one question into two.
 *   model says N rows  AND panel shows 0  => the fault is in the PANEL's data
 *                                            path or gating, not in the table.
 *   model says 0 rows                      => the table has no entry for these
 *                                            kinds (the real defect this repo's
 *                                            `validate()` is designed to refuse).
 * Without this split, "0 rows" reads as either cause and gets explained away.
 *
 * The synthetic input is deliberate: a criterion that needs a recorded chain to
 * exist cannot run on a machine that has none (the mistake `pt_replay.js` and
 * `prove_track_nodes_test.js` both made, corrected in the same round).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const A = path.join(__dirname, '..', 'assets');

let pass = 0, fail = 0;
function check(label, cond, detail) {
  const tail = detail ? '  [' + detail + ']' : '';
  if (cond) { pass++; console.log('  PASS  ' + label + tail); }
  else { fail++; console.log('  FAIL  ' + label + tail); }
}

/* The assets are browser IIFEs that touch `window` at load time and
 * `document.getElementById` at call time, so a two-line shim loads them under
 * node — the same shape `prove_track_rows_test.js` uses. */
global.window = {};
global.document = { getElementById: function () { return null; } };
['event_family.js', 'period_normalize.js', 'node_shape.js', 'assembly.js',
 'prove_track.data.js', 'prove_track.render.js', 'prove_track.node.js'].forEach(function (f) {
  eval(fs.readFileSync(path.join(A, f), 'utf8'));
});
const PT = global.window.CxProveTrack;
const R = PT.render;
const EF = global.window.CxEventFamily;

/* One turn, five events: the shape a reply-only turn actually produces. */
const JOB = 'run-synthetic-reply-only';
const PID = JOB + '-p0000000000000000';
const T = '2026-09-24T05:00:0';
const ROWS = [
  /* Payload shapes copied from a REAL recorded turn (2026-09-24). They are not
   * decoration: `context/inject` without `choice`, or `assistant/reply` without
   * `chars`/`model`, produces NO row — measured (the first version of this
   * fixture built 2 of 5 rows). A synthetic input that does not carry the fields
   * the pipeline keys on is not a fixture for this criterion; it is a fixture
   * for a different one. */
  { type: 'turn/start', job_id: JOB, period_id: PID, seq: 0, time: T + '0Z', data: {} },
  { type: 'user/message', job_id: JOB, period_id: PID, seq: 1, time: T + '1Z', data: { text: 'say pong' } },
  { type: 'context/inject', job_id: JOB, period_id: PID, seq: 2, time: T + '2Z',
    data: { chars: 800, choice: { tiers: { L1: 2, L3: 3 }, top: [] } } },
  { type: 'assistant/reply', job_id: JOB, period_id: PID, seq: 3, time: T + '3Z',
    data: { chars: 4, model: 'agnes-2.5-pro', text: 'pong' } },
  { type: 'turn/end', job_id: JOB, period_id: PID, seq: 4, time: T + '4Z',
    data: { done: true, impasse: false, model: 'agnes-2.5-pro', reply: 'pong', success: true, verdict: null } },
];

function build(rows) {
  const ASM = global.window.CxAssembly;
  const NORM = global.window.CxNormalize;
  const m = NORM.mergeChain({ [PID]: rows }, [PID]);
  const tape = ASM.create();
  tape.feed(m.events);
  const nodes = tape.snapshot().nodes;
  return { rows: PT.node.buildSession(nodes), nodes: nodes };
}

const built = build(ROWS);
const session = built.rows;
const evRows = session.filter(function (r) { return r.kind === 'ev'; });
const nonReply = evRows.filter(function (r) { return r.cls !== EF.KIND_CLASS.reply; });

console.log('reply-only turn — render table outcome');
console.log('  rows: ' + session.map(function (r) { return r.kind + (r.kind === 'ev' ? '/' + r.cls : ''); }).join(' '));

/* ── 1. the turn reaches the tape, and the reply is one of its rows ──────── */
check('the turn reaches the tape as nodes', built.nodes.length > 0, built.nodes.length + ' node(s)');
check('the reply keeps its own class',
  evRows.filter(function (r) { return r.cls === EF.KIND_CLASS.reply; }).length === 1,
  evRows.map(function (r) { return r.cls; }).join(', '));

/* ── 2. THE assertion: a reply-only turn is not row-less ────────────────────
 * `all_views_test.js` requires at least one row that is NOT the reply (it
 * excludes the reply to ask "did the process render, not just the answer?").
 * If the table produced none, that requirement would be unsatisfiable and the
 * panel would be right to show nothing. It produces four. */
check('a reply-only turn still produces NON-reply rows', nonReply.length > 0,
  nonReply.map(function (r) { return r.cls; }).join(', ') || 'none');

/* ── 3. no kind silently disappears ────────────────────────────────────────
 * `validate()` requires every contract kind to be drawn or listed NOT_DRAWN;
 * this is the same demand from the data side: each event's kind is either in
 * the render table or explicitly declared undrawn. A new protocol event must
 * not vanish from the trajectory with nobody having decided that. */
const kinds = built.nodes.map(function (n) { return n.kind; });
const vanished = kinds.filter(function (k) { return !R.SUMMARY[k] && !R.NOT_DRAWN[k]; });
check('no node kind lands in neither SUMMARY nor NOT_DRAWN', vanished.length === 0,
  vanished.length ? vanished.join(', ') : 'all ' + kinds.length + ' node kind(s): ' + kinds.join(','));

/* ── 4. non-vacuity ───────────────────────────────────────────────────────
 * The checks above must be able to fail. Take the message kind out of the
 * render table (the "it just disappeared" defect) and the non-reply assertion
 * must go red — that is the mutation this suite is built to catch. */
const saved = R.SUMMARY.message;
delete R.SUMMARY.message;
const mutated = build(ROWS).rows;
const mutatedNonReply = mutated.filter(function (r) { return r.kind === 'ev' && r.cls !== EF.KIND_CLASS.reply; });
R.SUMMARY.message = saved;
check('removing a kind from the render table is REPORTED (mutation)',
  mutatedNonReply.length < nonReply.length,
  'rows ' + nonReply.length + ' -> ' + mutatedNonReply.length + ' without `message`');

console.log('');
console.log(fail === 0 ? 'OK — ' + pass + ' checks green' : 'FAILED — ' + fail + ' of ' + (pass + fail) + ' red');
process.exit(fail === 0 ? 0 : 1);
