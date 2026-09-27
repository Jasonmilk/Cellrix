/* compact_fold_test — THE FOLD MUST HAPPEN, AND ITS PLAQUE MUST REACH THE SCREEN
 * (ADR-0048 §192/§193/§194).
 *
 * Three defects in a row lived on this one path:
 *   §192 every group was vetoed by the turn-title row (no cls, no status) ⇒ compactGroups = {}
 *   §193 the folded row was gated on `isOpen`, contradicting its own comment ⇒ never rendered
 *   §194 with the gate removed the row THREW `reading 'k'`: the group carried `tokTotal` while the
 *        renderer reads `tok.k` — two objects both called "turn" with different key sets.
 * This criterion drives the real render path and asserts the shape contract, the single statement,
 * and the screen text that an Agent Loop is accepted on.
 */
/* MACHINE-READABLE, NOT ONLY HUMAN-READABLE (ADR-0048 §203): this suite already SAID
 * `NEEDS-INPUT: jsdom 未安装` — in prose. The ledger reads `REQUIRES`, so "said" and
 * "declared" were separated by a BLOCKING. Both hosts, or neither counts. */
const REQUIRES = 'jsdom';

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

function drive(overrides) {
  const w = new JSDOM(AP.assemble(overrides).html,
    { runScripts: 'dangerously', url: 'http://127.0.0.1:1/' }).window;
  const st = w.CxAssembly.create(); st.register('p', { name: 'p' }); st.activate('p');
  st.feed(EV.map((e, i) => Object.assign(
    { seq: i + 1, time: '2026-01-01T00:00:0' + i + 'Z', job_id: 'fx', period_id: 'fx' }, e)));
  const N = (st.snapshot() && (st.snapshot().nodes || st.snapshot())) || [];
  const PT = w.CxProveTrack, CM = w.CxCellMetering;
  PT.S.session = PT.node.buildSession(N);
  PT.S.usage = PT.node.derivePeriodUsage(N);
  PT.S.usageByTurn = PT.node.usageByTurn(N);
  PT.S.usageByModel = PT.node.usageByModel(N);
  PT.S.modelByTurn = PT.node.modelByTurn(N);
  PT.S.stepModels = PT.node.stepModels(N);
  PT.S.compact = true;
  let threw = null;
  try { PT.renderTable(); } catch (e) { threw = e.message; }
  return { w, PT, CM, N, threw };
}

/* ── 1. the fold produces a group, and the group carries the step plaque ── */
{
  const { w, PT, CM, threw } = drive();
  const g = (PT.S.compactGroups || {})['t1'];
  ok(!!g, 'the fold PRODUCES a group for a real session');
  ok(g && Array.isArray(g.ids) && g.ids.length > 0,
    'and the group contains foldable steps  [' + (g && g.ids ? g.ids.length : 0) + ']');
  ok(g && Array.isArray(g.steps) && g.steps.length === 2,
    'the step plaque is on the group: ' + JSON.stringify(g && g.steps));
  ok(g && g.steps && /planner-strong 20/.test(g.steps[0]) && /executor-cheap 7/.test(g.steps[1]),
    'each step names its own model and tokens  [' + ((g && g.steps) || []).join(' · ') + ']');

  /* ── 2. THE SHAPE CONTRACT: producer keys ⊇ consumer keys ── */
  ok(!threw, 'the table renders WITHOUT throwing  [' + String(threw).slice(0, 60) + ']');
  ok(g && typeof g.tok === 'object' && g.tok && g.tok.k,
    'the group carries the THREE-STATE value the renderer reads (g.tok.k)');
  const cellText = (function () { try { return CM.foldedCell(g); } catch (e) { return 'THROW:' + e.message; } })();
  ok(cellText.indexOf('THROW') < 0 && /27/.test(cellText),
    'foldedCell(group) states the SAME fact as the projection  [' + cellText + ']');

  /* ── 3. THE SCREEN ── */
  const text = w.document.body.textContent || '';
  ok(text.indexOf('planner-strong') >= 0 && text.indexOf('executor-cheap') >= 0,
    'THE STEP PLAQUE REACHES THE SCREEN  ['
    + (text.indexOf('planner-strong') >= 0 ? 'planner-strong ' : '')
    + (text.indexOf('executor-cheap') >= 0 ? 'executor-cheap' : '') + ']');
  ok(/planner-strong 20/.test(text) && /executor-cheap 7/.test(text),
    'each step shows its own token count next to its model');
  w.close();
}

/* ── 4. MUTATIONS: both halves must be able to fail ── */
{
  const dropped = drive({ 'prove_track.view.js': (src) => src.replace(
    'out[t.id] = { ids: ids, tok: t.tok, partial: t.partial, bound: t.bound,',
    'out[t.id] = { ids: ids, partial: t.partial, bound: t.bound,') });
  ok(!!dropped.threw,
    'MUTATION: dropping `tok` from the group makes the render THROW again (the §194 defect)  ['
    + String(dropped.threw).slice(0, 50) + ']');
  dropped.w.close();

  const vetoed = drive({ 'prove_track.view.js': (src) => src.replace(
    'if (!e.cls && !e.status) { return; }', '') });
  ok(Object.keys(vetoed.PT.S.compactGroups || {}).length === 0,
    'MUTATION: keeping the container row in the fold decision vetoes every group (the §192 defect)');
  vetoed.w.close();
}
console.log(bad === 0 ? 'OK — the fold happens, the shape matches, and the plaque reaches the screen'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
