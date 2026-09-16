/* The trajectory's own real-chain criterion (batch 4).
 *
 * Until now the only real-chain number was the conversation view's — 55 events
 * over 5 turns, produced by ab_verify. The trajectory has none, so after the
 * consumption layer changes there would be nothing that says it was fixed
 * rather than merely not broken. That is the 1e mistake: validating against a
 * baseline that cannot distinguish the two.
 *
 * The criterion is NOT "the new functions match the old ones". The old ones
 * dispatch on the protocol name and receive events; the new ones dispatch on
 * `kind` and receive nodes. They cannot agree — the old ones produce undefined
 * throughout when handed a node stream. Comparing them would be the same
 * mistake a third time.
 *
 * So: run the real 10-period chain through the tape, take the snapshot's nodes,
 * and require that the Node-side consumption layer handles all of them.
 *
 * Usage: node prove_track_nodes_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const A = path.join(__dirname, '..', 'assets');
const EV = path.join(__dirname, '..', '..', '..', '.helix', 'events');
global.window = {};
['event_family.js', 'period_normalize.js', 'node_shape.js', 'assembly.js',
 'prove_track.data.js', 'prove_track.node.js'].forEach(function (f) {
  const p = path.join(A, f);
  if (fs.existsSync(p)) { eval(fs.readFileSync(p, 'utf8')); }
});

const NORM = global.window.CxNormalize;
const ASM = global.window.CxAssembly;
const PT = global.window.CxProveTrack;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

/* ---- the real chain, through the tape */
const periods = [];
const byJob = {};
fs.readdirSync(EV).forEach(function (name) {
  if (!name.endsWith('.events.jsonl')) { return; }
  const jobId = name.slice(0, -'.events.jsonl'.length);
  const rows = fs.readFileSync(path.join(EV, name), 'utf8').trim()
    .split('\n').filter(Boolean).map(JSON.parse);
  if (!rows.length) { return; }
  byJob[jobId] = rows;
  let parent = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === 'context/inject') {
      parent = (rows[i].data || {}).resume_from || null;
      break;
    }
  }
  periods.push({ job_id: jobId, parent: parent, first_ts: rows[0].time || '' });
});

const ids = NORM.chainJobIds(periods, 'run-9e901b965a772d51');
const merged = NORM.mergeChain(byJob, ids);
const tape = ASM.create();
tape.feed(merged.events);
const snap = tape.snapshot();

check('the real chain reaches the tape', merged.events.length === 80,
  String(merged.events.length));
check('the snapshot carries all of them as nodes', snap.nodes.length === 80,
  String(snap.nodes.length));

/* ---- the Node-side consumption layer */
const NODE_SIDE = PT && PT.node;
check('the Node-side consumption layer exists', !!NODE_SIDE,
  NODE_SIDE ? '' : 'PT.node missing — this is the red state before 3b-1');

if (NODE_SIDE) {
  const kinds = Array.from(new Set(snap.nodes.map(function (n) { return n.kind; })));

  const unclassified = snap.nodes.filter(function (n) {
    return n.kind === 'unknown' || !n.kind;
  });
  check('every node is classified (no unknown kind)', unclassified.length === 0,
    String(unclassified.length));

  const empty = [];
  kinds.forEach(function (k) {
    const n = snap.nodes.filter(function (x) { return x.kind === k; })[0];
    const s = NODE_SIDE.summarize(n);
    if (typeof s !== 'string' || !s.trim()) { empty.push(k + '=' + JSON.stringify(s)); }
  });
  check('every kind produces a non-empty summary', empty.length === 0,
    JSON.stringify(empty));

  const kinds2 = kinds.filter(function (k) {
    return !NODE_SIDE.laneOf(k) || !NODE_SIDE.statusOf(snap.nodes.filter(function (n) {
      return n.kind === k;
    })[0]);
  });
  check('every kind has a lane and a status', kinds2.length === 0, JSON.stringify(kinds2));
}

console.log('');
console.log(failures === 0 ? 'OK — all passed' : 'FAILED: ' + failures);
process.exit(failures === 0 ? 0 : 1);
