/* lane_value_test — B1: HERMETIC. The lane widths are checked against ARITHMETIC, not against
 * the system under test (ADR-0048 §165).
 *
 * Why hermetic: the live version could only run when the panel happened to have events, i.e. its
 * verdict was a function of the ENVIRONMENT (the same disease as the sibling-scan: 0.000 vs
 * 1.000 bits). A fixture in the repo makes it a function of the CODE.
 *
 * FIXTURE (fixtures/pinned.events.jsonl, 6 rows). Measured duration shapes: a a p(120) a a a.
 *   gridCols = 200 ⇒ the reserved tick = 100/200 = 0.5%
 *   value mode: the ONE measured row gets 100 − 5×0.5 = 97.5%, the five others hold a 0.5% tick
 *   equal mode: the length channel is closed ⇒ every row takes 100/6 = 16.666…%
 * A non-measured row keeps a NON-ZERO width ON PURPOSE: `flex: 0 0 ` would omit flex-basis,
 * CSS then takes 0%, and the block disappears — the exact "all lanes empty while every suite is
 * green" regression this cell already fixed once (§10: a gap must stay a gap, not vanish). */
const fs = require('fs'), path = require('path');
const CM = require(path.join(__dirname, '..', 'assets', 'cell_metering.js'));
const GRID = 200, TICK = 100 / GRID;

const rows = fs.readFileSync(path.join(__dirname, 'fixtures', 'pinned.events.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const laneRows = rows.map((e) => ({ state: CM.durOf(e) }));
const shapes = laneRows.map((r) => r.state.k).join('');
const measured = laneRows.map((r, i) => (r.state.k === 'p' ? i : -1)).filter((i) => i >= 0);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const near = (a, b) => Math.abs(a - b) < 1e-6;

ok(shapes === 'aapaaa', 'fixture scope: the duration shapes are the pinned six (' + shapes + ')');
ok(measured.length === 1, 'fixture scope: exactly one measured row (index ' + measured[0] + ')');

/* ── expected values, computed HERE from the fixture, not asked of allocate ── */
const wantValue = rows.map((_, i) => (measured.indexOf(i) >= 0 ? 100 - (rows.length - 1) * TICK : TICK));
const wantEqual = rows.map(() => 100 / rows.length);

const v = CM.allocate(laneRows, { gridCols: GRID, mode: 'value' });
const q = CM.allocate(laneRows, { gridCols: GRID, mode: 'equal' });

ok(v.state === 'ok', 'value mode is usable (state=' + v.state + ')');
ok(v.cols.every((c, i) => near(c, wantValue[i])),
  'value widths == arithmetic: ' + wantValue.map((x) => x.toFixed(2)).join(', ')
  + ' (got ' + v.cols.map((x) => Number(x).toFixed(2)).join(', ') + ')');
ok(q.cols.every((c, i) => near(c, wantEqual[i])),
  'equal widths == 100/N = ' + wantEqual[0].toFixed(2) + ' for every row (length channel closed)');
ok(v.cols.every((c) => c > 0),
  'EVERY block keeps a NON-ZERO width — a missing basis would collapse the block (§10)');
ok(Math.abs(v.cols.reduce((s, c) => s + c, 0) - 100) < 1e-6, 'the value widths still sum to 100');

/* ── MUTATIONS: this check must be able to fail in both of its claims ── */
const oneOff = wantValue.map((c, i) => (i === measured[0] ? c - 1 : c));
ok(!oneOff.every((c, i) => near(c, v.cols[i])), 'MUTATION: shifting one col by 1% IS detected');
const collapsed = wantValue.map((c) => (c === TICK ? 0 : c));
ok(!collapsed.every((c) => c > 0), 'MUTATION: a zeroed tick IS caught (the collapse mistake)');
console.log(bad === 0 ? 'OK — the lane widths are pinned by arithmetic, hermetically'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
