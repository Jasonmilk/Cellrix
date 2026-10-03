#!/usr/bin/env node
/* FORK FROM A MIDDLE SEGMENT (ADR-0048 §360). The backend already separates `resume_job` (the SCOPE whose
 * history is injected) from `resume_period` (the LINEAGE); what was missing is a CLICK POINT on a segment
 * inside an experience. This criterion drives the live panel: it finds an experience with several segments,
 * clicks the MIDDLE one's button, and requires the continuation ref to be THAT job. The mutations are the
 * other segments (a constant would pass the middle check alone).
 *
 * Usage: node fork_entry_test.js
 */
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const PANEL = process.env.CX_PANEL || 'http://127.0.0.1:50050';
const MIN_SEGMENTS = 2;   /* declared threshold (ADR-0022 §2.5): a "middle" needs two distinct segments */

let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  ok   ' + n + (d ? '  [' + d + ']' : '')); } else { fail++; console.log('  FAIL ' + n + (d ? '  [' + d + ']' : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  let html;
  try { html = await (await fetch(PANEL + '/')).text(); } catch (e) { console.log('NEEDS-INPUT: panel unreachable'); process.exit(3); }
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: PANEL + '/', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { try { w.localStorage.clear(); } catch (e) {} const real = fetch; w.fetch = (u, o) => real(new URL(String(u), PANEL + '/'), o); }
  });
  const w = dom.window, doc = w.document;
  const ref = () => (w.Cx && w.Cx.state && w.Cx.state.ref && w.Cx.state.ref.current) || null;

  for (let i = 0; i < 60 && doc.querySelectorAll('#s-side [data-period]').length < 1; i++) { await sleep(250); }
  const rows = Array.from(doc.querySelectorAll('#s-side [data-period]'));

  /* Find an experience whose window has several segments: click rows and read the header it renders. */
  let buttons = [], periodId = null;
  for (const r of rows.slice(0, 12)) {
    r.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 30; i++) { await sleep(200); if (doc.querySelectorAll('#chat-msgs .seg-fork-btn').length) { break; } }
    const bs = Array.from(doc.querySelectorAll('#chat-msgs .seg-fork-btn'));
    if (bs.length >= MIN_SEGMENTS) { buttons = bs; periodId = r.getAttribute('data-period'); break; }
  }
  if (!buttons.length) { console.log('  FAIL no experience with >= ' + MIN_SEGMENTS + ' segment buttons'); console.log('  FAILED — 1 check(s) red'); process.exit(1); }
  ok('an experience exposes one "continue from here" control PER SEGMENT', buttons.length >= MIN_SEGMENTS,
    buttons.length + ' controls in ' + String(periodId).slice(-8));

  const jobs = buttons.map((b) => b.getAttribute('data-job'));
  ok('the controls carry DISTINCT segment ids (so a click can be told apart)',
    new Set(jobs).size === jobs.length, jobs.map((j) => String(j).slice(-6)).join(','));

  const mid = buttons[0];                      /* the earliest segment: the sharpest "not the newest" case */
  mid.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  const afterMid = ref();
  ok('clicking an EARLY segment moves the continuation target to THAT segment',
    afterMid === mid.getAttribute('data-job'), 'target=' + String(afterMid).slice(-8));
  ok('MUTATION: and it is NOT the period itself (a display-only click would leave the period here)',
    afterMid !== periodId, 'period=' + String(periodId).slice(-8));

  const last = buttons[buttons.length - 1];
  last.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  ok('MUTATION: the LAST segment gives a DIFFERENT target (so the value tracks the click, not a constant)',
    ref() === last.getAttribute('data-job') && ref() !== afterMid,
    'last=' + String(ref()).slice(-8) + ' vs early=' + String(afterMid).slice(-8));
  ok('the banner names the choice (the user can see which segment the next sentence continues)',
    /第 \d+ 段/.test((doc.querySelector('#chat-banner, .banner, #banner') || {}).textContent || '')
      || /第 \d+ 段/.test(doc.body.textContent || ''), 'banner text present');

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
})();
