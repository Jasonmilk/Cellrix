/* view_hygiene_test — THE GATE POINTS AT THE TARGET (ADR-0048 §65, milestone M0).
 *
 * Until now every criterion acted on files WE wrote; not one read prove_track.view.js,
 * so a fully green gate was compatible with that cell being 100% broken. This is the
 * baseline N that §33 registered long ago ("record a classified baseline, then drive it
 * to 0") and that had never been executed because there was nothing reading the view.
 *
 * Four classes, each a DIFFERENT root cause:
 *   bare-slash      `a / b`            -> NaN/Infinity at the geometry layer
 *   fallback-or     `x || lit`         -> one operator swallowing 0/null/absent
 *   typeof-existence `typeof x === 'number'` -> presence judged by type, not state
 *   bare-threshold  `0.5 / 1.2 / 0.05` -> undeclared decision thresholds
 *
 * Comments are stripped first: a rule must not be satisfied (or broken) by prose.
 * cell_before.js is the museum piece and is exempt via deferrals.json (the FILE, not
 * the rule).
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'assets', 'prove_track.view.js');
/* BASELINE IS MEASURED, AND ITS SCOPE IS DECLARED (ADR-0048 §65.2).
 * The reviewer's proof of concept measured THIS CELL's path and got 9; this checker
 * scans the WHOLE FILE and measures 30. Neither number is invented; they answer
 * different questions. M3 targets the whole file — a STRONGER bar than the cell alone —
 * and the refinement to a cell-scoped range is registered rather than guessed. */
const BASELINE = { 'bare-slash': 7, 'fallback-or': 18, 'typeof-existence': 2, 'bare-threshold': 3 };
const SCOPE_NOTE = 'whole file (cell-scoped proof of concept measured 9)';

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}
const raw = fs.readFileSync(TARGET, 'utf8');
const code = stripComments(raw);

const counts = { 'bare-slash': 0, 'fallback-or': 0, 'typeof-existence': 0, 'bare-threshold': 0 };
code.split('\n').forEach(function (line) {
  /* bare '/' between expressions — exclude '//' comments (already stripped) and '/*' */
  if (/[A-Za-z0-9_)\]]\s*\/\s*[A-Za-z0-9_(]/.test(line)) { counts['bare-slash']++; }
  if (/\|\|\s*(\d|'|"|\{|\[)/.test(line)) { counts['fallback-or']++; }
  if (/typeof\s+[A-Za-z_$][\w$.]*\s*===?\s*['"]number['"]/.test(line)) { counts['typeof-existence']++; }
  if (/(^|[^\w.])(0\.5|1\.2|0\.05)(?![\d])/.test(line)) { counts['bare-threshold']++; }
});

if (process.argv.indexOf('--emit-baseline') > -1) {
  console.log(JSON.stringify(counts));
  process.exit(0);
}

let bad = 0;
const total = Object.keys(counts).reduce(function (a, k) { return a + counts[k]; }, 0);
const baseTotal = Object.keys(BASELINE).reduce(function (a, k) { return a + BASELINE[k]; }, 0);
/* THE TARGET IS ZERO, NOT THE BASELINE (ADR-0048 §65.5). Using the baseline as a
 * tolerance made this very checker green while the cell was 100% broken — the disease
 * it exists to treat, committed while writing it. N is a RECORDED STARTING POINT; the
 * criterion is 0, so the gate is RED TODAY and gets greener only by real work. */
for (const k of Object.keys(counts)) {
  const okNow = counts[k] === 0;
  console.log((okNow ? '  ok   ' : '  FAIL ') + k + ': ' + counts[k]
    + ' (recorded start ' + BASELINE[k] + ', target 0)');
  if (!okNow) { bad++; }
}
console.log('  TARGET  ' + path.relative(process.cwd(), TARGET) + '   [' + SCOPE_NOTE + ']');
console.log('  TOTAL   ' + total + ' (recorded start ' + baseTotal + ', target 0)');
console.log(bad === 0
  ? 'OK — M3 REACHED: the target cell carries 0 occurrences of the four classes'
  : 'FAILED (M0, expected) — the target cell still carries ' + total
    + ' occurrences; M3 is this reaching 0');
process.exit(bad === 0 ? 0 : 1);
