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
const hasVerdict = src.indexOf('PRECOMMIT') > -1 && src.indexOf('verdict') > -1;
console.log((hasRedPath && hasVerdict ? '  ok   ' : '  FAIL ')
  + 'PRECOMMIT SELF-GUARD — red path and verdict still present');

process.exit((missing.length === 0 && hasRedPath && hasVerdict) ? 0 : 1);
