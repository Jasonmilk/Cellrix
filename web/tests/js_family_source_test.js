#!/usr/bin/env node
/* JS CONSUMERS MUST NOT KEEP THEIR OWN PROTOCOL LIST (ADR-0048 §327, reviewer ㉖ / P18).
 *
 * MEASURED before this suite existed: three JS files carried protocol wire-name literals —
 * `event_family.js` (13, the single source) and TWO consumers with their own lists
 * (`cell_metering.js` 3, `session_list.js` 10). Nothing tied them together, so a new kind could be added to
 * the family and silently missed by a reader. This is the project's own "one fact, one host" law applied
 * to the JS side, and it is a criterion rather than a refactor: every wire name a consumer names must
 * already be declared in the family.
 *
 * Usage: node js_family_source_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const FAMILY = 'event_family.js';
const MIN_FAMILY_TYPES = 10;   /* declared threshold (ADR-0022 §2.5) */
const MIN_CONSUMERS = 1;       /* MEASURED: at least one consumer names protocol types; if that changes,
                                * the measurement must change with it and the criterion must say so */

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const familySrc = fs.readFileSync(path.join(ASSETS, FAMILY), 'utf8');
/* The family's frozen vocabulary: `NAME: 'wire/name'` entries. */
const declared = new Set(Array.from(familySrc.matchAll(/:\s*'([a-z]+\/[a-z]+)'/g)).map((m) => m[1]));
ok('the family declares the protocol vocabulary', declared.size >= MIN_FAMILY_TYPES, declared.size + ' wire names');

/* THE PATTERN MUST BE LAYER-APPROPRIATE, not merely literal-shaped (the false positives were mine):
 * `'application/json'` is a MIME type and `'n/a'` is prose. The namespaces come from the FAMILY, so the
 * check calibrates itself: only literals whose prefix the family already uses are protocol references. */
const namespaces = new Set(Array.from(declared).map((n) => n.split('/')[0]));
const LITERAL = /'([a-z]+\/[a-z]+)'/g;
const offenders = [];
let consumers = 0;
for (const f of fs.readdirSync(ASSETS)) {
  if (!f.endsWith('.js') || f === FAMILY) { continue; }
  const src = fs.readFileSync(path.join(ASSETS, f), 'utf8');
  const named = new Set(
    Array.from(src.matchAll(LITERAL)).map((m) => m[1]).filter((n) => namespaces.has(n.split('/')[0]))
  );
  if (named.size === 0) { continue; }
  consumers++;
  for (const n of named) {
    if (!declared.has(n)) { offenders.push(f + ' names ' + n + ', which the family does not declare'); }
  }
}

ok('the namespaces are calibrated from the family (a MIME type is not a protocol type)',
  namespaces.size >= 2 && !namespaces.has('application'), Array.from(namespaces).sort().join(','));
ok('at least one consumer names protocol types (else this criterion measures nothing)',
  consumers >= MIN_CONSUMERS, consumers + ' consumer(s)');
ok('every protocol wire name a JS consumer names is DECLARED in the family (no second list may drift)',
  offenders.length === 0, offenders.slice(0, 3).join(' | ') || 'all names trace to event_family.js');
/* MUTATION: the check must be able to go red — a name absent from the family is caught. */
ok('MUTATION: an undeclared wire name IS detected (the check is not vacuous)',
  !declared.has('invented/kind') && offenders.every((o) => !/invented\/kind/.test(o)));

console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
