#!/usr/bin/env node
/* P64 — "RED" MUST BE A PROPERTY OF THE CODE, NOT OF THE MACHINE (ADR-0048 §343/§344).
 *
 * MEASURED BEFORE THIS CRITERION: on a machine without jsdom SIX suites were counted as RED because they
 * `require('jsdom')` while declaring only `panel-http` (whose probe passed). They live on the LEGACY hard
 * list, which ran before the register/probe-cache initialisers — so the fix had to be an ORDERING fix.
 *
 * The criterion therefore cannot simply "run the gate": on CI jsdom is ALWAYS present, so a criterion that
 * just asserts "not red" would never execute the bad environment at all. It spawns its own child with
 * `NODE_PATH` REMOVED, and the mutation spawns the same child WITH it: the two runs must DIFFER, or the
 * criterion is measuring nothing.
 *
 * Usage: node p64_env_class_test.js
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MIN_HELD = 3;      /* declared threshold (ADR-0022 §2.5): jsdom users held when jsdom is absent */
const RUNNER = path.join(__dirname, 'run_all.js');
const PROBE = ['chain_window_test.js', 'wayout_test.js', 'three_state_rows_test.js',
               'refs_round_trip_test.js', 'conversation_identity_test.js'];

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

function runGate(scrubJsdom) {
  const env = Object.assign({}, process.env, { CX_NO_SPAWN: '1' });
  if (scrubJsdom) { delete env.NODE_PATH; }
  try {
    return execFileSync(process.execPath, [RUNNER], { encoding: 'utf8', env, timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    /* A non-zero exit is expected (the two known reds); the OUTPUT is what we judge. */
    return (e.stdout || '') + (e.stderr || '');
  }
}

if (process.env.CX_NO_SPAWN) {
  console.log('NEEDS-INPUT: refusing to spawn a nested gate (CX_NO_SPAWN is set)');
  process.exit(3);
}

const bad = runGate(true);
const good = runGate(false);

/* ① The bad environment NAMES the absent capability instead of failing the suites. */
const heldJsdom = (bad.match(/\[requires\] jsdom absent/g) || []).length;
ok('without jsdom the affected suites are HELD BY NAME, not failed',
  heldJsdom >= MIN_HELD, heldJsdom + ' suite(s) held for the absent capability');
const failedInBad = PROBE.filter((f) => new RegExp('^\\s*FAIL\\s+' + f, 'm').test(bad));
ok('and NONE of the formerly-red jsdom users appears in the bad run\'s red roster',
  failedInBad.length === 0, failedInBad.join(',') || 'none of ' + PROBE.length);

/* ② THE MUTATION: with jsdom present they must RUN — so the two runs DIFFER and the check is not vacuous. */
const heldInGood = (good.match(/\[requires\] jsdom absent/g) || []).length;
ok('MUTATION: with jsdom present those same suites are NOT held for it (the two runs differ)',
  heldInGood === 0, 'good run held ' + heldInGood + ' for jsdom');

/* ③ The verdict line still exists in both runs (a crash is not a verdict — the failure mode this fix had). */
ok('both runs still produce a verdict (a crash would be no verdict at all)',
  /FAILED —|OK —|NOT FULLY PROVEN|BLOCKED —/.test(bad)
    && /FAILED —|OK —|NOT FULLY PROVEN|BLOCKED —/.test(good),
  'bad=' + (/FAILED —|OK —|NOT FULLY PROVEN|BLOCKED —/.exec(bad) || ['(none)'])[0]
    + ' good=' + (/FAILED —|OK —|NOT FULLY PROVEN|BLOCKED —/.exec(good) || ['(none)'])[0]);

console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
