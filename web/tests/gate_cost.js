/* gate_cost.js — THE GATE'S COST, IN WALL-CLOCK SECONDS (ADR-0048 §202).
 *
 * Measured by the review (Gate cost — 51 suites, 9.0s): 19 suites (37%) run but produce NO verdict
 * and eat 3.56s = 39.6% of the gate. Counts cannot see that: UCL FSE 2024 measured that 72% of
 * cost-reduction papers use "number of mutants" as a cost proxy, with 44% average error and 37% of
 * RANKINGS FLIPPING. A count is not a cost.
 * Usage: node gate_cost.js [--json]     (read-only: it does not change run_all.js)
 */
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const HERE = __dirname;

/* the suite list lives in run_all.js; read it rather than restate it (rule ⑰) */
const src = fs.readFileSync(path.join(HERE, 'run_all.js'), 'utf8');
const suites = [...src.matchAll(/\['([a-z0-9_]+_test\.js)'/g)].map((m) => m[1]);

const rows = [];
for (const f of suites) {
  const t0 = Date.now();
  let code = 0;
  try { execFileSync(process.execPath, [path.join(HERE, f)], { stdio: 'pipe' }); }
  catch (e) { code = (e.status === undefined ? -1 : e.status); }
  rows.push({ file: f, ms: Date.now() - t0, exit: code });
}
const total = rows.reduce((a, r) => a + r.ms, 0);
const noVerdict = rows.filter((r) => r.exit !== 0 && r.exit !== 1);
const share = noVerdict.reduce((a, r) => a + r.ms, 0) / (total || 1);
const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
const out = {
  suites: rows.length, wallClockMs: total,
  noVerdictSuites: noVerdict.length, noVerdictSharePct: +(share * 100).toFixed(1),
  medianMs: sorted[Math.floor(sorted.length / 2)],
  max: rows.slice().sort((a, b) => b.ms - a.ms).slice(0, 3).map((r) => [r.file, r.ms])
};
if (process.argv.indexOf('--json') > -1) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
console.log('GATE COST — ' + out.suites + ' suites, ' + (total / 1000).toFixed(1) + 's wall-clock');
rows.sort((a, b) => b.ms - a.ms).forEach((r) => {
  console.log('  ' + String(r.ms).padStart(6) + 'ms  exit ' + String(r.exit).padStart(2) + '  ' + r.file);
});
console.log('RUNS BUT PRODUCES NO VERDICT: ' + out.noVerdictSuites + ' suites ('
  + Math.round(100 * out.noVerdictSuites / rows.length) + '%) = ' + (out.noVerdictSharePct)
  + '% of wall-clock');
console.log('median ' + out.medianMs + 'ms · slowest ' + JSON.stringify(out.max));
