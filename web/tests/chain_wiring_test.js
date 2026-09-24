#!/usr/bin/env node
/* The chain's wiring facts have ONE source (anaphase:ADR-0046).
 *
 * Measured 2026-09-24: three launchers carried three different wirings.
 * `anaphase-helix/src/bin/up.rs` started tentacle+mind and injected the
 * endpoints; `Cellrix/web/src/bin/up.rs --restart` started them but injected
 * nothing; `Cellrix/web/tests/start-panel.sh` started six processes and injected
 * nothing, and never started FlowModus's gRPC Reason listener at all. Result:
 * every port healthy, every health check green, and Anaphase running three Noop
 * adapters plus a "bad endpoint" on the fourth.
 *
 * So the criterion is not "the launcher works" — it is "the launcher does not
 * restate a declared fact". A restated port is a port that will drift.
 *
 * Scope: the launchers listed in CONVERTED. Adding a launcher here is how the
 * ADR's staging advances; the check grows in strength as they convert.
 *
 * Exit 3 = the declaration is absent (cross-repo checkout) => SKIP with reason.
 */
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const WS = path.join(__dirname, '..', '..', '..');
const DECL = path.join(WS, 'anaphase-helix', 'ecosystem', 'chain.json');
const CONVERTED = [
  { rel: 'start-panel.sh', kind: 'shell' },
  { rel: path.join('..', 'src', 'bin', 'up.rs'), kind: 'rust' },
];

let pass = 0, fail = 0;
function check(label, cond, detail) {
  const tail = detail ? '  [' + detail + ']' : '';
  if (cond) { pass++; console.log('  PASS  ' + label + tail); }
  else { fail++; console.log('  FAIL  ' + label + tail); }
}

if (!fs.existsSync(DECL)) {
  console.log('NEEDS-INPUT: the chain declaration is absent: ' + DECL
    + ' (anaphase-helix checkout required)');
  process.exit(3);
}

const decl = JSON.parse(fs.readFileSync(DECL, 'utf8'));
const comps = decl.components || [];
const named = comps.map((c) => c.name);

/* ── 1. the declaration is complete and self-consistent ────────────────────
 * A launcher can only derive what the declaration actually states. */
check('the declaration names components', comps.length > 0, comps.length + ' component(s)');
const incomplete = comps.filter((c) => !c.name || !c.port || !c.kind || !c.order);
check('every component declares name + port + kind + order', incomplete.length === 0,
  JSON.stringify(incomplete.map((c) => c.name || '(unnamed)')));
const ports = comps.map((c) => c.port);
const dupes = ports.filter((p, i) => ports.indexOf(p) !== i);
check('no two components share a port', dupes.length === 0, JSON.stringify(dupes));
const halfEnv = comps.filter((c) => (c.anaphase_env ? !c.anaphase_value : !!c.anaphase_value));
check('anaphase_env and anaphase_value come in pairs', halfEnv.length === 0,
  JSON.stringify(halfEnv.map((c) => c.name)));
const orders = comps.map((c) => c.order).sort((a, b) => a - b);
check('the start order is a dense 1..N sequence',
  orders.length > 0 && orders.every((o, i) => o === i + 1), JSON.stringify(orders));

