/* adr_boundary_test — the fence BEFORE the work, guarding the ADR's CONCERN and not
 * just a list of names (Cellrix:ADR-0048 §13).
 *
 * A static allow-list of files is always bypassed: implementation inevitably touches
 * something outside it. So the judgement is semantic — the governed CONCERN — and the
 * path list is only its executable projection. The fence is BOTH WAYS: crossing the
 * boundary is a violation (red); governed files moving without the ADR moving is a
 * signal (WARN, because implementing inside the declared concern is expected).
 */
const { execFileSync } = require('child_process');
const path = require('path');

/* Cellrix is its own git repository, so the base is TWO levels up — not three.
 * (Every repo in this workspace has its own .git; the parent directory has none.) */
const ROOT = path.join(__dirname, '..', '..');
const ADR = 'docs/decisions/ADR-0048-panel-state-owner-and-render-contract.md';

/* The governor: the CONCERN, with the path list as its projection. */
const GOVERNS = ['web/assets/', 'web/src/', 'web/tests/'];
const ADR_PATHS = ['docs/decisions/'];

let files;
try {
  files = execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' })
    .split('\n').filter(Boolean).map(function (l) { return l.slice(3).trim(); });
} catch (e) {
  console.log('NEEDS-INPUT: git is not usable here, so the boundary cannot be judged');
  process.exit(3);
}

const inConcern = function (f) {
  return GOVERNS.some(function (g) { return f.indexOf(g) === 0; })
      || ADR_PATHS.some(function (g) { return f.indexOf(g) === 0; });
};
const outside = files.filter(function (f) { return !inConcern(f); });
if (outside.length) {
  console.log('BOUNDARY VIOLATION: ' + outside.join(', ')
    + ' — outside the governed concern (presentation-layer state and rendering).'
    + ' Either revert it, or amend ADR-0048 §13: the boundary is SEMANTIC and this'
    + ' path list is only its executable projection.');
  process.exit(1);
}

const governed = files.filter(function (f) { return GOVERNS.some(function (g) { return f.indexOf(g) === 0; }); });
const adrMoved = files.some(function (f) { return f === ADR; });
if (governed.length && !adrMoved) {
  console.log('BOUNDARY OMISSION (warn, not red): ' + governed.length
    + ' governed file(s) changed and ADR-0048 did not — implementing inside the concern'
    + ' is expected, but whether the boundary itself needs updating must be visible.');
}

console.log('OK — boundary holds (' + files.length + ' changed file(s), all within the declared concern)');
