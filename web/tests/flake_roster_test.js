/* flake_roster_test — FLAKY IS A THIRD ROSTER (ADR-0048 §201).
 *
 * The two obvious options are both wrong, and this file's own note forbids one of them:
 *   A: treat red-then-green as green  ⇒ washes out intermittent REAL defects (measured escape 37.5%)
 *   B: leave it red forever           ⇒ "trains people to ignore red, and then the real reds go too"
 *   C: file it                        ⇒ separate roster + append-only ledger, neither red nor proven
 * And a single retry is not the verdict (P(defect | flaky once) = 0.6238); K>=3 is (0.9994).
 */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'run_all.js'), 'utf8');
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

ok(/RETRY_FLAKY/.test(SRC) && /flakyRoster\.push/.test(SRC),
  'the third roster EXISTS (it did not before: grep retry|flake|flaky was 0 hits)');
ok(/RETRY_FLAKY && e\.status === 1/.test(SRC),
  'and it retries ONLY exit 1 — retrying 2/3/4 would launder an environment absence into green');
ok(/process\.argv\.indexOf\('--retry-flaky'\)/.test(SRC),
  'it is OPT-IN: the default gate is unchanged, so it cannot change CI silently');
ok(/FLAKY_LEDGER/.test(SRC) && /appendFileSync/.test(SRC),
  'the evidence is FILED in an append-only ledger (not laundered, not lost)');
ok(/FLAKY_ESCALATE_AT = 3/.test(SRC) && /seen flaky/.test(SRC),
  'and K>=3 escalates back to RED — cross-run aggregation is the verdict, not one retry');
ok(/FLAKY \(filed, neither red nor proven\)/.test(SRC),
  'the verdict names the roster as NEITHER red nor proven (a count without its class is not a fact)');
ok(SRC.indexOf('FLAKY ' + "' + file + '") >= 0 || /FLAKY ' \+ file/.test(SRC),
  'and the per-suite line says FILED, not passed');

/* MUTATION: reverting to option A (treat the green as proof) must be visible */
const optA = SRC.replace(/if \(flakyCount\(file\) >= FLAKY_ESCALATE_AT\) \{/, 'if (false) {');
ok(optA !== SRC, 'MUTATION: the A/B/C decision is a real branch in the source (it can be reverted)');
/* A FOURTH FACT: SKIPPED (§287). A suite can pass while criteria never ran; if that count is not in the
 * verdict, "proven" silently means "proven OR not looked at". The three checks below pin the wiring, and
 * the mutation shows they can go red: delete the verdict clause and the pattern disappears. */
ok(/let skippedTotal = 0;/.test(SRC), 'the runner accumulates a SKIPPED total (a fact, not a footnote)');
ok(/\(\\d\+\) skipped/.test(SRC), 'and it reads the count from the suite\'s own RESULT line');
ok(/skipped \(criteria that RAN NOTHING/.test(SRC), 'and the verdict names the class: criteria that RAN NOTHING');
/* A REAL mutation (§287): delete the exact clause by literal string, so the pattern the check looks
 * for is genuinely gone — a regex that fails to match would leave this check as a tautology. */
const NO_SKIP_CLAUSE = "+ (skippedTotal ? ', ' + skippedTotal + ' skipped (criteria that RAN NOTHING: nothing to exercise)' : '')";
const noSkipClause = SRC.split(NO_SKIP_CLAUSE).join('');
ok(!/skipped \(criteria that RAN NOTHING/.test(noSkipClause),
  'MUTATION: removing the verdict clause makes the check above fail (it is not a tautology)');

console.log(bad === 0 ? 'OK — red, green, and FILED are three different things'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
