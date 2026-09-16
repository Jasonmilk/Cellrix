/* Replay harness for the Cellrix trajectory's Node-side consumption
 * (ADR-0038 metering + ADR-0018 batch 4).
 *
 * The assets are browser IIFEs that only touch `window` at load time and
 * `document.getElementById` at call time, so they load under node with a
 * two-line shim. That lets us replay a REAL event file produced by a live
 * period through the exact production code path — no browser, no mocks.
 *
 * Two independent things are checked here, and they are checked against each
 * other rather than against a stored number:
 *   - the metering aggregate is recomputed from the RAW file's snake_case
 *     fields and compared with the value the payload interpretation produces;
 *   - the same read is fed with and without the metering events, and the two
 *     row lists must be identical apart from the total.
 *
 * Usage: node pt_replay.js [<events.jsonl>]
 *        (default: the largest real event file in the workspace)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const A = path.join(__dirname, '..', 'assets');
const EV = path.join(__dirname, '..', '..', '..', '.helix', 'events');

global.window = {};
global.document = { getElementById: function () { return null; } };
// Same load order as the page: contract -> construction -> tape -> trajectory.
['event_family.js', 'period_normalize.js', 'node_shape.js', 'assembly.js',
 'prove_track.data.js', 'prove_track.render.js', 'prove_track.node.js'].forEach(function (f) {
  eval(fs.readFileSync(path.join(A, f), 'utf8'));
});
const PT = global.window.CxProveTrack;
const ASM = global.window.CxAssembly;
const NORM = global.window.CxNormalize;
const EF = global.window.CxEventFamily;

/* Which files. There is no single real file that carries every kind, so each
 * block below names the fixture it needs and the widest one is taken. Derived
 * from the data and printed, because an assertion over an unnamed fixture is
 * an assertion about nothing in particular. */
function load(name) {
  const jobId = name.replace(/\.events\.jsonl$/, '');
  const rows = fs.readFileSync(path.join(EV, name), 'utf8').split('\n')
    .filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); });
  const m = NORM.mergeChain({ [jobId]: rows }, [jobId]);
  const tape = ASM.create();
  tape.feed(m.events);
  return { jobId: jobId, rows: rows, nodes: tape.snapshot().nodes };
}

function pick(needs) {
  let best = null, bestN = -1;
  fs.readdirSync(EV).forEach(function (name) {
    if (!name.endsWith('.events.jsonl')) { return; }
    const rows = fs.readFileSync(path.join(EV, name), 'utf8').split('\n')
      .filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); });
    const types = {};
    rows.forEach(function (r) { types[r.type] = true; });
    if (!needs.every(function (t) { return types[t]; })) { return; }
    if (rows.length > bestN) { bestN = rows.length; best = name; }
  });
  if (!best) { throw new Error('no real file has ' + needs.join(' + ')); }
  return best;
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

/* The window, through the tape, exactly as the panel does it. */
const META = load(pick(['assistant/usage', 'assistant/reply']));
const events = META.rows, nodes = META.nodes;
console.log('metering + reply fixture: ' + META.jobId + ' (' + events.length + ' events)');

console.log('\n=== 1) the metering aggregate vs the raw file ===');
const u = PT.node.derivePeriodUsage(nodes);
console.log('  derived:', JSON.stringify(u));
check('returns an object (not null)', u !== null);
if (u) {
  /* Recomputed from the RAW events' own fields. The payload uses camelCase and
   * the wire uses snake_case, so agreement here is evidence that the
   * interpretation kept the values, not that one function agrees with itself. */
  const usage = events.filter(function (e) { return e.type === 'assistant/usage'; });
  const ok = usage.filter(function (e) {
    const d = e.data || {};
    return typeof d.prompt_tokens === 'number' && d.prompt_tokens >= 0 &&
           typeof d.completion_tokens === 'number' && d.completion_tokens >= 0;
  });
  const sumPrompt = ok.reduce(function (a, e) { return a + e.data.prompt_tokens; }, 0);
  const sumCompletion = ok.reduce(function (a, e) { return a + e.data.completion_tokens; }, 0);
  check('call count matches the raw file', u.calls === ok.length,
    u.calls + ' vs ' + ok.length);
  check('prompt total matches the raw file', u.prompt === sumPrompt,
    u.prompt + ' vs ' + sumPrompt);
  check('completion total matches the raw file', u.completion === sumCompletion,
    u.completion + ' vs ' + sumCompletion);
  check('total is prompt + completion, not a third measurement',
    u.total === u.prompt + u.completion);
  /* 1. DISJOINT counts: the upstream prompt_tokens already includes cache hits. */
  check('input is disjoint from the cache hit',
    u.cached == null ? u.input == null : u.input === u.prompt - u.cached,
    JSON.stringify({ input: u.input, prompt: u.prompt, cached: u.cached }));
}

