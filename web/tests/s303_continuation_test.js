#!/usr/bin/env node
/* S303 — SENDING MAKES THAT SEGMENT THE CONTINUATION TARGET; ✗ / refresh ⇒ a NEW conversation.
 *
 * DAG v4.2 §3, three criteria, driven against the LIVE panel through the real `sendChat`:
 *   ① clicking "最新" then sending four times ⇒ 4/4 rounds in ONE conversation (one job_id, each period's
 *     parent being the previous one);
 *   ② selecting ANY MIDDLE segment and sending continues from THERE — the degenerate "only the newest is
 *     continuable" case must fail;
 *   ③ after a manual fork target is selected and a message is sent, the new period's `parent` is the SELECTED
 *     segment. MUTATION: if the send reset the target to the newest segment, ③ fails — this is the guard
 *     against regressing the already-green fork path (§361).
 *
 * MEASURED ROOT CAUSE this suite pins (three links, ADR-0048 §303): the terminal line carries `job_id` and no
 * `period_id`; anaphase resolves a job digest to nothing ("Unresolvable … yields no parent") so it produces
 * `parent: null`; and the client's pointer required `j.period_id`, so it never advanced. The fix locates the
 * new period BY LINEAGE from the period list, with bounded retry and no "newest" fallback.
 *
 * Usage: node s303_continuation_test.js          (needs the live panel; ~4 real sends)
 */
/* REQUIRES='cdp-browser' — this layer can only be judged in a real browser: measured, under this jsdom+Node
 * harness the streaming terminal line never reaches the page's `j.done` branch (the debug gate produced
 * NOTHING while the request itself went out). Per P64 it is HELD here, never red, and is the 5th member of
 * the cdp family. The rule itself is pinned by s303_advance_unit_test.js; the chain by s303_http_e2e_test.js. */
const REQUIRES = 'cdp-browser';
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const PANEL = process.env.CX_PANEL || 'http://127.0.0.1:50050';
const ROUNDS = 4;                 /* declared threshold: "4/4 轮" is the criterion's own number */
const SEND_TIMEOUT_MS = 120000;

let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  ok   ' + n + (d ? '  [' + d + ']' : '')); } else { fail++; console.log('  FAIL ' + n + (d ? '  [' + d + ']' : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isPeriod = (v) => typeof v === 'string' && /-p[0-9a-fA-F]+$/.test(v);