/* ── 2. each converted launcher derives rather than restates ─────────────── */
for (const { rel, kind } of CONVERTED) {
  const p = path.join(__dirname, rel);
  if (!fs.existsSync(p)) { check(`a launcher at ${rel}`, false); continue; }
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  // Comments may narrate ports; only executable lines are the launcher's claims.
  // `#` is a comment only in shell. Stripping every `#`-prefixed line for Rust
  // also removed `#[cfg(test)]` / `#[derive(..)]`, which silently defeated the
  // test-module cut below (measured: the cut looked applied but was not).
  const isComment = kind === 'shell'
    ? (l) => l.trim().startsWith('#')
    : (l) => l.trim().startsWith('//');
  let code = lines.filter((l) => !isComment(l)).join('\n');
  // A wiring criterion is about what the launcher DOES at runtime, not about the
  // fixtures its unit tests round-trip. `ci/check_line_budget.py` makes the same
  // cut at `#[cfg(test)]` for the same reason: policing a test fixture would
  // teach people to obfuscate fixtures rather than to single-source wiring.
  if (kind === 'rust') code = code.split('#[cfg(test)]')[0];

  /* The property is "gets its wiring from the ONE declaration", and since
   * Cellrix:ADR-0047 D3 a launcher may satisfy it by consuming the single
   * derivation (`chain-env`) instead of reading the JSON itself. That is the
   * STRONGER form — the script restates nothing — and it is why these two checks
   * accept it. Measured 2026-09-24: replacing start-panel.sh's derivation block
   * with a `chain-env` call turned both of these red, correctly, and the fix is to
   * follow the design rather than to keep the old wording. */
  check(`${rel}: gets its wiring from the one derivation`,
    code.includes('chain.json') || code.includes('Chain::load') || code.includes('chain-env'), rel);

  // (a) it must not restate a declared port
  const restated = comps
    .filter((c) => new RegExp('(?<![0-9.])' + c.port + '(?![0-9])').test(code))
    .map((c) => c.name + ':' + c.port);
  check(`${rel}: no declared port is restated in code`,
    restated.length === 0, restated.join(', ') || 'all ' + comps.length + ' ports derived');

  // (b) it must SUPPLY every declared endpoint env — by deriving them, not by
  // restating their names. A literal-name check would fail a launcher that is
  // *more* single-sourced than one that passes; the property is "consumes the
  // field", so that is what is asserted.
  const derived = comps.filter((c) => c.anaphase_env).length;
  check(`${rel}: derives the endpoint env from the declaration (not restated)`,
    derived === 0 || code.includes('anaphase_env') || code.includes('chain-env'),
    derived + ' declared env(s), consumed via: '
      + (code.includes('chain-env') ? 'chain-env (the one derivation)' : 'anaphase_env'));

  if (kind === 'shell') {
    // Parse the actual `spawn <name>` invocations.
    //
    // ⚠️ Measured: the first version searched for the bare name and passed on
    // `helix-mind` — so renaming `spawn mind` to `spawn mindX` went undetected.
    // A substring that happens to occur elsewhere is not evidence that the
    // component is started.
    const spawned = new Set([...code.matchAll(/\bspawn\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
    const notStarted = named.filter((n) => !spawned.has(n));
    check(`${rel}: spawns every declared component`, notStarted.length === 0,
      notStarted.join(', ') || [...spawned].sort().join(' '));

    const svcLine = (code.match(/^\s*SERVICES="([^"]*)"/m) || [, ''])[1].split(/\s+/);
    const notStoppable = named.filter((n) => !svcLine.includes(n));
    check(`${rel}: every declared component is in SERVICES (so --stop covers it)`,
      notStoppable.length === 0, notStoppable.join(', ') || svcLine.filter(Boolean).join(' '));
  } else {
    // Rust: "asks the declaration for each component" means an actual LOOKUP
    // call, not the name occurring somewhere as a string.
    //
    // ⚠️ Measured: the first version tested `code.includes('"' + n + '"')`, so
    // renaming `chain.port("mind")` to `chain.port("mindX")` still passed — the
    // name `"mind"` occurred in an unrelated tuple. That is the third time a
    // substring test on a NAME proved too weak here (the shell check passed on
    // `helix-mind`; the port check passed on a port inside a comment). Names are
    // not evidence; the lookup is.
    const asked = new Set([...code.matchAll(/chain\.(?:port|declared_value)\(\s*"([A-Za-z0-9_-]+)"/g)]
      .map((m) => m[1]));
    const unasked = named.filter((n) => !asked.has(n));
    check(`${rel}: asks the declaration for every declared component`,
      unasked.length === 0, unasked.join(', ') || 'all ' + named.length + ' looked up');
  }
}

/* ── 2a. the DERIVATION, asserted on its RESULT (ADR-0047 D3/D6) ───────────
 * Re-judged criteria need a mutation proof, and these two were re-judged: they
 * used to assert that a launcher mentions `chain-env`, which is an EXISTENCE
 * assertion — "did it call the thing", not "is the thing right". Measured
 * 2026-09-24: breaking the derivation two ways (dropping an endpoint, and failing
 * outright) left the suite GREEN. So the assertions now point at the result:
 * the derivation must RUN, and it must EMIT every declared env. */
const CHAIN_ENV = path.join(__dirname, 'chain-env');
function emitSh() {
  try { return execFileSync(CHAIN_ENV, ['--emit-sh'], { encoding: 'utf8' }); }
  catch (e) { return null; }
}
const emitted = emitSh();
check('the derivation runs (chain-env --emit-sh)', emitted !== null,
  emitted === null ? 'it failed — every consumer is now wired to nothing' : 'ok');
{
  const missing = [];
  for (const c of comps) {
    if (c.anaphase_env && (emitted || '').indexOf('export ' + c.anaphase_env + '=') === -1) {
      missing.push(c.anaphase_env);
    }
    for (const k of Object.keys(c.start_env || {})) {
      if ((emitted || '').indexOf('export ' + k + '=') === -1) { missing.push(k); }
    }
  }
  check('the derivation EMITS every declared env (not merely called)',
    emitted !== null && missing.length === 0,
    missing.length ? 'not emitted: ' + missing.join(', ') : 'all ' + comps.length + ' component(s) covered');
}
try {
  execFileSync(CHAIN_ENV, ['--check'], { encoding: 'utf8' });
  check('the committed manifest is current', true, 'regenerated == committed');
} catch (e) {
  check('the committed manifest is current', false,
    String((e.stdout || e.message || '')).trim().split('\n').pop());
}

/* ── 2b. the CONSUMERS carry no endpoint/port literal (ADR-0047 D5/D6) ──────
 * "There is only one derivation" is a promise; "these files contain zero declared
 * ports in executable lines" is an invariant. Cheap, and it turns a spoken rule
 * into a mechanism. */
for (const rel of ['start-panel.sh', 'e2e_chain.sh']) {
  const p = path.join(__dirname, rel);
  if (!fs.existsSync(p)) { check(`consumer exists: ${rel}`, false); continue; }
  const code = fs.readFileSync(p, 'utf8').split('\n')
    .filter((l) => !l.trim().startsWith('#')).join('\n');
  const restated = comps
    .filter((c) => new RegExp('(?<![0-9.])' + c.port + '(?![0-9])').test(code))
    .map((c) => c.name + ':' + c.port);
  check(`consumer ${rel}: zero declared ports in executable lines`,
    restated.length === 0, restated.join(', ') || 'all ' + comps.length + ' derived');
}

/* ── 3. non-vacuity: the same checks must report a restated fact ───────────
 * A scanner that stopped matching would otherwise report a clean tree forever
 * (RNA rule 9: synthetic bad input must be reported, good input must not).  */
const scanRestated = (text, c) =>
  new RegExp('(?<![0-9.])' + c.port + '(?![0-9])').test(
    text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'));
const canary = { name: 'tuck', port: 60052 };
check('the port scanner reports a restated port (synthetic bad input)',
  scanRestated('wait_port 60052 tuck 15', canary) === true);
check('the port scanner passes a derived port (synthetic good input)',
  scanRestated('wait_port "$PORT_TUCK" tuck 15', canary) === false);
check('the port scanner ignores a port in a comment',
  scanRestated('#   tuck      :60052   audit gateway', canary) === false);

console.log('');
console.log(fail === 0 ? 'OK — ' + pass + ' checks green (' + CONVERTED.length + ' launcher(s) converted)'
  : 'FAILED — ' + fail + ' of ' + (pass + fail) + ' checks red');
process.exit(fail === 0 ? 0 : 1);
