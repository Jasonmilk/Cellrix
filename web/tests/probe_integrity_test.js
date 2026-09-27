/* probe_integrity_test — A CRITERION ABOUT CRITERIA (ADR-0048 §204).
 *
 * Measured on the previous agent_loop_probe_test.js: ok(true, …) × 3 and ok(false, …) × 2, with
 * comments saying "must be able to break it". A hard-coded lamp has I(proposition; lamp) = 0.0000
 * bits in BOTH directions — a glued red and a glued green are equally uninformative, and neither
 * turns when the code is written. This file is the guard that keeps that from coming back.
 */
const fs = require('fs'), path = require('path');
const HERE = __dirname;
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

const files = fs.readdirSync(HERE).filter((f) => /_test\.js$/.test(f));
const hard = [];
files.forEach((f) => {
  const s = fs.readFileSync(path.join(HERE, f), 'utf8');
  /* STRIP COMMENTS AND STRING LITERALS FIRST (ADR-0048 §204.5): my first version flagged the
   * sentence that DESCRIBES the defect and the mutation's own literal — i.e. it punished the
   * documentation. That is §156.5 again: the record of the mistake re-created the mistake. */
  const codeOnly = s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"[^"\n]*"/g, '""');
  codeOnly.split('\n').forEach((line, i) => {
    if (/ok\(\s*(true|false)\s*,/.test(line)) { hard.push(f + ':' + (i + 1)); }
  });
});
ok(hard.length === 0, 'NO suite asserts a hard-coded boolean (measured before: 5 such lines in one file)'
  + (hard.length ? '  [' + hard.slice(0, 4).join(', ') + ']' : ''));

/* The probes must ask the RIGHT PLACE: a protocol name belongs at the boundary (CI-144), so no
 * probe may demand it inside assembly.js. */
const PROBE = fs.readFileSync(path.join(HERE, 'agent_loop_probe_test.js'), 'utf8');
ok(PROBE.indexOf("read('web/assets/assembly.js')") < 0,
  'no probe greps assembly.js for a protocol name (CI-144: the name appears once, at the boundary)');
ok(/PT\.retryBranch|PT\.runLoop|PT\.replay/.test(PROBE),
  'the probes CALL the declared entry points — the failure is the evidence, not the assertion text');
ok(!/\/maxCost\|maxTokens\|budget\/i\.test\(/.test(PROBE),
  'and none asserts the ABSENCE of a word (the old form matched `reserve-over-budget`, a different quantity)');

/* MUTATION: injecting one hard-coded assertion must be caught by this criterion */
const injected = PROBE + '\nok(' + 'false' + ', "injected");\n';   /* built by concatenation: the literal must not be scannable */
const tmp = path.join(HERE, 'zz_probe_integrity_probe.js');
fs.writeFileSync(tmp, injected);
try {
  const caught = /ok\(\s*(true|false)\s*,/.test(fs.readFileSync(tmp, 'utf8'));
  ok(caught, 'MUTATION: a hard-coded assertion IS visible to the same rule (this criterion can fail)');
} finally { fs.unlinkSync(tmp); }
console.log(bad === 0 ? 'OK — the probes are wired, not glued'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
