/* tok_lower_bound_test — WIP, DECLARED (ADR-0048 §182).
 *
 * The product changes this criterion is meant to guard HAVE LANDED:
 *   · `turns[n].bound` is delivered (the third slot);
 *   · the folded row goes through `foldedCell` alone (one outlet, one statement);
 *   · the reply row's field is `tokTotal` (the total), so `tok` means one thing (the generated count).
 * What is NOT finished is this file's own input: measured, `project(rows,{usage})` on rows built
 * here reports `turns[0] === undefined`, because the synthetic rows do not produce a turn — the
 * THIRD appearance of "my input cannot reach the code under test" (§172, §181.4). Until the input
 * is taken from the real pipeline (as `tok_outlet_test.js` does, and that one is green), this
 * criterion proves nothing, so it is declared here rather than left to fail or silently pass.
 */
const path = require('path'), fs = require('fs');
const CM = require(path.join(__dirname, '..', 'assets', 'cell_metering.js'));
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const view = fs.readFileSync(path.join(__dirname, '..', 'assets', 'prove_track.view.js'), 'utf8');

/* the two claims this file CAN make today, without a session */
ok(view.indexOf('fmtTok(g.tok.v)') < 0 && view.indexOf('foldedCell(g)') >= 0,
  'the view has ONE outlet for the tok fact (it asks foldedCell instead of deciding)');
ok(view.indexOf('usage: S.usage') >= 0, 'and it declares its input (rule ⑩)');
ok(/turns\[n\]\.bound = TS\.lowerBound/.test(fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'cell_metering.js'), 'utf8')),
  'the third slot (bound) is delivered next to value and partial');
if (bad === 0) {
  console.log('  NOTE  the session-level assertions (partial ⇒ "12 ≥", exact ⇒ no marker) need the'
    + ' REAL pipeline input; declared as WIP in suite_registry_test (§182).');
}
console.log(bad === 0 ? 'OK — the three slots exist and the view has one outlet (session half declared WIP)'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
