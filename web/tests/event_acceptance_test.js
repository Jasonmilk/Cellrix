/* event_acceptance_test — "WAS ANYTHING DROPPED?" (ADR-0048 §176).
 *
 * Measured: the pinned fixture produced TWO rejections — one was the fixture's own fault (turn/end
 * without `impasse`), the other was a LIVE BUG: `assistant/usage` with `completion_tokens: null`
 * was refused by the schema, so a legal event ("the upstream did not report it", ADR-0038) was
 * dropped in SILENCE and the tape lost a metering node. Nine suites were green through all of it,
 * because no criterion ever asked the pipeline whether it had rejected anything.
 * The four checks below are two-sided: relaxing the schema must not be indistinguishable from
 * fixing it, so the other side (a turn/end missing `impasse` must still be REFUSED) is asserted too.
 */
const fs = require('fs'), path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('NEEDS-INPUT: jsdom 未安装 — 事件验收判据无法行使'); process.exit(3); }
const AP = require('./assemble_page.js');

const RAW = fs.readFileSync(path.join(__dirname, 'fixtures', 'pinned.events.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

function feed(events, overrides) {
  const w = new JSDOM(AP.assemble(overrides).html,
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://127.0.0.1:1/' }).window;
  const st = w.CxAssembly.create();
  st.register('p', { name: 'p' }); st.activate('p');
  st.feed(events.map((e, i) => Object.assign(
    { seq: e.seq || i + 1, time: e.time || '2026-01-01T00:00:0' + (i % 10) + 'Z',
      job_id: 'fx', period_id: 'fx' }, e)));
  const snap = st.snapshot();
  const nodes = (snap && (snap.nodes || snap)) || [];
  const rej = (typeof st.rejections === 'function') ? st.rejections() : { total: 0, sample: [] };
  w.close();
  return { nodes, rej };
}

/* ① nothing in the pinned fixture is rejected */
{
  const r = feed(RAW);
  const n = r.rej ? (r.rej.total || (r.rej.sample || []).length) : 0;
  ok(n === 0, 'the pinned fixture is accepted WHOLE (rejections=' + n
    + (n ? ' ' + JSON.stringify((r.rej.sample || []).map((s) => s.type + ':' + s.reason)) : '') + ')');
  ok(r.nodes.filter((x) => x.kind === 'metering').length >= 2,
    'both complete usage events became metering nodes (' + r.nodes.filter((x) => x.kind === 'metering').length + ')');
}

/* ② a LEGAL null is accepted (the live bug) */
{
  const withNull = [{ type: 'assistant/usage', data: { prompt_tokens: 3, completion_tokens: null, model: 'm' } }];
  const r = feed(withNull);
  const n = r.rej ? (r.rej.total || (r.rej.sample || []).length) : 0;
  ok(n === 0 && r.nodes.filter((x) => x.kind === 'metering').length === 1,
    'completion_tokens: null is ACCEPTED ("the upstream did not report it" is a value, ADR-0038)'
    + '  [rejections=' + n + ' metering=' + r.nodes.filter((x) => x.kind === 'metering').length + ']');
}

/* ③ MUTATION: stripping 'null' from the schema must break ② (source injection) */
{
  const r = feed([{ type: 'assistant/usage', data: { prompt_tokens: 3, completion_tokens: null, model: 'm' } }],
    { 'event_family.js': (src) => src.replace(
      "completion_tokens: ['number', 'null']", "completion_tokens: ['number']") });
  const n = r.rej ? (r.rej.total || (r.rej.sample || []).length) : 0;
  ok(n > 0 && r.nodes.filter((x) => x.kind === 'metering').length === 0,
    'MUTATION: removing \'null\' from the schema DOES drop the event (the fix is guarded)  [rejections=' + n + ']');
}

/* ④ THE OTHER SIDE: a turn/end missing `impasse` must still be REFUSED (relaxing ≠ fixing) */
{
  const r = feed([{ type: 'turn/end', data: { done: true, success: true } }]);
  const n = r.rej ? (r.rej.total || (r.rej.sample || []).length) : 0;
  ok(n > 0, 'a turn/end WITHOUT `impasse` is still REFUSED (the contract has two sides)  [rejections=' + n + ']');
}

console.log(bad === 0 ? 'OK — nothing legal is dropped, and nothing illegal is admitted'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
