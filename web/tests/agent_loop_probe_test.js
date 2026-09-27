/* agent_loop_probe_test — RED BECAUSE THE PROPOSITION IS FALSE, NOT BECAUSE THE ASSERTION IS
 * WRITTEN `false` (ADR-0048 §198, rewritten per §204).
 *
 * §204 measured the previous version: ok(true, …) × 3 and ok(false, …) × 2 — HARD-CODED, i.e.
 * I(proposition; lamp) = 0.0000 bits. A glued lamp does not light when the Loop is written.
 * Two probes also asked the WRONG PLACE:
 *   · PROBE 2 grepped `assembly.js` for `assistant/attempt` — but CI-144 says a protocol name
 *     appears ONCE, at the boundary (it lives in event_family.js), so correct architecture makes
 *     that grep FALSE. A criterion must not require the code to violate its own principle.
 *   · PROBE 5 asserted `/budget/` was ABSENT — and the only match is cell_metering.js's
 *     `reason: 'reserve-over-budget'`, the LANE WIDTH budget, not the Loop's SPEND budget (two
 *     quantities, one word, rule ⑮). Implementing a real budget makes the word appear, so the
 *     probe would never turn green.
 *
 * THE CORRECT FORM: call the DECLARED ENTRY POINT and let the failure be the evidence (rule ⑩:
 * required ⇒ throw). Each probe is red today because the entry does not exist — a real,
 * attributable red — and turns green when the proposition becomes true.
 *
 * SURFACE (owner's note, §204.6): these probes exercise the JS surface (projection + view). The
 * Loop itself is a RUST concern (Anaphase); its probes must target the Rust entry point and are
 * DECLARED ABSENT below rather than faked here.
 */
const REQUIRES = 'jsdom';   /* machine-readable, not only prose (§203) */

const fs = require('fs'), path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('NEEDS-INPUT: jsdom 未安装'); process.exit(3); }
const AP = require('./assemble_page.js');

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const ROOT = path.join(__dirname, '..', '..');

function drive(events) {
  const w = new JSDOM(AP.assemble().html,
    { runScripts: 'dangerously', url: 'http://127.0.0.1:1/' }).window;
  const st = w.CxAssembly.create(); st.register('p', { name: 'p' }); st.activate('p');
  st.feed(events.map((e, i) => Object.assign(
    { seq: i + 1, time: '2026-01-01T00:00:0' + (i % 10) + 'Z', job_id: 'loop', period_id: 'loop' }, e)));
  const N = (st.snapshot() && (st.snapshot().nodes || st.snapshot())) || [];
  const PT = w.CxProveTrack;
  PT.S.session = PT.node.buildSession(N);
  PT.S.usage = PT.node.derivePeriodUsage(N);
  PT.S.usageByTurn = PT.node.usageByTurn(N);
  PT.S.stepModels = PT.node.stepModels(N);
  w.close();
  return { N, PT: w.CxProveTrack.node };
}

const LOOP_EVENTS = [
  { type: 'turn/start', data: {} },
  { type: 'assistant/usage', data: { prompt_tokens: 100, completion_tokens: 20, model: 'planner-strong' } },
  { type: 'assistant/usage', data: { prompt_tokens: 5, completion_tokens: 7, model: 'executor-cheap' } },
  { type: 'assistant/usage', data: { prompt_tokens: 5, completion_tokens: 9, model: 'executor-cheap' } },
  { type: 'assistant/usage', data: { prompt_tokens: 5, completion_tokens: 11, model: 'executor-cheap' } },
  { type: 'turn/end', data: { done: true, success: true, impasse: false } }
];

/* ── PROBE 2: retry == a NEW branch; the old node's bytes do not change ── */
{
  const { N, PT } = drive(LOOP_EVENTS);
  const bytes = (nodes) => JSON.stringify(nodes.map((n) => [n.node || n.id, n.kind, JSON.stringify(n.payload || null)]));
  const before = bytes(N);
  let branch = null, err = null;
  try { branch = PT.retryBranch(N, N[2]); } catch (e) { err = e; }
  ok(!err, 'PROBE 2: a retry entry point exists (' + (err ? err.message.slice(0, 60) : 'declared') + ')');
  if (!err) {
    ok(branch && branch.parent === (N[2].node || N[2].id),
      'PROBE 2: the retry is a NEW CHILD whose parent is the retried node');
    ok(bytes(N) === before, 'PROBE 2: and the old node is untouched (immutable history)');
  }
}

/* ── PROBE 4: exceeding the budget stops with a reason, across FIVE dimensions ── */
{
  const { N, PT } = drive(LOOP_EVENTS);
  const DIMS = ['steps', 'toolCalls', 'tokens', 'wallClock', 'cost'];
  const only = (d) => { const b = {}; b[d] = 0; return b; };
  let err = null;
  try { PT.runLoop(N, { budget: { steps: 1, toolCalls: 0, tokens: 1, wallClock: 0, cost: 0 } }); }
  catch (e) { err = e; }
  ok(!err, 'PROBE 4: a loop entry point exists (' + (err ? err.message.slice(0, 60) : 'declared') + ')');
  if (!err) {
    DIMS.forEach(function (d) {
      const r = PT.runLoop(N, { budget: only(d) });
      ok(r && r.terminal && r.terminal.reason === 'budget_exceeded' && r.terminal.dimension === d,
        'PROBE 4: exceeding the ' + d + ' budget stops with a DECLARED reason (not a silent truncation)');
    });
  }
}

/* ── PROBE 5: the budget is an ENTRY input — TWO-SIDED ── */
{
  const { N, PT } = drive(LOOP_EVENTS);
  let threw = false, threwWith = false;
  try { PT.runLoop(N, {}); } catch (e) { threw = true; }
  try { PT.runLoop(N, { budget: { steps: 99 } }); } catch (e) { threwWith = true; }
  ok(threw, 'PROBE 5: an UNDECLARED budget is REFUSED (rule ⑩: required ⇒ throw)');
  ok(!threwWith, 'PROBE 5: and a DECLARED budget is accepted (refusal must not be indiscriminate)');
}

/* ── PROBE 6: replay has ZERO side effects ── */
{
  const { N, PT } = drive(LOOP_EVENTS);
  let err = null;
  const before = PT.derivePeriodUsage(N);
  try { PT.replay(N, { path: 'loop' }); } catch (e) { err = e; }
  ok(!err, 'PROBE 6: a replay entry point exists (' + (err ? err.message.slice(0, 60) : 'declared') + ')');
  if (!err) {
    for (let i = 0; i < 10; i++) { PT.replay(N, { path: 'loop' }); }
    const after = PT.derivePeriodUsage(N);
    ok(after.calls === before.calls && after.completion === before.completion,
      'PROBE 6: ten replays change nothing (' + before.calls + ' calls / ' + before.completion
      + ' completion) — a replay reads, it does not execute');
  }
}

/* ── RUST SURFACE, DECLARED ABSENT (the Loop lives in Anaphase, not in these assets) ── */
console.log('  ABSENT  rust-loop probes: the Loop is a Rust concern (Anaphase). The four propositions'
  + ' above are the JS-visible half; the Rust half must call the Anaphase entry point and is'
  + ' declared here rather than faked (ADR-0048 §204.6).');

console.log(bad === 0
  ? 'OK — all four Loop propositions hold (the Loop exists and behaves)'
  : 'FAILED — ' + bad + ' probe(s) red: each names the entry point or behaviour that is missing');
process.exit(bad ? 1 : 0);
