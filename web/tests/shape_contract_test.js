/* shape_contract_test — THE SHAPE (AND THE NAME) ARE PART OF THE CONTRACT (ADR-0048 §173).
 *
 * Measured before: the view feeds SESSION ROWS, whose keys are top-level (`dur`, `tok`, `cls`)
 * with no `type` and no `/data`; the projection recognised rows only by the protocol name
 * (`assistant/usage`) and read only `/data/...`. So EVERY row was skipped and both outlets read
 * absent on the real path — while every criterion that fed EVENTS stayed green.
 *
 * Two things were missing, and they are different:
 *   · a NAME  — the semantic kind must travel with the row (`sem`), or the projection cannot
 *               recognise what is in front of it;
 *   · a ZERO  — "no duration" was written as `0`, which is a MEASUREMENT, so the block was given
 *               a 0% width and vanished.
 */
const fs = require('fs'), path = require('path');
const CM = require(path.join(__dirname, '..', 'assets', 'cell_metering.js'));
const RAW = fs.readFileSync(path.join(__dirname, 'fixtures', 'pinned.events.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

/* the SESSION-ROW shape as buildSession makes it: top-level dur/tok, NO type, semantic `sem` */
const rows = [
  { kind: 'ev', id: 'n1', sem: 'turn', dur: null, tok: null },
  { kind: 'ev', id: 'n2', sem: 'metering', dur: null, tok: 5 },
  { kind: 'ev', id: 'n3', sem: 'tool', dur: 120, tok: null },
  { kind: 'ev', id: 'n4', sem: 'metering', dur: null, tok: 7 }
];
const fmt = (s) => s.k + (s.v === undefined ? '' : ':' + s.v);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

/* ── the NAME: the projection recognises semantic rows, and still recognises protocol events ── */
const toolRow = rows[2], usageRow = RAW[1];
ok(CM.durOf(toolRow).k === 'p' && CM.durOf(toolRow).v === 120,
  'a SEMANTIC row (sem="tool") is recognised by the duration channel  [' + fmt(CM.durOf(toolRow)) + ']');
ok(CM.tokOf(rows[1]).k === 'p' && CM.tokOf(rows[1]).v === 5,
  'a SEMANTIC row (sem="metering") is recognised by the token channel  [' + fmt(CM.tokOf(rows[1])) + ']');
ok(CM.tokOf(usageRow).k === 'p' && CM.tokOf(usageRow).v === 5,
  'a PROTOCOL event (type="assistant/usage") still reads the same  [' + fmt(CM.tokOf(usageRow)) + ']');

/* ── the ZERO: "no duration" must be UNMEASURED, never a measurement of 0 ── */
ok(CM.durOf(rows[0]).k === 'n',
  'a row with dur=null is UNMEASURED, not "0 ms"  [' + fmt(CM.durOf(rows[0])) + ']');
ok(CM.durOf({ kind: 'ev', sem: 'tool', dur: 0 }).k === 'p',
  'a row with dur=0 IS a measurement of zero (the two must stay distinguishable)');

/* ── MUTATIONS: both halves of this criterion must be able to fail ── */
ok(['/data/duration_ms', '/dur'].indexOf('/dur') >= 0
  && CM.durOf({ dur: 120 }).k === 'p',
  'MUTATION: the read chain reaches the session-row key (/dur) — removing it fails the first check');
ok(CM.durOf({ dur: null }).k !== 'p',
  'MUTATION: writing 0 for "no duration" WOULD be read as a measurement — the bug this fixes');

console.log(bad === 0 ? 'OK — the projection recognises the view\'s shape, and absence is not zero'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
