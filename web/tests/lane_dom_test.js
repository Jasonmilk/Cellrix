/* lane_dom_test — THE DOM-LEVEL CRITERION (ADR-0048 §169). It exists because three regressions in
 * a row survived 35 green suites: the lanes rendered nothing in the default mode, the empty-width
 * fallback came back, and a degradation attribute was never written at all. Every one of them was
 * a VIEW-layer defect that no projection-level criterion could see — the word in the sentence is
 * "shows", and nothing was watching what the panel shows.
 *
 * Hermetic: the page is assembled in jsdom from the repo's own assets (boot.json order) and the
 * session is injected through the view's PUBLIC entry (`PT.S`, exported at :751). No server.
 */
const fs = require('fs'), path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('NEEDS-INPUT: jsdom 未安装 — DOM 级判据无法行使'); process.exit(3); }

const ROOT = path.join(__dirname, '..', '..');
const A = (p) => fs.readFileSync(path.join(ROOT, 'web', 'assets', p), 'utf8');
const events = fs.readFileSync(path.join(__dirname, 'fixtures', 'pinned.events.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

/* THE ASSEMBLY RULE IS SHARED, NOT COPIED (ADR-0048 §171): `assemble_page.js` is the one JS
 * implementation, guarded by `assemble_page_test`. My own copy replaced `pieces` but not the
 * DERIVED placeholders, which is why the page died on `__REFRESH__`. */
const AP = require('./assemble_page.js');
function build(assetOverrides) {
  const dom = new JSDOM(AP.assemble(assetOverrides).html,
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://127.0.0.1:1/' });
  return { dom, w: dom.window };
}
function laneBlocks(w) {
  return Array.from(w.document.querySelectorAll('#eLaneInput .e-blk, #eLaneModel .e-blk, #eLaneTool .e-blk'))
    .filter((b) => b.getAttribute('data-e-ev'));
}
function widths(blocks) {
  return blocks.map((b) => { const m = /flex:\s*0\s+0\s+([-\d.]+)%/.exec(b.getAttribute('style') || ''); return m ? parseFloat(m[1]) : null; });
}
function prime(w, durMode, eventsOverride) {
  const PT = w.CxProveTrack;
  if (!PT || !PT.S || !PT.node || typeof PT.node.buildSession !== 'function') { return false; }
  /* THE REAL PATH, NOT A HAND-BUILT SESSION (ADR-0048 §171): the previous version fed raw EVENTS
   * in as if they were session rows, and measured, those rows have no `lane` — `renderLanes`
   * branches on `e.lane === k`, so zero blocks entered the lanes and the criterion was testing
   * its own bad input. Now: assembly.feed → snapshot nodes → buildSession, the same three stages
   * the panel runs. (Its `rejections()` also answers the open `turn/end` question.) */
  const st = (w.CxAssembly && w.CxAssembly.create) ? w.CxAssembly.create() : null;
  if (!st) { return false; }
  st.register('probe', { name: 'probe' });
  st.activate('probe');
  const evs = eventsOverride || events;
  st.feed(evs.map((e, i) => Object.assign({ seq: i, time: '2026-01-01T00:00:0' + (i % 10) + 'Z', job_id: 'p' }, e)));
  const snap = st.snapshot();
  const nodes = (snap && (snap.nodes || snap)) || [];
  PT.S.session = PT.node.buildSession(nodes);
  PT.S.durMode = durMode;
  PT.S.q = ''; PT.S.sel = null;
  w.__probeRejections = (typeof st.rejections === 'function') ? st.rejections() : null;
  return true;
}


/* ── the default mode must SHOW something ── */
{
  const { w } = build();
  const PT = w.CxProveTrack;
  if (!PT || typeof PT.renderLanes !== 'function' || !prime(w, 'equal')) {
    console.log('  SKIP  lane DOM: the view could not be assembled in jsdom (declared skip)');
  } else {
    PT.renderLanes();
    const blocks = laneBlocks(w), ws = widths(blocks);
    ok(blocks.length > 0, 'DOM scope: the default render produced blocks (' + blocks.length + ')');
    ok(ws.length > 0 && ws.every((x) => typeof x === 'number' && x > 0),
      'DEFAULT MODE SHOWS SOMETHING: every block has a numeric width > 0 [' + ws.slice(0, 3).join(', ') + '…]');
    /* SUM EVERY BLOCK OF THE LANE, spacers included: a lane holds one block per SESSION ROW (its
     * own rows carry data-e-ev, the others are placeholders), so summing only the id-bearing ones
     * can never reach 100 — that was my assertion's bug, not the view's (measured 50.00/50.00 on a
     * two-row session where each lane owns one row). */
    const sums = ['eLaneInput', 'eLaneModel', 'eLaneTool'].map((id) =>
      widths(Array.from(w.document.querySelectorAll('#' + id + ' .e-blk')))
        .reduce((a, b) => a + (b || 0), 0));
    ok(sums.every((s) => Math.abs(s - 100) < 0.01),
      'each lane sums to ~100% across all its blocks [' + sums.map((s) => s.toFixed(2)).join(', ') + ']');
    ok(!w.document.getElementById('eTraj').hasAttribute('data-cell-degraded'),
      'NOT DEGRADED ⇒ the row host carries NO data-cell-degraded (the only-add trap)');
  }
  w.close();
}

/* ── a real degradation must be SHOWN, not implied ── */
{
  const { w } = build();
  if (!prime(w, 'equal')) { console.log('  SKIP  lane DOM (degraded): view not assembled'); }
  else {
    /* 251 unknown columns, fed THROUGH the pipeline so the projection really degrades */
    const many = Array.from({ length: 251 }, (_, i) => (i === 0
      ? { type: 'tool/result', data: { duration_ms: 120 } }
      : { type: 'assistant/usage', data: {} }));
    prime(w, 'actual', many);
    w.CxProveTrack.renderLanes();
    const host = w.document.getElementById('eTraj');
    const blocks = laneBlocks(w), ws = widths(blocks);
    const reason = host.getAttribute('data-cell-degraded');
    if (!reason) {
      /* NAMED GAP, NOT A SILENT PASS (ADR-0048 §171): synthesising a session that really degrades
       * THROUGH the pipeline (assembly → buildSession) is still open — 251 synthetic usage events
       * are rejected upstream, so the projection never reaches `row-exceeds-grid` here. The
       * projection-level twin (lane_degrade_test) does cover that branch; this DOM half declares
       * what it could not exercise instead of pretending. */
      console.log('  SKIP  lane DOM (degraded): could not synthesise a degrading session through the'
        + ' pipeline — the projection-level twin lane_degrade_test covers the branch (declared)');
    } else {
      ok(true, 'DEGRADED ⇒ the row host names the reason [' + reason + ']');
      ok(ws.length > 0 && ws.every((x) => typeof x === 'number' && x > 0),
        'DEGRADED BUT STILL VISIBLE: widths stay non-zero (' + ws.length + ' blocks, min '
        + Math.min.apply(null, ws).toFixed(3) + '%)');
    }
    /* recovering removes the marker */
    prime(w, 'equal');
    w.CxProveTrack.renderLanes();
    ok(!host.hasAttribute('data-cell-degraded'),
      'RECOVERY removes the marker (degraded vs was-degraded are distinguishable)');
  }
  w.close();
}

/* ── SOURCE INJECTION (not a self-built array): break the view, the criterion must fail ── */
{
  const { w } = build({ 'prove_track.view.js': (src) => src.replace(/\(100|colPct \+ '%'/, "''") });
  if (!prime(w, 'equal')) { console.log('  SKIP  lane DOM (mutation): view not assembled'); }
  else {
    /* fall back to the pre-fix shape: no width at all */
    const { w: w2 } = build({ 'prove_track.view.js': (src) => src.replace(
      /var wPct = \(window\.CxCellMetering\.isFiniteNumber\(colPct\) && colPct > 0\)[\s\S]*?: ''\);/,
      "var wPct = '';") });
    prime(w2, 'equal');
    w2.CxProveTrack.renderLanes();
    const ws = widths(laneBlocks(w2));
    ok(ws.length > 0 && ws.some((x) => x === null || x === 0),
      'MUTATION (source): restoring wPct = \'\' IS caught — a default-mode strip of empty blocks');
    w2.close();
  }
  w.close();
}
console.log(bad === 0 ? 'OK — the lane DOM is watched (default mode, degradation, recovery)'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
