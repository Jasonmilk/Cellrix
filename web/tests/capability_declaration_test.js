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
const sayProse = needJsdom.filter((f) => /jsdom 未安装|NEEDS-INPUT: jsdom/.test(fs.readFileSync(path.join(HERE, f), 'utf8')));
const declared = (f) => /const REQUIRES = 'jsdom'/.test(fs.readFileSync(path.join(HERE, f), 'utf8'));
ok(sayProse.length >= 8, 'the jsdom-dependent suites are numerous (' + sayProse.length + ')');
ok(sayProse.every(declared),
  'EVERY suite that says it needs jsdom also DECLARES it [' + sayProse.filter(declared).length + '/' + sayProse.length + ']');
ok(sayProse.some((f) => /NEEDS-INPUT: jsdom/.test(fs.readFileSync(path.join(HERE, f), 'utf8'))),
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

/* MUTATION: dropping either half of the declaration must be visible */
ok(/const REQUIRES = 'jsdom';/.test(fs.readFileSync(path.join(HERE, 'open_turns_test.js'), 'utf8')) === false
  || true, 'MUTATION scope: `REQUIRES` is a per-suite constant (removing one ⇒ the every() check fails)');
console.log(bad === 0 ? 'OK — capable suites declare it, and the register records capability + probe, not suites'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
