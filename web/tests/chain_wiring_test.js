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
const path = require('path');

const WS = path.join(__dirname, '..', '..', '..');
const DECL = path.join(WS, 'anaphase-helix', 'ecosystem', 'chain.json');
const CONVERTED = ['start-panel.sh'];

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
for (const rel of CONVERTED) {
  const p = path.join(__dirname, rel);
  if (!fs.existsSync(p)) { check(`a launcher at ${rel}`, false); continue; }
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  // Comments may narrate ports; only executable lines are the launcher's claims.
  const code = lines.filter((l) => !l.trim().startsWith('#')).join('\n');

  check(`${rel}: reads the declaration`, code.includes('chain.json'), rel);

  // (a) it must not restate a declared port
  const restated = comps
    .filter((c) => new RegExp('(?<![0-9.])' + c.port + '(?![0-9])').test(code))
    .map((c) => c.name + ':' + c.port);
  check(`${rel}: no declared port is restated in executable code`,
    restated.length === 0, restated.join(', ') || 'all ' + comps.length + ' ports derived');

  // (b) it must SUPPLY every declared endpoint env — by deriving them from the
  // declaration, not by restating their names. A literal-name check would fail a
  // launcher that is *more* single-sourced than one that passes; the property is
  // "consumes the field", so that is what is asserted.
  const derived = comps.filter((c) => c.anaphase_env).length;
  check(`${rel}: derives the endpoint env from the declaration (not restated)`,
    derived === 0 || (code.includes('anaphase_env') && /export\s/.test(code)),
    derived + ' declared env(s), field referenced: ' + code.includes('anaphase_env'));

  // (c) it must START every declared component and be able to STOP it.
  //
  // ⚠️ Measured: the first version of this check searched for the bare name and
  // passed on `helix-mind` — so renaming `spawn mind` to `spawn mindX` went
  // undetected. A substring that happens to occur elsewhere is not evidence that
  // the component is started. Parse the actual `spawn <name>` invocations.
  const spawned = new Set([...code.matchAll(/\bspawn\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  const notStarted = named.filter((n) => !spawned.has(n));
  check(`${rel}: spawns every declared component`, notStarted.length === 0,
    notStarted.join(', ') || [...spawned].sort().join(' '));

  // A component missing from SERVICES is not stopped by --stop (it leaks).
  const svcLine = (code.match(/^\s*SERVICES="([^"]*)"/m) || [, ''])[1].split(/\s+/);
  const notStoppable = named.filter((n) => !svcLine.includes(n));
  check(`${rel}: every declared component is in SERVICES (so --stop covers it)`,
    notStoppable.length === 0, notStoppable.join(', ') || svcLine.filter(Boolean).join(' '));
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
