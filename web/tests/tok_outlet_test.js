/* tok_outlet_test — THE DECLARED INPUT REACHES BOTH HOSTS (ADR-0048 §181).
 *
 * `prove_track.render.js` declares `NOT_DRAWN: { metering: … }` — the meter is not a cycle step.
 * That decision is CORRECT, and its downstream cost was that no metering row ever reaches the
 * session, so the per-row fold read `A()` and the folded cell printed "· 无数据" while
 * `derivePeriodUsage(nodes).completion` was 12 all along. The fix is not to draw a row: it is to
 * accept the declared input — and to accept it in BOTH hosts, because the view reads `turns[i].tok`.
 */
const path = require('path');
const CM = require(path.join(__dirname, '..', 'assets', 'cell_metering.js'));

const ROWS = [
  /* `turn` is what makes the projection build a TURN — without it `turns[]` is empty and the host
   * the view reads does not exist at all (measured: turns[0] === undefined). */
  { kind: 'ev', id: 'e0', turn: 1, ord: 0, sem: 'turn', dur: null, tok: null },
  { kind: 'ev', id: 'e1', turn: 1, ord: 1, sem: 'tool', dur: 120, tok: null }
];
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const fmt = (s) => s.k + (s.v === undefined ? '' : ':' + s.v);

const withUsage = CM.project(ROWS, { usage: { completion: 12 } });
ok(withUsage.tok && withUsage.tok.k === 'p' && withUsage.tok.v === 12,
  'project(rows, {usage}) ⇒ top-level tok == P(12)  [' + (withUsage.tok && fmt(withUsage.tok)) + ']');
const t0 = withUsage.turns && withUsage.turns[0];
ok(t0 && t0.tok && t0.tok.k === 'p' && t0.tok.v === 12,
  'AND turns[0].tok == P(12) — the host the view actually reads  [' + (t0 && t0.tok && fmt(t0.tok)) + ']');
ok(t0 && withUsage.tok.v === t0.tok.v, 'the two hosts agree (one fact, two homes must not drift)');

const partial = CM.project(ROWS, { usage: { completion: 12, completionPartial: true } });
ok(partial.partial === true || (partial.turns[0] && partial.turns[0].partial === true),
  'completionPartial ⇒ the fold is marked partial (a lower bound stays visible)');

const withOut = CM.project(ROWS);
ok(withOut.tok && withOut.tok.k === 'a',
  'WITHOUT the declaration the old answer stands (A()) — rule ⑩: no declaration, no value  ['
  + (withOut.tok && fmt(withOut.tok)) + ']');

/* MUTATIONS */
const changed = CM.project(ROWS, { usage: { completion: 99 } });
ok(changed.tok.v === 99 && changed.tok.v !== 12,
  'MUTATION: changing the declared completion IS carried through (99 ≠ 12)');
ok(CM.project(ROWS, { usage: { completion: -1 } }).tok.k === 'a',
  'MUTATION: an ILLEGAL declaration is refused, not absorbed (completion:-1 ⇒ A())');
console.log(bad === 0 ? 'OK — the declared meter reaches both hosts, and only when declared'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
