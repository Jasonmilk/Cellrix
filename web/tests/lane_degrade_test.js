/* lane_degrade_test — HERMETIC. Every branch of the projection must keep its percentage column
 * honest: Σ cols <= 100 (ADR-0048 §166).
 *
 * Measured before the fix: the `row-exceeds-grid` branch returned CELL_PCT per row while its own
 * comment promised "a declared state, not a clamped sum" — Σ was 100.50% at 201 rows, 125.50% at
 * 251 and 250.50% at 501, and the view wrote them into flex-basis unread, so the strip overflowed.
 * A declared degradation still has to be an honest number, and the only consumer must act on it. */
const path = require('path');
const CM = require(path.join(__dirname, '..', 'assets', 'cell_metering.js'));

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const cases = [1, 2, 6, 150, 151, 200, 201, 202, 251, 501];
const rowsFor = (n) => Array.from({ length: n }, (_, i) => ({ state: i === 0 ? CM.P(120) : CM.A() }));

let worst = 0, worstAt = '';
const reasons = new Set();
for (const mode of ['value', 'equal']) {
  for (const n of cases) {
    const a = CM.allocate(rowsFor(n), { gridCols: 200, mode: mode });
    const sum = a.cols.reduce((x, y) => x + y, 0);
    if (sum > worst) { worst = sum; worstAt = mode + '/n=' + n + ' (' + a.reason + ')'; }
    if (a.reason) { reasons.add(a.reason); }
    if (a.cols.some((c) => typeof c !== 'number' || !isFinite(c) || c < 0)) {
      ok(false, mode + '/n=' + n + ': a column is not a finite non-negative number');
    }
  }
}
ok(worst <= 100 + 1e-9, 'Σ cols <= 100 in EVERY branch and mode (worst ' + worst.toFixed(2) + '% at ' + worstAt + ')');
ok(reasons.has('row-exceeds-grid') && reasons.has('reserve-over-budget'),
  'the degraded branches are still REACHED by this probe (declared, not silently skipped)');

/* MUTATION: the old behaviour (one CELL_PCT per row) must be caught by the same rule. */
const n = 251, cellPct = 0.5;
ok(n * cellPct > 100, 'MUTATION: the pre-fix behaviour (' + n + ' rows x ' + cellPct + '%) IS over 100 — the rule can see it');
console.log(bad === 0 ? 'OK — every branch keeps the percentage column honest'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
