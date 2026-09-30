#!/usr/bin/env node
/* THE NEWEST-FIRST DEPENDENCY IS DECLARED HERE (ADR-0048 §272).
 *
 * Cellrix's default window start is `periods[0].period_id` — which is only "the latest round" if the
 * panel's source lists periods NEWEST FIRST. Anaphase owns that order (it has two criteria for it:
 * `lists_periods_newest_first`); Cellrix had ZERO. A cross-repo dependency with a criterion on one side
 * only is undeclared: if the reader ever flips the order, the panel silently starts opening the OLDEST
 * conversation, and nothing goes red.
 *
 * This suite is the Cellrix half of that contract. It needs a reachable panel; when the panel is absent
 * it declares NEEDS-INPUT (held), never a red.
 *
 * Usage: node newest_first_contract_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REQUIRES = 'panel-http';

const ROOT = path.join(__dirname, '..', '..', '..');
let base = process.env.CELLRIX_PANEL || null;
if (!base) {
  for (const c of [path.join(ROOT, 'chain.json'),
                   path.join(ROOT, 'anaphase-helix', 'ecosystem', 'chain.json')]) {
    try {
      const d = JSON.parse(fs.readFileSync(c, 'utf8'));
      const comp = (d.components || []).filter((x) => x && x.name === 'panel')[0];
      if (comp && comp.port) { base = 'http://127.0.0.1:' + comp.port; break; }
    } catch (e) { /* next */ }
  }
}
if (!base) { console.log('NEEDS-INPUT: no panel address declared (chain.json components[panel])'); process.exit(3); }

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } }

(async () => {
  let ps = [];
  try {
    const r = await fetch(base + '/api/sessions?limit=50', { signal: AbortSignal.timeout(6000) });
    if (!r.ok) { console.log('NEEDS-INPUT: panel answered ' + r.status); process.exit(3); }
    ps = (await r.json()).periods || [];
  } catch (e) { console.log('NEEDS-INPUT: panel unreachable at ' + base); process.exit(3); }

  if (ps.length < 2) { console.log('NEEDS-INPUT: fewer than two periods — order cannot be judged'); process.exit(3); }
  const ts = ps.map((p) => String(p.first_ts || ''));
  const newestFirst = ts.every((t, i) => i === 0 || ts[i - 1] >= t);
  ok('the panel lists periods NEWEST FIRST (the order the panel start depends on)  [' + ts[0] + ' … ' + ts[ts.length - 1] + ']', newestFirst);
  ok('so `periods[0]` IS the latest round (what the loader calls the default start)',
    ps[0].first_ts === ts.slice().sort().reverse()[0]);
  /* A REAL MUTATION (§277): feed a FLIPPED array to the same predicate and require it to fail. The
   * previous version asserted `newestFirst === true` — the same boolean as assertion 1, i.e. no
   * mutation at all (nominal/actual 1.50x, mutation contributes 0.0000 bits). */
  const newestOf = (arr) => arr.every((t, i) => i === 0 || arr[i - 1] >= t);
  const flipped = ts.slice().reverse();
  ok('MUTATION: the SAME predicate returns false on a flipped (oldest-first) list  [' + newestOf(flipped) + ']',
    newestOf(flipped) === false);
  /* TIES MUST BE NAMED (§277): `>=` accepts equal stamps, so k periods sharing the newest timestamp make
   * `periods[0]` an undeclared pick (Anaphase names ambiguity; the panel must not break that rule). */
  const tie = ts.filter((t) => t === ts[0]).length;
  ok('the newest timestamp is UNIQUE (else the pick needs the name `ambiguous-latest`)  [k=' + tie + ']', tie === 1);

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
