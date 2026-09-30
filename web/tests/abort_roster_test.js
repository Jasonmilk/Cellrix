#!/usr/bin/env node
/* THE CRASH PATH IS EXERCISED, NOT JUST DECLARED (§295).
 *
 * The gate can tell four facts apart — passed / not-run / absent / crashed — only if the CRASH path is
 * exercised and its exit code is a real, distinguishable signal. Measured 2026-09-30: a synthetic
 * `process.exit(4)` produced `ABORT <suite> — the suite crashed; nothing was asserted` plus
 * `, 1 ABORTED (not red)` in the verdict. This suite pins that contract so it cannot rot:
 *   · exit 4 is OBSERVABLE (a real child process can be spawned and its code read)
 *   · exit 4 and exit 2 are DISTINCT (crash vs environment) — the laundering this chain kept finding
 *   · the runner maps 4 to the ABORT roster, reads stderr, and names the count in the verdict
 *
 * Usage: node abort_roster_test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* ---- functional half: the exit codes are real and distinct ------------------------------- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abort-fixture-'));
const crash = path.join(dir, 'crash.js');
const envv = path.join(dir, 'env.js');
fs.writeFileSync(crash, 'process.exit(4);\n');
fs.writeFileSync(envv, 'process.exit(2);\n');
const codeOf = (f) => {
  try { execFileSync(process.execPath, [f], { stdio: 'pipe' }); return 0; }
  catch (e) { return e.status; }
};
ok('a crashing child is observable as exit 4', codeOf(crash) === 4, 'status=' + codeOf(crash));
ok('an environment-absence child is exit 2, and the two are DISTINCT',
  codeOf(envv) === 2 && codeOf(crash) !== codeOf(envv), 'crash=' + codeOf(crash) + ' env=' + codeOf(envv));

/* ---- contract half: the runner's wiring --------------------------------------------------- */
const SRC = fs.readFileSync(path.join(__dirname, 'run_all.js'), 'utf8');
ok('the runner maps exit 4 to the ABORT roster', /if \(e\.status === 4\)[\s\S]{0,200}abortedRoster\.push/.test(SRC));
ok('and it reads STDERR, so the crash reason is not thrown away', /e\.stderr/.test(SRC));
ok('the verdict names the ABORTED class (not merely a number)', /ABORTED \(not red\)/.test(SRC));
ok('ABORT is never retried as flaky', !/RETRY_FLAKY && e\.status === 4/.test(SRC));

/* ---- the sweep: no HARNESS ERROR may be filed as ENV (exit 2) ----------------------------- */
const offenders = [];
for (const f of fs.readdirSync(__dirname).filter((x) => x.endsWith('.js'))) {
  const s = fs.readFileSync(path.join(__dirname, f), 'utf8');
  const m = s.match(/\.catch\(\(e\)\s*=>\s*\{[^}]*process\.exit\(2\)/);
  if (m) { offenders.push(f); }
}
ok('no harness-error catch still exits 2 (crash must not be laundered into ENV)',
  offenders.length === 0, offenders.join(',') || 'none');

console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
