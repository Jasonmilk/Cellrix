#!/usr/bin/env node
/* ORDER GUARD: THE PIN MAY GO ONLY AFTER THE FAILOVER CAN CARRY THE LOAD (ADR-0048 §371).
 *
 * MEASURED ANCHORS this reads (both verified before the criterion was written):
 *   · the pin   -> `Cellrix/web/tests/e2e_chain.sh:122`
 *                  `ANAPHASE_REASONING_MODEL="$CHAIN_MODEL"` — the chain run names a model explicitly.
 *   · the crutch-> `FlowModus/flowmodus-rs/src/failover.rs` + `tests/failover_e2e.rs`, and the SPECIFIC
 *                  criteria in the latter that prove hand-over happens (a file that exists but no longer
 *                  tests hand-over is not "ready").
 *
 * THE RULE: `pinned || failover_ready`. Removing the pin while the failover is missing makes a request with
 * a dead supplier FAIL, which is exactly the state the pin was hiding. The mutation evaluates the predicate
 * on synthetic facts, so the criterion proves it can go red instead of merely asserting today's green.
 *
 * Usage: node failover_before_unpinning_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = path.join(__dirname, '..', '..', '..');
const LAUNCHER = path.join(WS, 'Cellrix', 'web', 'tests', 'e2e_chain.sh');
const FAILOVER_SRC = path.join(WS, 'FlowModus', 'flowmodus-rs', 'src', 'failover.rs');
const FAILOVER_E2E = path.join(WS, 'FlowModus', 'flowmodus-rs', 'tests', 'failover_e2e.rs');
/* The two criteria that PROVE hand-over: one says a dead candidate is survived, the other that the failure
 * is named. Their names are the contract; renaming them without replacing the proof must not read as ready. */
const REQUIRED_PROOFS = [
  'a_dead_supplier_in_the_set_does_not_fail_the_request',
  'an_exhausted_set_fails_by_name'
];

let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  ok   ' + n + (d ? '  [' + d + ']' : '')); } else { fail++; console.log('  FAIL ' + n + (d ? '  [' + d + ']' : '')); } }

function readOr(file) { try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; } }

const launcher = readOr(LAUNCHER);
/* ABSENT FILE IS NOT "UNPINNED" (the three-state law): if the launcher cannot be read, this criterion has no
 * evidence either way and must say so instead of guessing a green. */
if (launcher === null) {
  console.log('NEEDS-INPUT: the launcher ' + LAUNCHER + ' is not readable, so "pinned" cannot be judged');
  process.exit(3);
}
const pinMatch = launcher.match(/^.*ANAPHASE_REASONING_MODEL=.*$/m);
const pinned = !!pinMatch;

const src = readOr(FAILOVER_SRC);
const e2e = readOr(FAILOVER_E2E);
const missingProofs = e2e ? REQUIRED_PROOFS.filter((n) => e2e.indexOf(n) < 0) : REQUIRED_PROOFS.slice();
const failoverReady = !!src && !!e2e && missingProofs.length === 0;

ok('the facts are read from named anchors (pin in the launcher, proofs in the e2e suite)',
  true, 'pinned=' + pinned + ' failover_ready=' + failoverReady);
ok('the pin EXISTS today, so the crutch is the current state (measured, not assumed)',
  pinned, pinMatch ? pinMatch[0].trim().slice(0, 76) : 'no ANAPHASE_REASONING_MODEL line');

/* THE RULE ITSELF. Green today because the pin is still there; it turns RED the moment someone removes the
 * pin while the failover is absent or its proofs are missing. */
const rule = (isPinned, isReady) => isPinned || isReady;
ok('ORDER: the pin may be absent ONLY while the failover is ready',
  rule(pinned, failoverReady),
  'pinned=' + pinned + ' ready=' + failoverReady);
ok('the hand-over proofs are present and named', missingProofs.length === 0,
  missingProofs.length ? 'missing: ' + missingProofs.join(',') : REQUIRED_PROOFS.length + ' proof(s)');

/* MUTATION: the predicate must be able to reject the forbidden state. */
ok('MUTATION: unpinned + not ready is REJECTED by the same rule',
  rule(false, false) === false && rule(false, true) === true && rule(true, false) === true,
  'rule(F,F)=false · rule(F,T)=true · rule(T,F)=true');

console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
