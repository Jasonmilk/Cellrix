#!/usr/bin/env node
/* THE POINTER LIVES IN THE SERVER; THE BROWSER ONLY CACHES IT (ADR-0048 §310).
 *
 * Git keeps refs in the repository, not in the window that happens to be open. This suite pins the
 * difference between "the pointer exists" and "this browser remembers it":
 *   · the endpoint round-trips (PUT / GET / DELETE) and refuses a dangling target BY NAME;
 *   · a browser with EMPTY localStorage recovers the pointer FROM THE SERVER — which is the check that a
 *     localStorage-only client cannot pass;
 *   · clearing it on the server clears it for every reader.
 *
 * Usage: node refs_round_trip_test.js [panel_base_url]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REQUIRES = 'panel-http';
const { JSDOM, VirtualConsole } = require('jsdom');

const MIN_ONE_REF = 1;             /* declared threshold (ADR-0022 §2.5): a round-trip proves at least one */
const BOOT_SETTLE_MS = 6000;       /* the boot read is asynchronous; measured well under this on the live panel */

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

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
if (!base) { console.log('NEEDS-INPUT: no panel address declared (chain.json components[panel])'); process.exit(3); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let period = '';
  try {
    const r = await fetch(base + '/api/sessions?limit=5', { signal: AbortSignal.timeout(8000) });
    if (!r.ok) { console.log('NEEDS-INPUT: panel answered ' + r.status); process.exit(3); }
    period = (((await r.json()).periods || [])[0] || {}).period_id || '';
  } catch (e) { console.log('NEEDS-INPUT: panel unreachable at ' + base); process.exit(3); }
  if (!period) { console.log('NEEDS-INPUT: the panel has no period to point at'); process.exit(3); }

  const call = async (path_, init) => {
    try {
      const r = await fetch(base + path_, Object.assign({ signal: AbortSignal.timeout(8000) }, init || {}));
      return await r.json();
    } catch (e) { return { ok: false, error: String(e && e.message) }; }
  };

  /* ① round-trip through the proxy (PUT / GET / DELETE). */
  const put = await call('/api/refs/current', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ period_id: period }) });
  ok('PUT /api/refs/current stores the pointer and REPORTS the resolved period', put.ok === true && put.period_id === period, JSON.stringify(put).slice(0, 80));
  const list = await call('/api/refs');
  ok('GET /api/refs lists it (the pointer is discoverable, not hidden)',
    list.ok === true && (list.refs || []).filter((x) => x.name === 'current' && x.period_id === period).length >= MIN_ONE_REF,
    JSON.stringify(list).slice(0, 90));
  const bad = await call('/api/refs/dangling', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ period_id: 'run-0000000000000000-p0000000000000000' }) });
  ok('a DANGLING target is refused BY NAME (never stored silently)',
    bad.ok === false && /dangling/.test(String(bad.error || '')), String(bad.error || '').slice(0, 70));

  /* ② a browser with EMPTY localStorage must recover the pointer from the SERVER. */
  const html = await (await fetch(base + '/')).text();
  const dom = new JSDOM(html, {
    url: base, runScripts: 'dangerously', resources: 'usable', virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.fetch = (u, o) => fetch(new URL(u, base).href, o);
      try { w.localStorage.clear(); } catch (e) { /* jsdom starts empty anyway */ }
    }
  });
  const w = dom.window;
  const readRef = () => (w.Cx && w.Cx.state && w.Cx.state.ref && w.Cx.state.ref.current) || null;
  let waited = 0, got = null;
  while (waited < BOOT_SETTLE_MS) { await sleep(300); waited += 300; got = readRef(); if (got) { break; } }
  ok('a browser with EMPTY localStorage recovers the pointer FROM THE SERVER',
    got === period, 'ref=' + String(got).slice(-12) + ' after ' + waited + 'ms  (localStorage-only would show null)');
  ok('MUTATION: the client really asks the server at boot (source contract, §310)',
    /fetch\('\/api\/refs'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'assets', 'script.html'), 'utf8')));

  /* ②b M1d — A REF PER CONVERSATION: after a period is chosen, the conversation's OWN ref must exist and
   * point at it, and the listing must carry both names. With a single fixed name the conversation set is
   * unaddressable — this is the check that says so. */
  const cid = (await call('/api/sessions?limit=5')).periods[0].conversation_id || '';
  if (cid) {
    const branch = await call('/api/refs/conversations/' + encodeURIComponent(cid), {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ period_id: period })
    });
    ok('M1d: a NAMED ref per conversation is writable and reported', branch.ok === true, JSON.stringify(branch).slice(0, 70));
    const listing = await call('/api/refs');
    ok('M1d: the listing carries BOTH the HEAD (`current`) and the conversation ref',
      (listing.refs || []).filter((x) => x.name === 'current').length === 1
        && (listing.refs || []).filter((x) => x.name === 'conversations/' + cid).length === 1,
      (listing.refs || []).map((x) => x.name).join(',').slice(0, 90));
    const nested = await call('/api/refs/conversations/..%2Fescape', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ period_id: period }) });
    ok('M1d: nesting is allowed and TRAVERSAL is still refused',
      nested.ok === false && /segment/.test(String(nested.error || '')), String(nested.error || '').slice(0, 60));
  } else {
    console.log('  UNVERIFIED TODAY: no conversation_id in the payload — the named-ref half cannot be judged');
  }

  /* ②c M1e — THE CACHE MUST DECLARE ITSELF: with the refs endpoint unreachable the client falls back to
   * localStorage, and it must SAY SO (`source === 'cache'`) rather than pass a possibly-stale pointer off
   * as current. */
  const domOffline = new JSDOM(await (await fetch(base + '/')).text(), {
    url: base, runScripts: 'dangerously', resources: 'usable', virtualConsole: new VirtualConsole(),
    beforeParse(x) {
      x.fetch = (u, o) => {
        const s2 = String(u);
        if (/\/api\/refs/.test(s2)) { return Promise.reject(new Error('offline (test)')); }
        return fetch(new URL(u, base).href, o);
      };
      try { x.localStorage.setItem('cx.ref', 'run-from-cache'); } catch (e) { }
    }
  });
  let w3 = 0, src3 = null, val3 = null;
  while (w3 < BOOT_SETTLE_MS) {
    await sleep(300); w3 += 300;
    const st = domOffline.window.Cx && domOffline.window.Cx.state && domOffline.window.Cx.state.ref;
    src3 = st && st.source; val3 = st && st.current;
    if (src3) { break; }
  }
  ok('M1e: an unreachable server leaves the client on the CACHE, and it DECLARES that',
    src3 === 'cache' && val3 === 'run-from-cache', 'source=' + String(src3) + ' value=' + String(val3));
  ok('M1e MUTATION: a client that claimed "server" while offline would fail this check',
    src3 !== 'server', 'the declaration is falsifiable');

  /* ③ clearing on the server clears it for every reader. */
  const del = await call('/api/refs/current', { method: 'DELETE' });
  ok('DELETE /api/refs/current removes it (a named absence afterwards)',
    del.ok === true && del.removed === true, JSON.stringify(del));
  const after = await call('/api/refs');
  ok('and the listing no longer carries it', (after.refs || []).filter((x) => x.name === 'current').length === 0);
  const dom2 = new JSDOM(await (await fetch(base + '/')).text(), {
    url: base, runScripts: 'dangerously', resources: 'usable', virtualConsole: new VirtualConsole(),
    beforeParse(x) { x.fetch = (u, o) => fetch(new URL(u, base).href, o); try { x.localStorage.clear(); } catch (e) { } }
  });
  let w2 = 0, got2 = 'pending';
  while (w2 < BOOT_SETTLE_MS) { await sleep(300); w2 += 300; got2 = (dom2.window.Cx && dom2.window.Cx.state && dom2.window.Cx.state.ref && dom2.window.Cx.state.ref.current) || null; if (got2 === null && w2 > 1200) { break; } }
  ok('a fresh browser sees NO pointer once the server has none', got2 === null, 'ref=' + String(got2));

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(4); });
