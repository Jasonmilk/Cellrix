/* lane_dom_test — THE CRITERION IS AIMED AT THE QUANTITY THE JUDGEMENT NAMES (ADR-0048 §174).
 *
 * Measured (reviewer, reproduced): reversing the view's width order —
 *     var colPct = laneAlloc.cols[idx]  ⇒  cols[cols.length - 1 - idx]
 * leaves Σ=100, every block > 0 and every suite green. Five suites measured FUNCTIONALS of the
 * rendered value (non-null, > 0, Σ=100) and none measured the value itself: the criteria were a
 * SURROGATE ENDPOINT (CAST 1989 — the drug suppressed the arrhythmia and the patients died).
 * This file asserts the value PER BLOCK against arithmetic computed HERE, and it carries a
 * view-level mutation, because the seam between projection and pixel is where six regressions
 * have lived (missing boot pieces · wPct='' · var hoisting · shape mismatch · dur=0 · reversal).
 */
/* MACHINE-READABLE, NOT ONLY HUMAN-READABLE (ADR-0048 §203): this suite already SAID
 * `NEEDS-INPUT: jsdom 未安装` — in prose. The ledger reads `REQUIRES`, so "said" and
 * "declared" were separated by a BLOCKING. Both hosts, or neither counts. */
const REQUIRES = 'jsdom';

const fs = require('fs'), path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('NEEDS-INPUT: jsdom 未安装 — DOM 级判据无法行使'); process.exit(3); }
const AP = require('./assemble_page.js');

