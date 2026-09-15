/* Throwaway replay harness for the Cellrix prove-track data layer (ADR-0038).
 *
 * The data layer is a browser IIFE that only touches `window` at load time and
 * `document.getElementById` at call time, so it can be loaded under node with a
 * two-line shim. That lets us replay a REAL event file produced by a live
 * period through the exact production code path — no browser, no mocks.
 *
 * Usage: node pt_replay.js <prove_track.data.js> <events.jsonl>
 */
'use strict';
const fs = require('fs');

global.window = {};
global.document = { getElementById: function () { return null; } };

const dataPath = process.argv[2];
const eventsPath = process.argv[3];
// Same load order as the page: contract -> assembly -> data (ADR-0018).
const assetsDir = require('path').dirname(dataPath);
eval(fs.readFileSync(assetsDir + '/event_family.js', 'utf8'));
eval(fs.readFileSync(assetsDir + '/assembly.js', 'utf8'));
eval(fs.readFileSync(dataPath, 'utf8'));
const PT = global.window.CxProveTrack;

const events = fs
  .readFileSync(eventsPath, 'utf8')
  .split('\n')
  .filter(function (l) { return l.trim(); })
  .map(function (l) { return JSON.parse(l); });

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  PASS  ' + name);
  } else {
    failures++;
    console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : ''));
  }
}

console.log('=== 1) derivePeriodUsage on a REAL live period ===');
const u = PT.derivePeriodUsage(events);
console.log('  derived:', JSON.stringify(u));
check('returns an object (not null)', u !== null);
if (u) {
  const usageEvents = events.filter(function (e) { return e.type === 'assistant/usage'; });
  const sumPrompt = usageEvents.reduce(function (a, e) { return a + e.data.prompt_tokens; }, 0);
  const sumCompletion = usageEvents.reduce(function (a, e) { return a + e.data.completion_tokens; }, 0);
  const sumCached = usageEvents.reduce(function (a, e) { return a + (e.data.cached_tokens || 0); }, 0);
  check('calls matches the wire count', u.calls === usageEvents.length, u.calls + ' vs ' + usageEvents.length);
  check('prompt is the exact sum', u.prompt === sumPrompt, u.prompt + ' vs ' + sumPrompt);
  check('completion is the exact sum', u.completion === sumCompletion, u.completion + ' vs ' + sumCompletion);
  check('cached is the exact sum (all reported)', u.cached === sumCached, u.cached + ' vs ' + sumCached);
  check('input is DISJOINT: prompt - cached', u.input === u.prompt - u.cached, u.input + ' vs ' + (u.prompt - u.cached));
  check('total is prompt + completion (derived, never read)', u.total === u.prompt + u.completion);
  // `models` was removed: the model name is displayed per-event (d.model),
  // never aggregated. The derived object must not carry it.
  check('models field is gone (no consumer existed)', !('models' in u));
  check('no field is NaN/undefined', Object.keys(u).every(function (k) {
    return u[k] === null || typeof u[k] === 'number';
  }));
}

console.log('=== 2) absence semantics (zero fake placeholders) ===');
check('empty stream -> null', PT.derivePeriodUsage([]) === null);
check('no usage events -> null', PT.derivePeriodUsage(events.filter(function (e) { return e.type !== 'assistant/usage'; })) === null);
check('null stream -> null', PT.derivePeriodUsage(null) === null);

const partial = [
  { type: 'assistant/usage', seq: 1, time: '2026-01-01T00:00:00Z', data: { prompt_tokens: 100, completion_tokens: 10, cached_tokens: 40, reasoning_tokens: 3 } },
  { type: 'assistant/usage', seq: 2, time: '2026-01-01T00:00:01Z', data: { prompt_tokens: 200, completion_tokens: 20, cached_tokens: null, reasoning_tokens: null } }
];
const pu = PT.derivePeriodUsage(partial);
console.log('  partial:', JSON.stringify(pu));
check('all-or-nothing: cached omitted when ANY call lacks it', pu.cached === null, 'got ' + pu.cached);
check('all-or-nothing: reasoning omitted when ANY call lacks it', pu.reasoning === null, 'got ' + pu.reasoning);
check('input omitted too (cannot guess a cache miss)', pu.input === null, 'got ' + pu.input);
check('prompt/completion still exact', pu.prompt === 300 && pu.completion === 30);
check('total still available', pu.total === 330);

console.log('=== 3) malformed records are refused, not guessed ===');
const junk = [
  { type: 'assistant/usage', seq: 1, time: 'x', data: { prompt_tokens: '664', completion_tokens: 171 } },
  { type: 'assistant/usage', seq: 2, time: 'x', data: { prompt_tokens: 664 } },
  { type: 'assistant/usage', seq: 3, time: 'x', data: { prompt_tokens: -1, completion_tokens: 5 } },
  { type: 'assistant/usage', seq: 4, time: 'x', data: { prompt_tokens: 1e308, completion_tokens: 1e308 } }
];
check('all-malformed stream -> null', PT.derivePeriodUsage(junk) === null);
const mixed = [{ type: 'assistant/usage', seq: 1, time: 'x', data: { prompt_tokens: 664, completion_tokens: 171, cached_tokens: 256, reasoning_tokens: 148 } }].concat(junk);
const mu = PT.derivePeriodUsage(mixed);
check('malformed rows are skipped, valid one survives', mu !== null && mu.calls === 1 && mu.prompt === 664, JSON.stringify(mu));

console.log('=== 4) fmtTok distinguishes absent from zero ===');
check('null -> em dash', PT.fmtTok(null) === '—');
check('undefined -> em dash', PT.fmtTok(undefined) === '—');
check('0 -> "0" (a fact, not absence)', PT.fmtTok(0) === '0', 'got ' + JSON.stringify(PT.fmtTok(0)));
check('664 -> grouped', PT.fmtTok(664) === '664');

console.log('=== 5) the metering event must NOT disturb existing durations ===');
const withUsage = PT.buildSession(events, { job_id: 'replay' });
const withoutUsage = PT.buildSession(events.filter(function (e) { return e.type !== 'assistant/usage'; }), { job_id: 'replay' });
const durOf = function (s) {
  return s.filter(function (r) { return r.kind === 'ev'; })
    .map(function (r) { return r.type + ':' + r.dur; });
};
const a = durOf(withUsage).join(',');
const b = durOf(withoutUsage).join(',');
check('dur sequence identical with/without usage events', a === b, a + ' vs ' + b);
check('usage events are not rendered as rows', withUsage.every(function (r) { return r.kind !== 'ev' || r.type !== 'USAGE'; }));
check('session row count == rendered event count', withUsage.length === withoutUsage.length);

console.log('=== 6) the deliverable row carries the period total ===');
const replyRows = withUsage.filter(function (r) { return r.kind === 'ev' && r.type === 'REPLY'; });
check('exactly one REPLY row', replyRows.length === 1, 'got ' + replyRows.length);
if (replyRows.length === 1) {
  check('REPLY.tok == derived total', replyRows[0].tok === u.total, replyRows[0].tok + ' vs ' + u.total);
}
const nonReply = withUsage.filter(function (r) { return r.kind === 'ev' && r.type !== 'REPLY'; });
check('only REPLY rows carry tok', nonReply.every(function (r) { return r.tok === null; }));

console.log('');
console.log(failures === 0 ? 'RESULT: PASS (all checks green)' : 'RESULT: FAIL (' + failures + ' checks failed)');
process.exit(failures === 0 ? 0 : 1);