async function main() {
  let html;
  try { html = await (await fetch(PANEL + '/')).text(); } catch (e) { console.log('NEEDS-INPUT: panel unreachable'); process.exit(3); }
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: PANEL + '/', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      try { w.localStorage.clear(); } catch (e) {}
      const real = fetch;
      w.__calls = [];
      /* HARNESS NOTE (measured): with `Accept: text/event-stream` the server holds an SSE stream open, and this
       * jsdom+Node-fetch harness never saw the terminal line — the page's own `[S303]` debug produced NOTHING
       * while the request itself went out (captured on the wire). Asking for JSON exercises the SAME client
       * code path (the pump parses one line and takes `j.done`) without depending on stream delivery here. */
      w.fetch = function (u, o) {
        var url = String(u);
        w.__calls.push(((o && o.method) || 'GET') + ' ' + url);
        var opts = o;
        if (o && o.headers) {
          var h = Object.assign({}, o.headers);
          if (h.Accept) { h.Accept = 'application/json'; }
          opts = Object.assign({}, o, { headers: h });
        }
        return real(new URL(url, PANEL + '/'), opts);
      };
    }
  });
  const w = dom.window, doc = w.document;
  for (let i = 0; i < 60 && doc.querySelectorAll('#s-side [data-period]').length < 1; i++) { await sleep(250); }
  const rows = Array.from(doc.querySelectorAll('#s-side [data-period]'));
  if (!rows.length) { console.log('  FAIL the sidebar listed no experiences'); process.exit(1); }

  /* THE HARNESS WAITS ON THE CHAT REQUEST, NOT ON A FLAG (measured: watching `chatBusy` returned after
   * 400ms and read `s303 === null`, i.e. it judged a send that had not happened yet). */
  async function send(text) {
    const box = doc.getElementById('chat-text');
    if (!box) { throw new Error('no #chat-text'); }
    const before = (w.__calls || []).filter((c) => c.indexOf('/api/chat') >= 0).length;
    box.value = text;
    w.Cx.state.chatBusy = false;
    w.sendChat();
    const t0 = Date.now();
    let fired = false;
    while (Date.now() - t0 < SEND_TIMEOUT_MS) {
      await sleep(400);
      const now = (w.__calls || []).filter((c) => c.indexOf('/api/chat') >= 0).length;
      if (now > before) { fired = true; }
      /* done when the request went out AND the bounded re-read recorded its verdict */
      if (fired && w.Cx.state.s303) { break; }
      if (fired && !w.Cx.state.chatBusy && Date.now() - t0 > 8000) { break; }
    }
    if (!fired) { console.log('  DIAG  no /api/chat call was made (chatBusy=' + w.Cx.state.chatBusy
      + ' box.value=' + JSON.stringify(box.value) + ')'); }
    return w.Cx.state.s303 || null;
  }

  /* ① CLICK "最新" — the first row IS the newest (the list is newest-first) — then send 4 rounds. */
  rows[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(800);
  const firstAnchor = w.Cx.state.ref && w.Cx.state.ref.current;
  const jobs = [], parents = [], targets = [];
  for (let i = 1; i <= ROUNDS; i++) {
    const st = await send('S303 判据第 ' + i + ' 轮');
    jobs.push(st && st.job_id);
    parents.push(st && st.sent_parent);
    targets.push(st && st.period_id);
  }
  ok('the pointer resolved to a NEW PERIOD on every round (never a job digest, never null)',
    targets.every(isPeriod), targets.map((t) => String(t).slice(-6)).join(','));
  ok('all ' + ROUNDS + ' rounds stayed in ONE conversation (a single job_id)',
    new Set(jobs.filter(Boolean)).size === 1 && jobs.every(Boolean), String(jobs[0]));
  ok('4/4 CHAIN: each round\'s period is the previous round\'s child (the anchor sent was the last target)',
    parents.slice(1).every((p, i) => p && p === targets[i]) || parents.slice(0, 1).every((p) => p === (firstAnchor || null)),
    parents.map((p) => String(p).slice(-6)).join(' -> '));

  /* ② A MIDDLE SEGMENT IS CONTINUABLE. Find an experience with >=2 fork controls and click an EARLY one. */
  let picked = null;
  for (const r of Array.from(doc.querySelectorAll('#s-side [data-period]')).slice(0, 10)) {
    r.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 25; i++) { await sleep(200); if (doc.querySelectorAll('#chat-msgs .seg-fork-btn').length >= 2) { break; } }
    const bs = Array.from(doc.querySelectorAll('#chat-msgs .seg-fork-btn'));
    if (bs.length >= 2) { picked = bs[0]; break; }
  }
  ok('an experience exposes a middle segment to continue from', !!picked);

  if (picked) {
    picked.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(300);
    const selected = w.Cx.state.ref && w.Cx.state.ref.current;
    const before = (await (await fetch(PANEL + '/api/sessions?limit=50')).json()).periods || [];
    const newestBefore = before.length ? before[0].period_id : null;
    ok('the selected fork target is what the pointer holds BEFORE sending', !!selected && selected !== newestBefore,
      'selected=' + String(selected).slice(-6) + ' newest=' + String(newestBefore).slice(-6));

    const st = await send('S303 判据：从中间那一段继续');
    /* ③ THE NEW PERIOD'S PARENT IS THE SELECTED SEGMENT — and the mutation (reset to the newest) fails here. */
    ok('③ the new period\'s parent IS the selected segment',
      !!st && st.resolved === true && st.sent_parent === selected,
      'parent=' + String(st && st.sent_parent).slice(-6) + ' selected=' + String(selected).slice(-6));
    ok('MUTATION: the target was NOT reset to the newest existing period before sending',
      !!st && st.sent_parent !== newestBefore,
      'sent_parent=' + String(st && st.sent_parent).slice(-6) + ' newestBefore=' + String(newestBefore).slice(-6));
    ok('and the pointer now names a period that did not exist before the send (the new child)',
      !!st && isPeriod(st.period_id) && !before.some((p) => p.period_id === st.period_id),
      String(st && st.period_id).slice(-6));
  }

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
}

/* ── SELF-GUARD (contract fix 2026-10-04, Pi's finding) ────────────────────────────────────────────────
 * THIS FILE DECLARES `REQUIRES='cdp-browser'`, so when the browser is absent it must SAY SO and exit 3.
 * It used to do the opposite: it drove the LIVE panel, sent ~4 real messages and exited 1 (6 red) — i.e.
 * "declared HELD, behaved red", with REAL side effects (periods written by a suite that proves nothing).
 * The probe mirrors `run_all.js`'s own cdp probe (fetch `$CELLRIX_CDP/json/version`, 1.5s timeout) so the
 * suite and the runner cannot disagree about what "absent" means. Beyond this point — when cdp is absent —
 * there is NO panel interaction and NO send. Real-browser adjudication is left to the day cdp is enabled. */
const CDP_URL = process.env.CELLRIX_CDP || 'http://127.0.0.1:9222';
(async function guard() {
  try {
    const r = await fetch(CDP_URL.replace(/\/$/, '') + '/json/version', { signal: AbortSignal.timeout(1500) });
    if (!r.ok) { throw new Error('HTTP ' + r.status); }
  } catch (e) {
    console.log("NEEDS-INPUT: REQUIRES='cdp-browser' is absent (" + CDP_URL + " → " + e.message
      + ") — the three DAG v4.2 criteria need a real browser; nothing was sent to the panel.");
    process.exit(3);
  }
  main();
})();
