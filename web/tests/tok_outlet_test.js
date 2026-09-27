/* tok_outlet_test — THE DECLARED INPUT REACHES BOTH HOSTS (ADR-0048 §181).
 *
 * `prove_track.render.js` declares `NOT_DRAWN: { metering: … }` — the meter is not a cycle step.
 * That decision is CORRECT, and its downstream cost was that no metering row ever reaches the
 * session, so the per-row fold read `A()` and the folded cell printed "· 无数据" while
 * `derivePeriodUsage(nodes).completion` was 12 all along. The fix is not to draw a row: it is to
 * accept the declared input — and to accept it in BOTH hosts, because the view reads `turns[i].tok`.
 */
/* MACHINE-READABLE, NOT ONLY HUMAN-READABLE (ADR-0048 §203): this suite already SAID
 * `NEEDS-INPUT: jsdom 未安装` — in prose. The ledger reads `REQUIRES`, so "said" and
 * "declared" were separated by a BLOCKING. Both hosts, or neither counts. */
const REQUIRES = 'jsdom';

const path = require('path');
const CM = require(path.join(__dirname, '..', 'assets', 'cell_metering.js'));

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('NEEDS-INPUT: jsdom 未安装 — tok 出口判据无法行使'); process.exit(3); }
const AP = require('./assemble_page.js');
const fs = require('fs');

/* THE REAL PIPELINE, NOT SYNTHETIC ROWS (ADR-0048 §181.4): my hand-built rows carried `turn: 1`
 * and still produced NO turns[] — the projection's turn model needs what buildSession gives it.
 * A criterion whose input cannot reach the code path under test proves nothing about it. */
const RAW = fs.readFileSync(path.join(__dirname, 'fixtures', 'pinned.events.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const w = new JSDOM(AP.assemble().html, { runScripts: 'dangerously', url: 'http://127.0.0.1:1/' }).window;
const st = w.CxAssembly.create(); st.register('p', { name: 'p' }); st.activate('p');
st.feed(RAW.map((e, i) => Object.assign(
  { seq: e.seq || i + 1, time: e.time || '2026-01-01T00:00:0' + (i % 10) + 'Z',
    job_id: 'fx', period_id: 'fx' }, e)));
const NODES = (st.snapshot() && (st.snapshot().nodes || st.snapshot())) || [];
const ROWS = w.CxProveTrack.node.buildSession(NODES);
const USAGE = w.CxProveTrack.node.derivePeriodUsage(NODES);
w.close();

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const fmt = (s) => s.k + (s.v === undefined ? '' : ':' + s.v);

const withUsage = CM.project(ROWS, { usage: { completion: USAGE.completion } });
ok(USAGE && USAGE.completion === 12, 'the pipeline\'s own aggregate says completion == 12  ['
  + (USAGE && USAGE.completion) + ']');
ok(withUsage.tok && withUsage.tok.k === 'p' && withUsage.tok.v === 12,
  'project(rows, {usage}) ⇒ top-level tok == P(12)  [' + (withUsage.tok && fmt(withUsage.tok)) + ']');
const t0 = withUsage.turns && withUsage.turns[0];
ok(t0 && t0.tok && t0.tok.k === 'p' && t0.tok.v === 12,
  'AND turns[0].tok == P(12) — the host the view actually reads  [' + (t0 && t0.tok && fmt(t0.tok)) + ']');
ok(t0 && withUsage.tok.v === t0.tok.v, 'the two hosts agree (one fact, two homes must not drift)');

const partial = CM.project(ROWS, { usage: { completion: 12, completionPartial: true } });
ok(partial.partial === true || (partial.turns[0] && partial.turns[0].partial === true),
  'completionPartial ⇒ the fold is marked partial (a lower bound stays visible)');

const withOut = CM.project(ROWS);
ok(withOut.tok && withOut.tok.k === 'a',
  'WITHOUT the declaration the old answer stands (A()) — rule ⑩: no declaration, no value  ['
  + (withOut.tok && fmt(withOut.tok)) + ']');

/* MUTATIONS */
const changed = CM.project(ROWS, { usage: { completion: 99 } });
ok(changed.tok.v === 99 && changed.tok.v !== 12,
  'MUTATION: changing the declared completion IS carried through (99 ≠ 12)');
ok(CM.project(ROWS, { usage: { completion: -1 } }).tok.k === 'a',
  'MUTATION: an ILLEGAL declaration is refused, not absorbed (completion:-1 ⇒ A())');
console.log(bad === 0 ? 'OK — the declared meter reaches both hosts, and only when declared'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
