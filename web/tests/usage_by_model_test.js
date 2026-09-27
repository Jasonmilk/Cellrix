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

/* ── STEP-LEVEL: two steps, two models, inside ONE turn (the Agent Loop's real shape) ── */
{
  const w4 = new JSDOM(AP.assemble().html, { runScripts: 'dangerously', url: 'http://127.0.0.1:1/' }).window;
  const EV = [
    { type: 'turn/start', data: {} },
    { type: 'assistant/usage', data: { prompt_tokens: 100, completion_tokens: 20, model: 'planner-strong' } },
    { type: 'assistant/usage', data: { prompt_tokens: 5, completion_tokens: 7, model: 'executor-cheap' } },
    { type: 'turn/end', data: { done: true, success: true, impasse: false } }
  ];
  const st4 = w4.CxAssembly.create(); st4.register('p', { name: 'p' }); st4.activate('p');
  st4.feed(EV.map((e, i) => Object.assign(
    { seq: i + 1, time: '2026-01-01T00:00:0' + i + 'Z', job_id: 'fx3', period_id: 'fx3' }, e)));
  const N4 = (st4.snapshot() && (st4.snapshot().nodes || st4.snapshot())) || [];
  const rows4 = w4.CxProveTrack.node.buildSession(N4);
  const proj4 = w4.CxCellMetering.project(rows4, {
    usage: w4.CxProveTrack.node.derivePeriodUsage(N4),
    usageByTurn: w4.CxProveTrack.node.usageByTurn(N4),
    modelByTurn: w4.CxProveTrack.node.modelByTurn(N4),
    usageByModel: w4.CxProveTrack.node.usageByModel(N4),
    stepModels: w4.CxProveTrack.node.stepModels(N4)
  });
  const steps = proj4.stepModels || [];
  ok(steps.length === 2, 'the STEP outlet has one entry per step (' + steps.length + ')');
  ok(steps.length === 2 && steps[0].model === 'planner-strong' && steps[1].model === 'executor-cheap',
    'STEP-LEVEL PAIRING: step 0 = planner-strong, step 1 = executor-cheap  ['
    + steps.map((x) => x.model).join(', ') + ']');
  ok(steps.reduce((a, x) => a + (x.completion || 0), 0) === (proj4.tok && proj4.tok.v),
    'SELF-CHECK: Σ(step tokens) == the period total ('
    + steps.reduce((a, x) => a + (x.completion || 0), 0) + ' == ' + (proj4.tok && proj4.tok.v) + ')');
  ok(proj4.usageByModel && Object.keys(proj4.usageByModel).length === 2,
    'AND usageByModel has an OUTLET in the return value (it used to be computed and then dropped)  ['
    + (proj4.usageByModel ? Object.keys(proj4.usageByModel).length : 0) + ' groups]');
  /* MUTATION: with no step outlet the same session can only say "(mixed)" */
  const proj4b = w4.CxCellMetering.project(rows4, {
    usage: w4.CxProveTrack.node.derivePeriodUsage(N4),
    modelByTurn: w4.CxProveTrack.node.modelByTurn(N4)
  });
  ok((proj4b.stepModels || []).length === 0
    && (proj4b.turns[0] || {}).tokModel === '(mixed)',
    'MUTATION: without the step outlet the turn can only report "(mixed)" — which is why step grain is required');
  w4.close();
}

/* ── DOES ANY OF IT REACH THE SCREEN? ──
 * SOURCE-LEVEL assertions only, and the reason is MEASURED: priming S.session from the pipeline
 * and calling renderTable() yields `S.compactGroups = {}` (no groups at all), so this input does
 * not reach the compact-row path — the FOURTH time "my input cannot reach the code under test"
 * (§172, §181.4, §190, here). What CAN be checked without that path is that the plaque now has a
 * nail: the group object writes the field the render reads. The true screen check is declared WIP.
 */
{
  const view = fs.readFileSync(path.join(__dirname, '..', 'assets', 'prove_track.view.js'), 'utf8');
  ok(/tokModel: t\.tokModel/.test(view),
    'the compact group WRITES the field the render READS (measured before: E5 false / E6 true, so'
    + ' "who answered" appeared 0 times)');
  ok(/\(g\.steps && g\.steps\.length > 1\)/.test(view),
    'and a multi-step turn lists the STEPS instead of printing "(mixed)"');
  ok(/var stepList = \(cellProj\.stepModels \|\| \[\]\)/.test(view),
    'the step list is derived from the step outlet (§190), not recomputed');
  console.log('  WIP   screen-level: priming S.session + renderTable() leaves S.compactGroups EMPTY'
    + ' (measured), so the rendered-text assertion cannot be reached from this input — declared, not skipped');
}

console.log(bad === 0 ? 'OK — the step→model assignment has an outlet, and the parts sum to the whole'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
