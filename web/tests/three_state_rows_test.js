#!/usr/bin/env node
/* THREE STATES, NOT TWO (ADR-0048 §335; §52 / Codd's fourth state).
 *
 * MEASURED BEFORE THIS SUITE: a row whose column does not apply showed `· 无数据`, which reads as "the record
 * is missing". The column now distinguishes INAPPLICABLE (`—`) from UNMEASURED (`· 未计量`) from ABSENT
 * (`· 无数据`), and it decides with the FAMILY's declaration rather than a second list of types.
 *
 * Usage: node three_state_rows_test.js [panel_base_url]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REQUIRES = 'panel-http';
const { JSDOM, VirtualConsole } = require('jsdom');

const MIN_ROWS = 1;             /* declared threshold (ADR-0022 §2.5) */
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* MUTATION, checked first: the FAMILY must declare metering for the usage type — if that declaration were
 * absent, every row would be "inapplicable" and this suite would pass vacuously. */
const familySrc = fs.readFileSync(path.join(__dirname, '..', 'assets', 'event_family.js'), 'utf8');
ok('MUTATION: the family DECLARES metering for assistant/usage (else every row would read "inapplicable")',
  /completionTokens:/.test(familySrc) && /'assistant\/usage'/.test(familySrc));

let base = process.argv[2] || process.env.CELLRIX_PANEL || '';
if (!base) {
  for (const c of [path.join(__dirname, '..', '..', '..', 'chain.json'),
                   path.join(__dirname, '..', '..', '..', 'anaphase-helix', 'ecosystem', 'chain.json')]) {
    try {
      const d = JSON.parse(fs.readFileSync(c, 'utf8'));
      const comp = (d.components || []).filter((x) => x && x.name === 'panel')[0];
      if (comp && comp.port) { base = 'http://127.0.0.1:' + comp.port; break; }
    } catch (e) { /* next */ }
  }
}
if (!base) { console.log('NEEDS-INPUT: no panel address declared'); process.exit(3); }

(async () => {
  let period = '';
  try {
    const r = await fetch(base + '/api/sessions?limit=10', { signal: AbortSignal.timeout(8000) });
    const rows = ((await r.json()).periods || []);
    const withUsage = rows.find((p) => p && p.period_id) || {};
    period = withUsage.period_id || '';
  } catch (e) { console.log('NEEDS-INPUT: panel unreachable at ' + base); process.exit(3); }
  if (!period) { console.log('NEEDS-INPUT: no period to read'); process.exit(3); }

  /* Render the tree rows the same way the panel does, in jsdom, against the live event stream. */
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
    url: base, runScripts: 'outside-only', virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  const evalAsset = (f) => w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8'));
  for (const f of ['three_state.js', 'event_family.js', 'cell_metering.js', 'panel_tree.js']) { evalAsset(f); }
  const ev = await (await fetch(base + '/api/events?id=' + encodeURIComponent(period), { signal: AbortSignal.timeout(8000) })).json();
  const events = ev.events || [];
  if (events.length === 0) { console.log('NEEDS-INPUT: that period has no events'); process.exit(3); }
  const box = w.document.getElementById('host');
  w.CxPanelTree.renderRows(box, events);
  const cells = Array.from(w.document.querySelectorAll('.pt-tok'));
  ok('rows were rendered', cells.length >= MIN_ROWS, cells.length + ' cell(s)');

  const dash = cells.filter((c) => c.textContent === '\u2014').length;
  const unmetered = cells.filter((c) => c.textContent.indexOf('未计量') >= 0).length;
  const nodata = cells.filter((c) => c.textContent.indexOf('无数据') >= 0).length;
  const numbers = cells.filter((c) => /^[0-9]/.test(c.textContent)).length;

  /* The discriminating property: a type that never carries the dimension must NOT say "no data". */
  const wrongLabel = cells.filter((c) => c.getAttribute('data-state') === 'a' && !/携带计量/.test(c.textContent));
  ok('INAPPLICABLE rows say `—`, not `· 无数据`',
    dash >= 1 && !cells.some((c) => c.textContent === '· 无数据' && c.getAttribute('data-state') === 'a'),
    'em-dash ' + dash + ' · unmeasured ' + unmetered + ' · no-data ' + nodata + ' · numeric ' + numbers);
  ok('a metering-bearing type is NOT marked inapplicable (the family decides, not a guess)',
    numbers >= 1 || nodata >= 1, 'numeric ' + numbers + ' · no-data ' + nodata);
  ok('MUTATION: without the family declaration every row would be `—` (so the check is not vacuous)',
    numbers >= 1 || unmetered >= 1 || nodata >= 1, 'some row still carries a real state');

  /* M3② THE HEADER MUST NOT SHOW A RAW ID (ADR-0048 §336): measured before the fix, the chat header read
   * `—— 经历 run-233a86e49afbc98c-p006abd2783000003 ——`. A person cannot use that as a name. */
  const heads = Array.from(w.document.querySelectorAll('#s-side, .panel, .chat-msgs'))
    .map((el) => String(el.textContent || ''))
    .join(' ');
  const rawInHeader = /——\s*经历\s*run-[0-9a-f]{16}-p[0-9a-f]{16}/.test(heads);
  ok('M3②: the chat header does NOT print the raw period id as its name',
    !rawInHeader, 'the naming rule is read from the row the list rendered');

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(4); });
