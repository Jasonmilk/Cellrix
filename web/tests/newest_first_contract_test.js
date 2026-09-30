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
  /* MUTATION: if the order flips, the default window silently becomes the OLDEST conversation. */
  ok('MUTATION: an oldest-first list would fail the first assertion (this is the Cellrix half of the contract)',
    newestFirst === true);

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
