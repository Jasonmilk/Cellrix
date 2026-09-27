/* compact_fold_test — THE FOLD MUST BE ABLE TO HAPPEN AT ALL (ADR-0048 §192).
 *
 * Measured: every group was vetoed by the turn-title row, which carries neither `cls` nor `status`
 * and therefore fell into the final `else { anyShown = true; }`. So `compactGroups` was `{}` in
 * production, the compact feature never folded anything, and its absence was mis-read by an escape
 * hatch as "this turn contains a FAILURE". Rule ⑮: one sentence, two causes.
 * This criterion drives the REAL render path and asks the only question that matters: did a group
 * come out at all?
 */
const fs = require('fs'), path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('NEEDS-INPUT: jsdom 未安装'); process.exit(3); }
const AP = require('./assemble_page.js');

const EV = [
  { type: 'turn/start', data: {} },
  { type: 'assistant/usage', data: { prompt_tokens: 100, completion_tokens: 20, model: 'planner-strong' } },
  { type: 'assistant/usage', data: { prompt_tokens: 5, completion_tokens: 7, model: 'executor-cheap' } },
  { type: 'turn/end', data: { done: true, success: true, impasse: false } }
];
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

function groupsFor(overrides) {
  const w = new JSDOM(AP.assemble(overrides).html,
    { runScripts: 'dangerously', url: 'http://127.0.0.1:1/' }).window;
  const st = w.CxAssembly.create(); st.register('p', { name: 'p' }); st.activate('p');
  st.feed(EV.map((e, i) => Object.assign(
    { seq: i + 1, time: '2026-01-01T00:00:0' + i + 'Z', job_id: 'fx', period_id: 'fx' }, e)));
  const N = (st.snapshot() && (st.snapshot().nodes || st.snapshot())) || [];
  const PT = w.CxProveTrack;
  PT.S.session = PT.node.buildSession(N);
  PT.S.usage = PT.node.derivePeriodUsage(N);
  PT.S.usageByTurn = PT.node.usageByTurn(N);
  PT.S.usageByModel = PT.node.usageByModel(N);
  PT.S.modelByTurn = PT.node.modelByTurn(N);
  PT.S.stepModels = PT.node.stepModels(N);
  PT.S.compact = true;
  try { PT.renderTable(); } catch (e) { /* the render may need live state; the groups are what we read */ }
  const g = PT.S.compactGroups || {};
  w.close();
  return g;
}

const g = groupsFor();
const keys = Object.keys(g);
ok(keys.length > 0, 'the fold PRODUCES a group for a real session  [' + keys.length + ' group(s)]');
if (keys.length) {
  const one = g[keys[0]];
  ok(Array.isArray(one.ids) && one.ids.length > 0,
    'and the group contains foldable steps  [' + (one.ids || []).length + ']');
  ok(Array.isArray(one.steps) && one.steps.length === 2,
    'AND the step plaque is on the group: ' + JSON.stringify(one.steps));
  ok(one.steps && /planner-strong 20/.test(one.steps[0]) && /executor-cheap 7/.test(one.steps[1]),
    'each step names its own model and tokens  [' + (one.steps || []).join(' · ') + ']');
}

/* MUTATION: restoring the veto (not skipping the container row) must empty the groups again */
const g2 = groupsFor({ 'prove_track.view.js': (src) => src.replace(
  'if (!e.cls && !e.status) { return; }', '') });
ok(Object.keys(g2).length === 0,
  'MUTATION: keeping the container row in the fold decision DOES veto every group (this is the bug)');
console.log(bad === 0 ? 'OK — the fold happens, and the step plaque reaches the group'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
