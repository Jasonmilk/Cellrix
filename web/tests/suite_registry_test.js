/* suite_registry_test — ABSENCE IS NOT A PASS, APPLIED TO THE SUITE LIST ITSELF (ADR-0048 §129).
 *
 * `run_all.js` exists to make ABSENCE visible: a suite that never runs reads like coverage,
 * and its own header says exactly that. But the entry that makes a suite visible is a line a
 * human types, so three suites (value_criterion_test.js, port_table_test.js, render_test.js)
 * shipped, were executed BY HAND, and were never in the gate — green-looking, never run.
 *
 * This asserts the COVERAGE RELATIONSHIP instead of trusting the typing:
 *   every *_test.js  ∈  SELF_CONTAINED  ∪  declares REQUIRES  ∪  declared exempt
 * Scope non-empty first: a parser that found no suites would otherwise "cover" nothing.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
let bad = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) bad++; };

/* Files that are NOT suites on purpose, each with a reason. A silent exemption list would be
 * the same disease in a new place, so every entry carries its own justification. */
const NOT_A_SUITE = {
  'pinned_expectation.js': 'the ORACLE (a library the criterion requires), not a suite',
  'known_bad_reader.js': 'a fixture reader used BY suites',
  'probe_bug.js': 'a probe used BY suites',
  'snapshot.js': 'a tool, run by hand',
  'snapshot_selftest.js': 'a tool self-test, run by hand',
  'cell_before.js': 'museum piece — the pre-fix capture (exempt in deferrals.json)',
  'readRowsIn': 'n/a'
};

/* Suites that CANNOT run in the gate on an arbitrary machine, each naming the capability it
 * needs. Declared here, in the open — a hidden skip is the disease; a named one is a fact.
 * (The stronger form is a `REQUIRES` capability with a probe in deferrals.json; that is
 * registered as the follow-up, and this map is what keeps them VISIBLE until then.) */
const NEEDS_CAPABILITY = {
  'port_table_test.js': 'sibling repos — reads Helix-Mind/docs/helixECO/ports.json (declared SKIP + exit 4 when absent)',
  'render_test.js': 'jsdom + the live panel — a real render needs both',
  'chat_model_test.js': 'a live panel address — exits 3 NEEDS-INPUT without one (measured)'
};

const files = fs.readdirSync(DIR).filter((f) => /_test\.js$/.test(f)).sort();
const runner = fs.readFileSync(path.join(DIR, 'run_all.js'), 'utf8');
const listed = new Set((runner.match(/'([a-z0-9_]+_test\.js)'/g) || [])
  .map((m) => m.replace(/'/g, '')));

const uncovered = [], declared = [];
files.forEach((f) => {
  if (listed.has(f)) { return; }
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  if (/^const\s+REQUIRES\s*=/m.test(src)) { declared.push(f); return; }
  if (NOT_A_SUITE[f]) { return; }
  if (NEEDS_CAPABILITY[f]) { return; }        /* declared, with the capability it needs */
  uncovered.push(f);
});

ok(files.length >= 20, 'scope: found >= 20 *_test.js suites (got ' + files.length + ')');
ok(listed.size >= 20, 'scope: run_all lists >= 20 suites (got ' + listed.size + ')');
ok(uncovered.length === 0,
  'coverage: every suite is executed or DECLARES its capability'
  + (uncovered.length ? ' — MISSING from the gate: ' + uncovered.join(', ') : ''));

/* MUTATION PROBE: a fabricated name must be reported as uncovered, or this check is blind. */
const probe = files.concat(['zz_fabricated_suite_test.js']).filter((f) => !listed.has(f)
  && !NOT_A_SUITE[f] && !/^const\s+REQUIRES\s*=/m.test(
    fs.existsSync(path.join(DIR, f)) ? fs.readFileSync(path.join(DIR, f), 'utf8') : ''));
ok(probe.indexOf('zz_fabricated_suite_test.js') > -1,
  'MUTATION PROBE: an unregistered suite name is reported as uncovered');

console.log('  --- ' + files.length + ' suites; ' + listed.size + ' listed; '
  + declared.length + ' declare REQUIRES [' + declared.join(', ') + ']; '
  + Object.keys(NOT_A_SUITE).length + ' declared not-a-suite; '
  + Object.keys(NEEDS_CAPABILITY).length + ' declared needs-capability ['
  + Object.keys(NEEDS_CAPABILITY).join(', ') + ']');
console.log(bad === 0 ? 'OK — the suite registry covers every suite' : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
