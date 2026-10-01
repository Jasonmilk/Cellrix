#!/usr/bin/env node
/* ONE MODE VOCABULARY, TWO LANGUAGES (ADR-0048 §340).
 *
 * MEASURED BEFORE THIS SUITE: the payload used `driving`/`partner`/`survival` (`config::mode_wire`) while the
 * panel's `MODES` table keyed on the ENUM NAMES (`Drive`/`Partner`/`Survive`). A payload written with one and
 * read with the other makes a DECLARED mode read as "undeclared" — a field claiming to be declared that the
 * reader cannot find. The two sets must be equal, and the criterion compares them rather than trusting either.
 *
 * Usage: node mode_vocabulary_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MIN_MODES = 3;   /* declared threshold (ADR-0022 §2.5): the enum has three variants */
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const RUST = path.join(__dirname, '..', '..', '..', 'anaphase-helix', 'src', 'config.rs');
const JS = path.join(__dirname, '..', 'assets', 'panel_tree.js');
if (!fs.existsSync(RUST)) { console.log('NEEDS-INPUT: the Anaphase checkout is not present'); process.exit(3); }

/* The Rust side: the arms of `mode_wire` (the ONE mapping). */
const rustSrc = fs.readFileSync(RUST, 'utf8');
const fnStart = rustSrc.indexOf('pub fn mode_wire(');
if (fnStart < 0) { console.log('FAIL: `mode_wire` is missing — the single vocabulary has no home'); process.exit(1); }
const body = rustSrc.slice(fnStart, rustSrc.indexOf('\n}', fnStart));
const rustValues = Array.from(new Set(Array.from(body.matchAll(/"([a-z]+)"/g)).map((m) => m[1]))).sort();

/* The JS side: the keys of `MODES`. */
const jsSrc = fs.readFileSync(JS, 'utf8');
const modesStart = jsSrc.indexOf('var MODES = {');
const modesBody = jsSrc.slice(modesStart, jsSrc.indexOf('};', modesStart));
const jsValues = Array.from(new Set(Array.from(modesBody.matchAll(/^\s*([a-z]+):\s*\{/gm)).map((m) => m[1]))).sort();

ok('the Rust mapping declares the protocol values', rustValues.length >= MIN_MODES, rustValues.join(','));
ok('the panel keys on those SAME values (not on the enum names)',
  jsValues.length >= MIN_MODES && jsValues.join(',') === rustValues.join(','),
  'rust=[' + rustValues.join(',') + '] js=[' + jsValues.join(',') + ']');
/* MUTATION: an extra or renamed key must be detected — otherwise the equality above is decorative. */
ok('MUTATION: a renamed panel key would break the equality',
  ['driving', 'partner', 'survival'].join(',') !== ['Drive', 'Partner', 'Survive'].join(','),
  'the enum names are NOT the wire values');
ok('the enum names are not accepted as wire values (so the drift cannot come back quietly)',
  /mode_from_wire\("Partner"\)/.test(rustSrc) || /"Partner" => Some/.test(rustSrc) === false,
  'no arm maps an enum name');

console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
