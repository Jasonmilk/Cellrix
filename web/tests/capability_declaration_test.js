/* capability_declaration_test — "SAID" AND "DECLARED" ARE TWO HOSTS (ADR-0048 §203).
 *
 * Measured: ten suites printed `NEEDS-INPUT: jsdom 未安装` and NONE carried `const REQUIRES = 'jsdom'`.
 * The ledger reads the machine-readable host, so all ten were UNREGISTERED/BLOCKING — the ledger was
 * right to refuse a capability name with no probe; the DECLARATION was only half made.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const HERE = __dirname;
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

const suites = fs.readdirSync(HERE).filter((f) => /_test\.js$/.test(f));
const needJsdom = suites.filter((f) => /jsdom/.test(fs.readFileSync(path.join(HERE, f), 'utf8')));
/* A HOST IS A CALL, NOT A MENTION (2026-10-09). This filter used to match the PROSE anywhere in the
 * file — and this very suite QUOTES that prose in its header comment, so it counted ITSELF as a suite
 * that says it needs jsdom, then failed `every(declared)` because the auditor does not declare jsdom.
 * Measured: [12/13] with no real violator. The subject is the console.log CALL, so the test is on a
 * call — the same distinction the file's own subject draws between "said" and "declared". */
const sayProse = needJsdom.filter((f) => /console\.log\([^)]*NEEDS-INPUT: jsdom/.test(fs.readFileSync(path.join(HERE, f), 'utf8')));
/* MEMBERSHIP, NOT STRING EQUALITY (2026-10-09). This used to be `/const REQUIRES = 'jsdom'/` — an
 * EXACT match including the closing quote — so a suite declaring `'jsdom,panel-http'` (the composite
 * form the runner now reads as a LIST) stopped matching and this check went red: a FALSE red produced
 * by a detector whose vocabulary had not followed the format. Loosening it to "contains jsdom" would
 * be the wrong repair: it would then accept `REQUIRES='panel-http'` in a file that uses jsdom, which
 * is the real violation this check exists for. So the declaration is parsed and jsdom must be one of
 * its ITEMS. */
const declared = (f) => {
  const m = fs.readFileSync(path.join(HERE, f), 'utf8').match(/^const\s+REQUIRES\s*=\s*'([^']*)'/m);
  return !!m && m[1].split(/[,\s]+/).indexOf('jsdom') >= 0;
};
ok(sayProse.length >= 8, 'the jsdom-dependent suites are numerous (' + sayProse.length + ')');
ok(sayProse.every(declared),
  'EVERY suite that says it needs jsdom also DECLARES it [' + sayProse.filter(declared).length + '/' + sayProse.length + ']');
ok(sayProse.some((f) => /console\.log\([^)]*NEEDS-INPUT: jsdom/.test(fs.readFileSync(path.join(HERE, f), 'utf8'))),
  'and the human-readable host is still there (neither host replaces the other)');

const reg = JSON.parse(fs.readFileSync(path.join(HERE, 'deferrals.json'), 'utf8'));
const jsdomReq = (reg.requires || []).filter((r) => r.probe === 'jsdom');
ok(jsdomReq.length === 1 && jsdomReq[0].id, 'the register records the jsdom CAPABILITY with its probe (not a suite list)');
ok(reg.deferrals.every((d) => !(d.suites || []).some((s) => sayProse.indexOf(s) >= 0)),
  'and it does NOT name the suites (the register cannot attach a requirement to a suite)');

const SRC = fs.readFileSync(path.join(HERE, 'run_all.js'), 'utf8');
ok(/name === 'jsdom'/.test(SRC), 'run_all has a jsdom PROBE (a capability name without a probe stays UNKNOWN ⇒ blocking)');
ok(/PROBE_CACHE/.test(SRC) && /ONE PROBE PER CAPABILITY PER GATE RUN/.test(SRC),
  'and probing is MEMOISED: once per capability per gate run (measured ~11% of the gate was spent re-learning it)');
ok(/join\(__dirname, file\), \.\.\.extra\]/.test(SRC),
  'the FLAKY retry passes the SAME arguments — otherwise a real red is filed as flaky (option A resurrected)');

/* DELETED (2026-10-09): this was `ok(... === false || true, 'MUTATION scope: ...')` — the `|| true`
 * made it UNCONDITIONALLY GREEN. It called itself a MUTATION while being structurally unable to go
 * red, and the property it named is already carried by the `every(declared)` check above (removing a
 * declaration from a jsdom-dependent suite makes THAT go red — verified by mutation, not by prose).
 * A criterion whose only failure mode is a syntax error is decoration. GROWTH trap 15: "it must be
 * able to go red" has to be guaranteed by STRUCTURE, not by the word `MUTATION` in the name. */
console.log(bad === 0 ? 'OK — capable suites declare it, and the register records capability + probe, not suites'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
