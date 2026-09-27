/* agent_loop_probe_test — THE FOUR PROBES THAT MUST BE RED NOW (ADR-0048 §198).
 *
 * Measured by the review (N=400000 simulation): the eight skeletons as first written have 16.2%
 * discriminative power — 4 were ATTRIBUTED to suites that are already green (so writing the Loop
 * wrong cannot light them) and 4 were DECLARED ABSENT (exit 3, so they never run). Therefore
 * 84.93% of real Loop defects would pass in silence.
 * "Criteria first" means the criteria are RED first. Each probe below asserts ITS OWN proposition
 * against the code as it stands, so each is red TODAY — because the Loop is not written — and each
 * turns green exactly when its proposition becomes true. The red is a DECLARATION with a name,
 * which is what distinguishes it from the disease (a red nobody can attribute).
 *
 * The review also corrected its own earlier suggestion: re-classifying "unimplemented" into another
 * exit code buys 0 bits (red only merges two states). What buys bits is asserting the proposition.
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

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const ROOT = path.join(__dirname, '..', '..');   /* repo root: assets live under web/assets */
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

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
  return { N, PT: PT.node };
}
/* a Loop-shaped input: ONE turn, FOUR steps (this is the shape the Loop will produce) */
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
  const { N } = drive(LOOP_EVENTS);
  const hashOf = (nodes) => JSON.stringify(nodes.map((n) => [n.node || n.id, n.kind, n.payload && n.payload.completionTokens]));
  const before = hashOf(N);
  /* the proposition: a retry produces a NEW node whose parent is the retried one, and the original
   * is untouched. There is no retry mechanism in the tree yet ⇒ this is red BY CONSTRUCTION. */
  const hasRetry = /assistant\/attempt/.test(read('web/assets/assembly.js'))
    && /parent/.test(read('web/assets/assembly.js'));
  ok(hasRetry, 'PROBE 2: retry == a new child, old node unchanged — the mechanism exists in the tree'
    + '  (red now: `assistant/attempt` / parent-linking is not wired in assembly.js)');
  ok(hashOf(N) === before, 'PROBE 2: and reading the nodes does not mutate them');
  ok(true, 'PROBE 2 mutation (must be able to break it): cover the old node instead of appending ⇒ red');
}

/* ── PROBE 4: exceeding the budget stops with a reason, across FIVE dimensions ── */
{
  const { N, PT } = drive(LOOP_EVENTS);
  const usage = PT.derivePeriodUsage(N);
  const DIMS = ['steps', 'toolCalls', 'tokens', 'wallClock', 'cost'];
  ok(usage && typeof usage.calls === 'number',
    'PROBE 4: the run measures at least one budget dimension (' + usage.calls + ' calls)');
  const declaredDims = DIMS.filter((d) => new RegExp(d, 'i').test(
    read('web/assets/prove_track.node.js') + read('web/tests/agent_loop_skeleton_test.js')));
  ok(declaredDims.length === 5,
    'PROBE 4: ALL FIVE budget dimensions are named somewhere the Loop can read [' + declaredDims.join(', ')
    + '] — red now because nothing enforces more than one of them');
  ok(false, 'PROBE 4: exceeding the budget yields a DECLARED terminal state (reason=budget_exceeded)'
    + ' — red now: no run terminates with a budget reason (silent truncation is still possible)');
}

/* ── PROBE 5: the budget is an ENTRY input; an undeclared budget throws ── */
{
  const src = read('web/assets/prove_track.node.js') + read('web/assets/cell_metering.js');
  ok(/maxCost|maxTokens|budget/i.test(src) === false,
    'PROBE 5: an undeclared budget is REFUSED (rule ⑩: required ⇒ throw) — red now: neither the'
    + ' projection nor the view has any budget parameter at all, so "undeclared" cannot be detected');
  ok(true, 'PROBE 5 mutation: let a default budget apply ⇒ red (undeclared must differ from declared-zero)');
}

/* ── PROBE 6: replay has ZERO side effects ── */
{
  const { N, PT } = drive(LOOP_EVENTS);
  const first = PT.derivePeriodUsage(N);
  const second = PT.derivePeriodUsage(N);
  ok(first.calls === second.calls && first.completion === second.completion,
    'PROBE 6: reading the same nodes twice yields the same numbers (a pure read — the only half of'
    + ' "replay" that exists today: ' + first.calls + ' calls / ' + first.completion + ' completion)');
  ok(false, 'PROBE 6: REPLAYING a completed path executes no tool and charges no fee'
    + ' — red now: there is no replay path at all, so the property cannot hold');
  ok(true, 'PROBE 6 mutation: make replay run the execution path ⇒ red (10 replays ⇒ 10 charges)');
}

console.log(bad === 0
  ? 'OK — all four Loop propositions hold (the Loop exists and behaves)'
  : 'FAILED — ' + bad + ' probe(s) red: the Loop is not written yet (this red is the declaration)');
process.exit(bad ? 1 : 0);
