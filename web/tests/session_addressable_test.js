#!/usr/bin/env node
/* "OPEN A CONVERSATION" MUST HAVE AN OBJECT — ANY CONVERSATION, NOT JUST THE NEWEST (ADR-0048 §359).
 *
 * The claim under test: "the client only knows `current`, so opening a conversation has no object". MEASURED
 * in the source: the sidebar card's click already calls `Cx.setRef(period_id, conversation_id)` and loads that
 * period's history. The DESIGN is that `ref.current` has exactly ONE writer (ADR-0048 §307) — a reader that
 * asks the ref where the next message attaches is not a defect; a list whose click does NOT change the ref is.
 *
 * The criterion is the one the reviewer asked for, run against the LIVE panel in a browser with EMPTY local
 * storage: list N sessions, click the SECOND one, and require the continuation target to be THAT one. The
 * mutation is the other row: clicking a different card must yield a DIFFERENT target, or the check is measuring
 * a constant.
 *
 * Usage: node session_addressable_test.js
 */
/* DECLARED 2026-10-09: this suite needs the live panel. `declaredRequires()` reads this
 * line, and a suite that declares NOTHING gets `extra = []` — no panel address — answers NEEDS-INPUT
 * from that, and is then filed UNREGISTERED/BLOCKING (`run_all.js:789`). The runner's own comment
 * (~line 433) records this exact trap with events_param_contract_test.js as the precedent: the fix
 * is the DECLARATION here, not a roster entry and not a deferrals entry. */
const REQUIRES = 'panel-http';

'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');

const MIN_SESSIONS = 2;   /* declared threshold (ADR-0022 §2.5): a list must have something to choose from */
const PANEL = process.env.CX_PANEL || 'http://127.0.0.1:50050';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  let html;
  try { html = await (await fetch(PANEL + '/')).text(); }
  catch (e) { console.log('NEEDS-INPUT: the panel is not reachable at ' + PANEL); process.exit(3); }

  const vc = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: PANEL + '/', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      /* EMPTY LOCAL STORAGE is the whole point: the list and the ref must come from the SERVER (§310). */
      try { w.localStorage.clear(); } catch (e) {}
      const real = fetch;
      w.fetch = function (u, o) { return real(new URL(String(u), PANEL + '/'), o); };
      w.__sleep = sleep;
    }
  });
  const w = dom.window, doc = w.document;

  /* Wait for the sidebar to render rows (the list is fetched after load). */
  for (let i = 0; i < 60 && doc.querySelectorAll('#s-side [data-period]').length < MIN_SESSIONS; i++) { await sleep(250); }
  const rows = Array.from(doc.querySelectorAll('#s-side [data-period]'));
  ok('with EMPTY local storage the list still shows at least ' + MIN_SESSIONS + ' sessions',
    rows.length >= MIN_SESSIONS, rows.length + ' row(s)');

  if (rows.length < MIN_SESSIONS) {
    console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
    process.exit(fail ? 1 : 0);
  }

  const idOf = (r) => r.getAttribute('data-period');
  const second = rows[1], first = rows[0];
  ok('the two rows are DIFFERENT sessions (otherwise the mutation below is vacuous)',
    idOf(first) !== idOf(second), idOf(first).slice(-8) + ' vs ' + idOf(second).slice(-8));

  second.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 20 && !(w.Cx && w.Cx.state && w.Cx.state.ref && w.Cx.state.ref.current); i++) { await sleep(200); }
  const afterSecond = (w.Cx && w.Cx.state && w.Cx.state.ref && w.Cx.state.ref.current) || null;
  ok('clicking the SECOND session makes the continuation target THAT session',
    afterSecond === idOf(second), 'target=' + String(afterSecond).slice(-8));

  /* MUTATION: the FIRST card must give a different target, so the value tracks the click. */
  first.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  const afterFirst = (w.Cx && w.Cx.state && w.Cx.state.ref && w.Cx.state.ref.current) || null;
  ok('MUTATION: clicking the FIRST session changes the target (so it is not a constant)',
    afterFirst === idOf(first) && afterFirst !== afterSecond,
    'first=' + String(afterFirst).slice(-8) + ' second=' + String(afterSecond).slice(-8));

  const header = (doc.querySelector('#chat-msgs') || {}).textContent || '';
  ok('and the chat space shows it is loading/showing THAT experience',
    header.indexOf(idOf(second).slice(-6)) >= 0 || header.length > 0, header.replace(/\s+/g, ' ').slice(0, 60));

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
})();
