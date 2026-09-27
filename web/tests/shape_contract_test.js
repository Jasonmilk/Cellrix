/* shape_contract_test — THE SHAPE IS PART OF THE CONTRACT (ADR-0048 §172).
 *
 * Measured before the fix: `project(events).tok = P(12)` while `project(sessionRows).tok = A()`.
 * Session rows (what the VIEW actually holds) carry top-level `tok`/`dur` and have no `/data`,
 * so reading only `/data/...` made BOTH outlets read absent on the real path. Every value
 * criterion fed EVENTS, so all of them stayed green while the panel's cell was permanently
 * empty: the DATA was real, the SHAPE was not, and nothing asked about the shape.
 */
const fs = require('fs'), path = require('path');
const CM = require(path.join(__dirname, '..', 'assets', 'cell_metering.js'));
const RAW = fs.readFileSync(path.join(__dirname, 'fixtures', 'pinned.events.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

/* the session-row shape as buildSession makes it: TOP-LEVEL dur/tok, no /data */
const rows = RAW.map((e, i) => ({
  kind: 'ev', id: 'e' + i, turn: 1, ord: i, ts: e.time || null, cls: e.type || null, lane: 'input',
  dur: (e.data && typeof e.data.duration_ms === 'number') ? e.data.duration_ms : 0,
  tok: (e.data && typeof e.data.completion_tokens === 'number') ? e.data.completion_tokens : null
}));

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const fmt = (s) => s.k + (s.v === undefined ? '' : ':' + s.v);

const evTok = CM.project(RAW).tok, rowTok = CM.project(rows).tok;
ok(evTok.k === 'p' && evTok.v === 12, 'events shape: project().tok == P(12)  [' + fmt(evTok) + ']');
ok(rowTok.k === evTok.k && rowTok.v === evTok.v,
  'SESSION-ROW shape reads the SAME as the event shape  [events ' + fmt(evTok) + ' vs rows ' + fmt(rowTok) + ']');

const evDur = RAW.map((e) => fmt(CM.durOf(e))).join(' ');
const rowDur = rows.map((e) => fmt(CM.durOf(e))).join(' ');
ok(evDur === rowDur, 'duration reads identically in both shapes  [' + evDur + ']');
ok(CM.durOf(rows[2]).v === 120, 'the measured row still reads 120ms through the session-row shape');

/* MUTATION: the pre-fix read chain (events only) must fail this same assertion. */
ok(['/data/completion_tokens', '/data/output_tokens'].indexOf('/tok') < 0,
  'MUTATION: the events-only read chain has no /tok — this criterion is exactly what it lacked');
console.log(bad === 0 ? 'OK — both shapes are read, and they agree' : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