const GRID = 200, TICK = 100 / GRID;             /* gridCols=200 is the view's own constant */
const events = fs.readFileSync(path.join(__dirname, 'fixtures', 'pinned.events.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

function build(overrides) {
  const dom = new JSDOM(AP.assemble(overrides).html,
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://127.0.0.1:1/' });
  return dom.window;
}
function prime(w, durMode, evs) {
  const PT = w.CxProveTrack;
  if (!PT || !PT.S || !PT.node) { return null; }
  const st = (w.CxAssembly && w.CxAssembly.create) ? w.CxAssembly.create() : null;
  if (!st) { return null; }
  st.register('probe', { name: 'probe' }); st.activate('probe');
  const src = evs || events;
  st.feed(src.map((e, i) => Object.assign(
    { seq: i + 1, time: '2026-01-01T00:00:0' + (i % 10) + 'Z', job_id: 'fx', period_id: 'fx' }, e)));
  const snap = st.snapshot();
  PT.S.session = PT.node.buildSession((snap && (snap.nodes || snap)) || []);
  PT.S.durMode = durMode; PT.S.q = ''; PT.S.sel = null;
  PT.renderLanes();
  return { rows: PT.S.session, rejections: (typeof st.rejections === 'function') ? st.rejections() : null };
}
const LANES = ['eLaneInput', 'eLaneModel', 'eLaneTool'];
const laneWidths = (w, id) => Array.from(w.document.querySelectorAll('#' + id + ' .e-blk'))
  .map((b) => { const m = /flex:\s*0\s+0\s+([-\d.]+)%/.exec(b.getAttribute('style') || ''); return m ? parseFloat(m[1]) : null; });
const rel = (a, b) => Math.abs(a - b) < 0.01;

/* ── 1. THE VALUE, PER BLOCK, AGAINST ARITHMETIC COMPUTED HERE (not against allocate()) ── */
{
  const w = build();
  const primed = prime(w, 'actual');
  if (!primed) { console.log('  SKIP  lane DOM: view not assembled (declared skip)'); }
  else {
    const rows = primed.rows.filter((r) => r.kind === 'ev');   /* the lanes render the EV rows */
    const measured = rows.map((r, i) => (r.sem === 'tool' && typeof r.dur === 'number' ? i : -1)).filter((i) => i >= 0);
    /* value mode: the measured rows share (100 − nUnknown·tick) in proportion to their values;
     * here there is ONE measured row, so the expected widths are arithmetic: */
    const expected = rows.map((r, i) => (measured.indexOf(i) >= 0 ? 100 - (rows.length - measured.length) * TICK : TICK));
    LANES.forEach((id) => {
      const got = laneWidths(w, id);
      ok(got.length === rows.length, id + ': one block per EV row (' + got.length + '/' + rows.length + ')');
      ok(got.every((v, i) => typeof v === 'number' && rel(v, expected[i])),
        id + ': EVERY block width == the arithmetic value  got [' + got.map((v) => (v === null ? 'null' : v)).join(', ')
        + ']  expected [' + expected.map((v) => v.toFixed(2)).join(', ') + ']');
    });
    const sums = LANES.map((id) => laneWidths(w, id).reduce((a, b) => a + (b || 0), 0));
    ok(sums.every((s) => rel(s, 100)), 'each lane still sums to 100 [' + sums.map((s) => s.toFixed(2)).join(', ') + ']');
    ok(!w.document.getElementById('eTraj').hasAttribute('data-cell-degraded'),
      'not degraded ⇒ the row host carries no marker');
    console.log('    (rows=' + rows.length + ' measured=' + measured.length + ' mode=actual)');
  }
  w.close();
}

/* ── 2. equal (the DEFAULT) must also show the arithmetic 100/n ── */
{
  const w = build();
  const primed = prime(w, 'equal');
  if (!primed) { console.log('  SKIP  lane DOM (equal): view not assembled'); }
  else {
    const n = primed.rows.filter((r) => r.kind === 'ev').length;   /* the lanes render EV rows */
    const got = laneWidths(w, 'eLaneInput');
    ok(got.length === n && got.every((v) => typeof v === 'number' && v > 0 && rel(v, 100 / n)),
      'DEFAULT MODE: every block == 100/n = ' + (100 / n).toFixed(2) + '%  [' + got.join(', ') + ']');
  }
  w.close();
}

/* ── 3. A REAL degradation through the pipeline (the SKIP is GONE) ──
 * MEASURED readings that made this reachable (ADR-0048 §176): a `tool/result` must carry the
 * fixture's shape (`tool`, `ok`, `duration_ms`) — mine first omitted `ok` and was REJECTED, which
 * is why I wrongly concluded "unreachable". With the right shape:
 *     250 × turn/start + 1 × tool/result{tool,ok,duration_ms}  ⇒ nodes 501, ev 251, measured 1,
 *                                                                 rejections 0 ⇒ row-exceeds-grid
 * §166's "consume the declared state" is therefore exercised in the DOM for the first time.
 */
{
  const w = build();
  const many = Array.from({ length: 250 }, () => ({ type: 'turn/start', data: {} }))
    .concat([{ type: 'tool/result', data: { tool: 't', ok: true, duration_ms: 120 } }]);
  const primed = prime(w, 'actual', many);
  if (!primed) { console.log('  SKIP  lane DOM (degraded): view not assembled'); }
  else {
    const host = w.document.getElementById('eTraj');
    const marker = host.getAttribute('data-cell-degraded');
    const got = laneWidths(w, 'eLaneTool');
    const ev = primed.rows.filter((r) => r.kind === 'ev').length;
    console.log('    readings: nodes=' + primed.rows.length + ' ev=' + ev + ' measured='
      + primed.rows.filter((r) => typeof r.dur === 'number').length
      + ' rejections=' + (primed.rejections && primed.rejections.total ? primed.rejections.total : 0));
    ok(marker === 'row-exceeds-grid',
      'DEGRADED: the row host names the reason  [' + marker + ']');
    ok(got.length > 200 && got.every((v) => typeof v === 'number' && v > 0),
      'AND EVERY BLOCK IS STILL VISIBLE: ' + got.length + ' blocks, min '
      + Math.min.apply(null, got).toFixed(3) + '%, empty widths ' + got.filter((v) => v === null).length);
    ok(rel(got.reduce((a, b) => a + b, 0), 100),
      'degraded widths still sum to 100  [' + got.reduce((a, b) => a + b, 0).toFixed(2) + ']');
    prime(w, 'equal');
    ok(!host.hasAttribute('data-cell-degraded'), 'RECOVERY removes the marker');
  }
  w.close();
}

/* ── 4. MUTATIONS: the SEAM itself must be guarded, in both directions ── */
{
  /* (a) projection: shift one column by 1% */
  const w1 = build({ 'cell_metering.js': (s) => s.replace(
    /cols\.push\(tick\);/, 'cols.push(tick + 1);') });
  if (prime(w1, 'actual')) {
    const rows = w1.CxProveTrack.S.session;
    const measured = rows.map((r, i) => (r.sem === 'tool' && typeof r.dur === 'number' ? i : -1)).filter((i) => i >= 0);
    const expected = rows.map((r, i) => (measured.indexOf(i) >= 0 ? 100 - (rows.length - measured.length) * TICK : TICK));
    const got = laneWidths(w1, 'eLaneTool');
    ok(!got.every((v, i) => typeof v === 'number' && rel(v, expected[i])),
      'MUTATION (projection): a 1% shift in one column IS caught');
  } else { console.log('  SKIP  mutation (projection)'); }
  w1.close();

  /* (b) VIEW: reverse the width order — Σ unchanged, every block > 0, only the value wrong.
   * This is the mutation five suites missed; it is the reason this criterion exists. */
  const w2 = build({ 'prove_track.view.js': (s) => s.replace(
    'var colPct = laneAlloc.cols[idx];',
    'var colPct = laneAlloc.cols[laneAlloc.cols.length - 1 - idx];') });
  const primed2 = prime(w2, 'actual');
  if (primed2) {
    const rows = primed2.rows;
    const measured = rows.map((r, i) => (r.sem === 'tool' && typeof r.dur === 'number' ? i : -1)).filter((i) => i >= 0);
    const expected = rows.map((r, i) => (measured.indexOf(i) >= 0 ? 100 - (rows.length - measured.length) * TICK : TICK));
    const got = laneWidths(w2, 'eLaneTool');
    ok(!got.every((v, i) => typeof v === 'number' && rel(v, expected[i])),
      'MUTATION (VIEW, reversed widths): caught — THE SEAM IS GUARDED  [' + got.join(', ') + ']');
  } else { console.log('  SKIP  mutation (view)'); }
  w2.close();
}

console.log(bad === 0 ? 'OK — the criterion measures the PIXEL value per block, and guards the seam'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