console.log('\n=== 2) malformed rows are refused, not guessed ===');
const mk = function (p, c) {
  return { kind: 'metering', payload: { promptTokens: p, completionTokens: c } };
};
check('a non-numeric count is not a measurement', PT.node.derivePeriodUsage([mk('664', 171)]) === null);
check('a negative count is not a measurement', PT.node.derivePeriodUsage([mk(-1, 5)]) === null);
check('an overflowing sum withholds the whole aggregate, not a partial one',
  PT.node.derivePeriodUsage([mk(1e308, 1e308), mk(1e308, 1e308)]) === null);
check('a malformed row is skipped and the valid one survives',
  (function () {
    const r = PT.node.derivePeriodUsage([mk(664, 171), mk('664', 171)]);
    return r !== null && r.calls === 1 && r.prompt === 664;
  })());
check('no metering at all means the fact does not exist',
  PT.node.derivePeriodUsage(nodes.filter(function (n) { return n.kind !== 'metering'; })) === null);

console.log('\n=== 3) fmtTok distinguishes absent from zero ===');
const D = PT.data;
check('null -> em dash', D.fmtTok(null) === '—');
check('undefined -> em dash', D.fmtTok(undefined) === '—');
check('0 -> "0" (a fact, not absence)', D.fmtTok(0) === '0', 'got ' + JSON.stringify(D.fmtTok(0)));

console.log('\n=== 4) metering must not disturb the rows it does not draw ===');
const withM = PT.node.buildSession(nodes);
const withoutM = PT.node.buildSession(nodes.filter(function (n) { return n.kind !== 'metering'; }));
const shape = function (s) {
  return s.filter(function (r) { return r.kind === 'ev'; })
    .map(function (r) { return r.cls + ':' + r.dur; });
};
check('the row list is identical with and without metering',
  shape(withM).join(',') === shape(withoutM).join(','));
check('metering is not drawn as a row',
  withM.every(function (r) { return r.cls !== 'USAGE'; }));
check('and the rows are still all there',
  withM.filter(function (r) { return r.kind === 'ev'; }).length ===
  nodes.filter(function (n) { return !!PT.render.SUMMARY[n.kind]; }).length);

console.log('\n=== 5) the deliverable row carries the period total ===');
const replies = withM.filter(function (r) { return r.kind === 'ev' && r.cls === EF.KIND_CLASS.reply; });
const nonReply = withM.filter(function (r) { return r.kind === 'ev' && r.cls !== EF.KIND_CLASS.reply; });
check('at least one reply row', replies.length > 0, 'got ' + replies.length);
check('REPLY.tok == the derived total',
  !!u && replies.every(function (r) { return r.tok === u.total; }),
  JSON.stringify(replies.map(function (r) { return r.tok; })));
check('only REPLY rows carry tok', nonReply.every(function (r) { return r.tok === null; }));

console.log('\n=== 6) the panes a reviewer reads ===');
const PANE = load(pick(['tool/result', 'check/status']));
console.log('tool + check fixture: ' + PANE.jobId + ' (' + PANE.rows.length + ' events)');
const paneNodes = PANE.nodes;
const toolRes = paneNodes.filter(function (n) { return n.kind === 'tool' && n.payload.stage === 'result'; });
if (toolRes.length) {
  check('a tool result shows its outcome', PT.node.detailOf(toolRes[0]) ===
    (function () { try { return JSON.stringify(JSON.parse(String(toolRes[0].payload.outcome)), null, 2); } catch (e) { return String(toolRes[0].payload.outcome); } })(),
    JSON.stringify(PT.node.detailOf(toolRes[0]).slice(0, 60)));
  check('and keeps its own duration in the row', PT.node.buildSession(paneNodes)
    .some(function (r) { return r.kind === 'ev' && r.cls === EF.KIND_CLASS.tool && r.dur > 0; }));
}
const checks = paneNodes.filter(function (n) { return n.kind === 'check'; });
if (checks.length) {
  const passed = checks.filter(function (n) { return n.payload.passed; })[0];
  const failed = checks.filter(function (n) { return !n.payload.passed; })[0];
  check('a pass reads PASS', passed && PT.render.summarize(passed).indexOf('PASS') > -1,
    passed ? PT.render.summarize(passed) : 'no passing check');
  check('a fail reads FAIL', failed && PT.render.summarize(failed).indexOf('FAIL') > -1,
    failed ? PT.render.summarize(failed) : 'no failing check');
  check('the gate label comes from the payload, not from a literal',
    checks.every(function (n) { return PT.render.summarize(n).indexOf(String(n.payload.gate)) === 0; }),
    JSON.stringify(checks.map(function (n) { return PT.render.summarize(n); })[0]));
}
const verdicts = paneNodes.filter(function (n) { return n.kind === 'verdict'; });
if (verdicts.length) {
  check('a verdict carries its reason when it has one',
    verdicts.every(function (n) {
      const s = PT.render.summarize(n);
      return !n.payload.reason || s.indexOf(n.payload.reason) > -1;
    }));
}

console.log('');
console.log(failures === 0 ? 'RESULT: PASS (all checks green)' : 'RESULT: FAIL (' + failures + ' checks failed)');
process.exit(failures === 0 ? 0 : 1);
