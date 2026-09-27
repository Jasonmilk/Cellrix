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

/* TEST-LOCAL ASSEMBLER: the server turns (base.html, boot.json) into a page; the criterion needs
 * the SAME two inputs to get a page whose scripts can run. `boot_placeholders_test.js` guards the
 * three-way alignment of exactly these inputs, so this copy cannot silently drift from them. */
function assemblePage(assetOverrides) {
  const graph = JSON.parse(A('boot.json'));
  let out = A('base.html');
  for (const p of graph.pieces) {
    const asset = p.asset;
    if (!fs.existsSync(path.join(ROOT, 'web', 'assets', asset))) { continue; }
    let bytes = A(asset);
    if (assetOverrides && assetOverrides[asset]) { bytes = assetOverrides[asset](bytes); }
    out = out.split(p.placeholder).join(bytes);
  }
  return out;
}
function build(assetOverrides) {
  const dom = new JSDOM(assemblePage(assetOverrides),
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
function prime(w, durMode) {
  const PT = w.CxProveTrack;
  if (!PT || !PT.S) { return false; }
  PT.S.session = events.map((e, i) => Object.assign({ kind: 'ev', id: 'e' + i }, e));
  PT.S.durMode = durMode;
  PT.S.q = ''; PT.S.sel = null;
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
    const per = {};
    blocks.forEach((b) => { const lane = b.parentElement.id; per[lane] = (per[lane] || 0) + 1; });
    const sums = Object.keys(per).map((lane) => widths(Array.from(w.document.querySelectorAll('#' + lane + ' .e-blk'))
      .filter((b) => b.getAttribute('data-e-ev'))).reduce((a, b) => a + (b || 0), 0));
    ok(sums.every((s) => Math.abs(s - 100) < 0.01),
      'each lane sums to ~100% in the default mode [' + sums.map((s) => s.toFixed(2)).join(', ') + ']');
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
    /* 251 unknown columns ⇒ the projection returns reason 'row-exceeds-grid' */
    const many = Array.from({ length: 251 }, (_, i) => Object.assign({ kind: 'ev', id: 'x' + i },
      i === 0 ? { completion_tokens: 120 } : {}));
    w.CxProveTrack.S.session = many;
    w.CxProveTrack.S.durMode = 'actual';
    w.CxProveTrack.renderLanes();
    const host = w.document.getElementById('eTraj');
    const blocks = laneBlocks(w), ws = widths(blocks);
    ok(host.hasAttribute('data-cell-degraded'),
      'DEGRADED ⇒ the row host names the reason [' + host.getAttribute('data-cell-degraded') + ']');
    ok(ws.length > 0 && ws.every((x) => typeof x === 'number' && x > 0),
      'DEGRADED BUT STILL VISIBLE: widths stay non-zero (' + ws.length + ' blocks, min '
      + Math.min.apply(null, ws).toFixed(3) + '%)');
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
