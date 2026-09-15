/* The inventory must match the sources it claims to describe.
 *
 * A page generated once and never rechecked is a hand-copied fact: it drifts,
 * and nothing says so. That is the same shape as the ADR index rebuilt by hand
 * because no parser had been committed.
 *
 * This regenerates into a temp file and compares. If an asset gained or lost a
 * name without the inventory being rebuilt, this goes red.
 *
 * Usage: node dom_contract_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCAN = path.join(__dirname, 'dom_contract_scan.py');
const DOC = path.join(ROOT, 'docs', 'dom-contract.md');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

if (!fs.existsSync(SCAN)) {
  console.log('  FAIL  scanner missing: ' + SCAN);
  process.exit(1);
}
if (!fs.existsSync(DOC)) {
  console.log('  FAIL  inventory missing: ' + DOC);
  process.exit(1);
}

const committed = fs.readFileSync(DOC, 'utf8');
const before = fs.readFileSync(DOC, 'utf8');

let ran = true;
try {
  execFileSync('python3', [SCAN], { cwd: ROOT, stdio: 'pipe' });
} catch (e) {
  ran = false;
  console.log('  FAIL  scanner did not run: ' + (e.message || e));
}
check('the scanner runs', ran);

if (ran) {
  const regenerated = fs.readFileSync(DOC, 'utf8');
  check('the inventory matches a fresh scan', regenerated === committed,
    regenerated === committed ? '' : 'the page has drifted from the sources');

  // Leave the tree as it was: this test reports, it does not rewrite.
  fs.writeFileSync(DOC, before);
}

/* The two classes that the first scan could not see. They are asserted by the
 * e2e, so they must appear in the inventory's test-criteria section — not in
 * the "free to change" section. */
const testSection = committed.slice(committed.indexOf('## 二、测试判据'),
  committed.indexOf('## 三、'));
check('.foot is listed as a test criterion', testSection.indexOf('.foot') !== -1);
check('.e-trk-nm is listed as a test criterion', testSection.indexOf('.e-trk-nm') !== -1);

console.log('');
console.log(failures === 0 ? 'OK — all passed' : 'FAILED: ' + failures);
process.exit(failures === 0 ? 0 : 1);
