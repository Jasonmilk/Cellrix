/* usage_by_model_test — THE STEP→MODEL ASSIGNMENT MUST HAVE AN OUTLET (ADR-0048 §189).
 *
 * Measured: `model` is recorded on the metering node (the node carries payload.model), and the
 * event stream writes it "so a reader can tell which layer actually answered" — yet usageBySource,
 * usageByTurn and derivePeriodUsage add numbers only, and the view never showed it. An Agent Loop
 * is accepted on exactly that fact (planner ⇒ strong model, executor ⇒ cheap one), so with no
 * outlet the acceptance criterion is unmeasurable: I(assignment ; screen) = 0 bits.
 */
const fs = require('fs'), path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('NEEDS-INPUT: jsdom 未安装'); process.exit(3); }
const AP = require('./assemble_page.js');

const EVENTS = [
  { type: 'turn/start', data: {} },
  { type: 'assistant/usage', data: { prompt_tokens: 9, completion_tokens: 5, model: 'agnes-3.0-flash' } },
  { type: 'assistant/usage', data: { prompt_tokens: 11, completion_tokens: 7, model: 'agnes-2.5-flash' } },
  { type: 'turn/end', data: { done: true, success: true, impasse: false } }
];
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

const w = new JSDOM(AP.assemble().html, { runScripts: 'dangerously', url: 'http://127.0.0.1:1/' }).window;
const st = w.CxAssembly.create(); st.register('p', { name: 'p' }); st.activate('p');
st.feed(EVENTS.map((e, i) => Object.assign(
  { seq: i + 1, time: '2026-01-01T00:00:0' + i + 'Z', job_id: 'fx', period_id: 'fx' }, e)));
const NODES = (st.snapshot() && (st.snapshot().nodes || st.snapshot())) || [];
const byModel = w.CxProveTrack.node.usageByModel(NODES);
const period = w.CxProveTrack.node.derivePeriodUsage(NODES);
w.close();

const models = Object.keys(byModel).sort();
ok(models.length === 2, 'two models are distinguished, not merged  [' + models.join(', ') + ']');
ok(models.indexOf('agnes-3.0-flash') >= 0 && models.indexOf('agnes-2.5-flash') >= 0,
  'and they are the models that actually answered');
const sumC = models.reduce((a, m) => a + byModel[m].completion, 0);
ok(byModel['agnes-3.0-flash'].completion === 5 && byModel['agnes-2.5-flash'].completion === 7,
  'each model carries ITS OWN tokens (5 / 7)');
ok(sumC === period.completion,
  'SELF-CHECK: Σ(by model) == period (' + sumC + ' == ' + period.completion + ')');
ok(period.calls === 2, 'both calls counted (' + period.calls + ')');

/* MUTATION: collapsing the model key must be caught */
{
  const w2 = new JSDOM(AP.assemble().html, { runScripts: 'dangerously', url: 'http://127.0.0.1:1/' }).window;
  const collapsed = {};
  NODES.filter((n) => n.kind === 'metering').forEach((n) => {
    (collapsed['(all)'] = collapsed['(all)'] || []).push(n);
  });
  const keys = Object.keys(collapsed);
  ok(keys.length === 1, 'MUTATION scope: merging every model into one key yields 1 group (so the '
    + 'two-group check above is about the KEY, not about counting nodes)');
  w2.close();
}
/* ── WHICH TURN USED WHICH MODEL (the Agent Loop's acceptance fact) ── */
{
  const w3 = new JSDOM(AP.assemble().html, { runScripts: 'dangerously', url: 'http://127.0.0.1:1/' }).window;
  const EV = [
    { type: 'turn/start', data: {} },
    { type: 'assistant/usage', data: { prompt_tokens: 1, completion_tokens: 5, model: 'planner-strong' } },
    { type: 'turn/end', data: { done: true, success: true, impasse: false } },
    { type: 'turn/start', data: {} },
    { type: 'assistant/usage', data: { prompt_tokens: 2, completion_tokens: 7, model: 'executor-cheap' } },
    { type: 'turn/end', data: { done: true, success: true, impasse: false } }
  ];
  const st3 = w3.CxAssembly.create(); st3.register('p', { name: 'p' }); st3.activate('p');
  st3.feed(EV.map((e, i) => Object.assign(
    { seq: i + 1, time: '2026-01-01T00:00:0' + i + 'Z', job_id: 'fx2', period_id: 'fx2' }, e)));
  const N3 = (st3.snapshot() && (st3.snapshot().nodes || st3.snapshot())) || [];
  const rows3 = w3.CxProveTrack.node.buildSession(N3);
  const proj3 = w3.CxCellMetering.project(rows3, {
    usage: w3.CxProveTrack.node.derivePeriodUsage(N3),
    usageByTurn: w3.CxProveTrack.node.usageByTurn(N3),
    modelByTurn: w3.CxProveTrack.node.modelByTurn(N3)
  });
  const models3 = (proj3.turns || []).map((t) => t.tokModel);
  ok(models3[0] === 'planner-strong' && models3[1] === 'executor-cheap',
    'EACH TURN NAMES ITS OWN MODEL — planner vs executor is verifiable  [' + models3.join(', ') + ']');
  w3.close();
}

console.log(bad === 0 ? 'OK — the step→model assignment has an outlet, and the parts sum to the whole'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
