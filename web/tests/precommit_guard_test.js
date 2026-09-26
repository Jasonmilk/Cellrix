/* precommit_guard_test — A GUARD THAT DOES NOT PASS THROUGH ITSELF (ADR-0048 §107.5).
 * precommit.sh sits inside the change surface it checks, so its own "PRECOMMIT OK" cannot
 * vouch for its own integrity. This asserts, from OUTSIDE it, that the five steps are
 * still declared and that the gate still declares a red path and a whole-gate verdict.
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'precommit.sh'), 'utf8');

const steps = ['syntax of every touched JS', 'LOAD SMOKE', 'gate (normal path)',
               'gate RED PATH', 'whole gate'];
const missing = steps.filter(function (s) { return src.indexOf(s) === -1; });
console.log((missing.length ? '  FAIL ' : '  ok   ')
  + 'PRECOMMIT SELF-GUARD — all five steps still declared'
  + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));

/* The red path must still be run: a gate whose red path was quietly dropped is a gate
 * that can no longer be shown to have teeth. */
const hasRedPath = src.indexOf('RED PATH') > -1;
/* THE OUTSIDE GUARD FOR THE ACCOUNTING (ADR-0048 §147): run_all.js is inside the surface it
 * checks, so its exit-code classification needs a check that does not pass through it. If the
 * split is removed, "red" silently widens again — which is exactly what happened across. */
/* NOTE: `src` above is precommit.sh — the runner is a DIFFERENT file, and my first version
 * checked the wrong one (the guard failed, which is how I found out). */
const runnerSrc = fs.readFileSync(path.join(__dirname, 'run_all.js'), 'utf8');
const hasExitAccounting = /abortedRoster\.push/.test(runnerSrc)
  && /envMissingRoster\.push/.test(runnerSrc);
const hasVerdict = src.indexOf('PRECOMMIT') > -1 && src.indexOf('verdict') > -1;
console.log((hasExitAccounting ? '  ok   ' : '  FAIL ')
  + 'PRECOMMIT SELF-GUARD — the runner still SPLITS exit codes (1 red / 2 env / 4 crash)');
console.log((hasRedPath && hasVerdict ? '  ok   ' : '  FAIL ')
  + 'PRECOMMIT SELF-GUARD — red path and verdict still present');

process.exit((missing.length === 0 && hasRedPath && hasVerdict && hasExitAccounting) ? 0 : 1);
