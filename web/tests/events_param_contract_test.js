#!/usr/bin/env node
/* THE EVENT ENDPOINT'S PARAMETER IS NAMED HONESTLY, AND THE OLD NAME STILL WORKS (§296).
 *
 * Measured before this: `/api/events?id=<period_id>` answered `{"error":"job_id required"}` while
 * `?job_id=<period_id>` returned the events — the name lied and the honest spelling failed. The value
 * is classified by SHAPE (`PeriodRef::parse`: period id first, else job id), so the NAME carries no
 * information. This suite pins the three facts that make the rename safe:
 *   · `id=` works
 *   · `job_id=` still works (the compatibility window — no caller breaks in one step)
 *   · both return the SAME events, and a missing parameter names the accepted names
 *
 * Usage: node events_param_contract_test.js [panel_base_url]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REQUIRES = 'panel-http';

let base = process.argv[2] || process.env.CELLRIX_PANEL || process.env.PANEL || '';
if (!base) {
  for (const c of [path.join(__dirname, '..', '..', 'chain.json'),
                   path.join(__dirname, '..', '..', 'anaphase-helix', 'ecosystem', 'chain.json')]) {
    try {
      const d = JSON.parse(fs.readFileSync(c, 'utf8'));
      const comp = (d.components || []).filter((x) => x && x.name === 'panel')[0];
      if (comp && comp.port) { base = 'http://127.0.0.1:' + comp.port; break; }
    } catch (e) { /* next */ }
  }
}
if (!base) { console.log('NEEDS-INPUT: no panel address declared (chain.json components[panel])'); process.exit(3); }

/* The repos are SIBLINGS under the workspace root: Cellrix/web/tests -> up three levels. */
const SIBLING_MAIN = path.join(__dirname, '..', '..', '..', 'anaphase-helix', 'src', 'main.rs');
if (!fs.existsSync(SIBLING_MAIN)) {
  console.log('NEEDS-INPUT: sibling anaphase checkout not found at ' + SIBLING_MAIN);
  process.exit(3);
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

(async () => {
  let period = '';
  try {
    const r = await fetch(base + '/api/sessions?limit=5', { signal: AbortSignal.timeout(6000) });
    if (!r.ok) { console.log('NEEDS-INPUT: panel answered ' + r.status); process.exit(3); }
    period = (((await r.json()).periods || [])[0] || {}).period_id || '';
  } catch (e) { console.log('NEEDS-INPUT: panel unreachable at ' + base); process.exit(3); }
  if (!period) { console.log('NEEDS-INPUT: the panel has no period to ask for'); process.exit(3); }

  const get = async (q) => {
    try {
      const r = await fetch(base + '/api/events' + q, { signal: AbortSignal.timeout(8000) });
      return await r.json();
    } catch (e) { return { error: String(e && e.message) }; }
  };

  const byId = await get('?id=' + encodeURIComponent(period));
  const byJob = await get('?job_id=' + encodeURIComponent(period));
  const nId = (byId.events || []).length, nJob = (byJob.events || []).length;

  ok('`id=<period_id>` works (the honest name)', nId > 0, 'events=' + nId + ' error=' + (byId.error || '-'));
  ok('`job_id=<period_id>` still works (compatibility window)', nJob > 0, 'events=' + nJob);
  ok('both names return the SAME events (one value, two spellings)', nId === nJob && nId > 0, nId + ' vs ' + nJob);

  const missing = await get('');
  ok('a missing parameter NAMES the accepted spellings (a misspelling must not look like no data)',
    /accepted names: id, job_id, period_id/.test(String(missing.error || '')), String(missing.error || '').slice(0, 70));

  /* MUTATION: dropping the alias would break every existing caller at once. */
  ok('MUTATION: the alias is required by this contract (removing `job_id` makes check 2 fail)',
    /or_else\(\|\| params\.get\("job_id"\)\)/.test(fs.readFileSync(SIBLING_MAIN, 'utf8')));

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(4); });
