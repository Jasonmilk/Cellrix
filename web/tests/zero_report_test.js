/* zero_report_test — A ZERO WITHOUT ITS n IS NOT A MEASUREMENT (ADR-0048 §200).
 *
 * Measured: I reported "f̂ = 0.000" after 8 identical gate runs. That is an unqualified zero.
 * The honest statement is the rule of three (Hanley & Lippman-Hand 1983, JAMA 249(13):1743-5):
 *   n observations, 0 events ⇒ 95% upper bound 3/n
 *     per GATE RUN      n = 8                ⇒ f ≤ 0.375
 *     per CRITERION-RUN n = 8 × 47 = 376     ⇒ f ≤ 0.008
 * — the same experiment, two units, bounds 47× apart, and my report carried neither.
 * AND, worse for the conclusion I drew from it: all 8 runs shared ONE environment (stack up,
 * siblings present), so they cannot separate the systematic component f_s (environment) from the
 * random one f_i. "The noise is in E, not n" was therefore NOT supported by that experiment.
 */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'run_all.js'), 'utf8');
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

/* the rule of three, as a function anyone can call before printing a zero */
function zeroBound(n) { return n > 0 ? 3 / n : null; }
ok(Math.abs(zeroBound(8) - 0.375) < 1e-9, 'rule of three: 8 observations, 0 events ⇒ bound 0.375  [' + zeroBound(8) + ']');
ok(Math.abs(zeroBound(376) - 3 / 376) < 1e-9, 'and per criterion-run (8 × 47 = 376) ⇒ bound ' + (3 / 376).toFixed(5));
ok(zeroBound(0) === null, 'n = 0 has NO bound — an unqualified zero is not even computable');

/* the verdict must carry the environment (E), or counts are not comparable across commits */
ok(/\[E: cdp=/.test(SRC) && /siblings=/.test(SRC) && /jsdom=/.test(SRC),
  'the verdict line carries E (cdp up/down · siblings present · jsdom) — §200 (§241 corrected the label: the probe is the CDP port, not the panel)');
ok(/E IS PART OF THE VERDICT/.test(SRC), 'and says why (measured spans 44/45/47 proven)');

/* MUTATION: dropping E from the verdict must be visible to this criterion */
ok(SRC.indexOf("' held, ' + unknown.length + ' unregistered'") >= 0,
  'MUTATION scope: the pre-E verdict fragment is still findable (so the E assertion is about E, not about a missing string)');
console.log(bad === 0 ? 'OK — a zero carries its n, and a verdict carries its environment'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
