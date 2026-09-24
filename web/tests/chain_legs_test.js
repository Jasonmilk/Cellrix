#!/usr/bin/env node
/* The chain's INTEGRITY, asserted over real recordings.
 *
 * The chain can look complete while no turn has ever exercised its middle: every
 * port answers, every lamp is lit, and `assistant/attempt` says "no calls planned"
 * on every turn because nothing ever asked the executor for anything. Coverage
 * ("was this leg used?") is reported; what is ASSERTED here is soundness — the
 * pairings and the verdicts that must not disagree with themselves.
 *
 * Each assertion reads recordings under `EV`; a leg with no recording at all is a
 * MISSING INPUT with its reason, never a silent pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* The workspace root, not `$HOME`: the recordings live beside the repos, and
 * deriving from the file's own location is what `proto_contract_test.js` does. */
const WS = path.resolve(__dirname, '..', '..', '..');
const EV = process.env.CELLRIX_EVENTS || path.join(WS, '.helix', 'events');

let pass = 0, fail = 0, skipped = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}
function skip(label, why) { skipped++; console.log('  SKIP  ' + label + '  -> ' + why); }

/* `CHAIN_SINCE` (epoch seconds) restricts this to the recordings THIS run just
 * wrote. Without it the criterion aggregates over all history, so a leg exercised
 * once — last week, or by the previous execution — keeps satisfying it and the
 * red case can never be red. Measured 2026-09-24: `tool` and `text` both passed
 * until the history was cut out of the picture. */
const SINCE = Number(process.env.CHAIN_SINCE || 0);
let files = [];
try {
  files = fs.readdirSync(EV).filter(function (f) {
    if (!f.endsWith('.events.jsonl')) { return false; }
    if (!SINCE) { return true; }
    try { return fs.statSync(path.join(EV, f)).mtimeMs >= SINCE * 1000; } catch (e) { return false; }
  });
} catch (e) { /* absent */ }
if (!files.length) {
  console.log('NEEDS-INPUT: 需要真实事件文件 ' + EV + '/*.events.jsonl（先跑一个回合：见 README 的 E2E 步骤）');
  process.exit(3);
}
const recs = files.map((f) => ({
  file: f,
  rows: fs.readFileSync(path.join(EV, f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
}));
const all = recs.flatMap((r) => r.rows);
const byType = (t) => all.filter((r) => r.type === t);

console.log('-- what the recordings prove --' + (SINCE ? ' (since ' + SINCE + ')' : ''));
const legs = [
  ['memory', 'context/inject with nodes', byType('context/inject').some((r) => (r.data || {}).nodes > 0)],
  ['reasoning', 'assistant/attempt', byType('assistant/attempt').length > 0],
  ['executor', 'tool/call + tool/result', byType('tool/call').length > 0 && byType('tool/result').length > 0],
  ['judgement', 'check/status + verdict/status', byType('check/status').length > 0 && byType('verdict/status').length > 0],
  ['metering', 'assistant/usage (disjoint)', byType('assistant/usage').length > 0],
  ['routing', 'a routed model name', all.some((r) => (r.data || {}).model)],
];
/* Coverage alone can only SKIP: a machine may legitimately hold no recording of a
 * leg. But an END-TO-END RUN knows which legs it just asked for, and for those an
 * absent leg is the finding itself. `CHAIN_REQUIRE=executor,metering` is how the
 * one-command E2E turns "not proven" into red — without it, `MOCK_MODE=text`
 * (which plans no tool call) would leave this suite green and prove nothing. */
const REQUIRED = (process.env.CHAIN_REQUIRE || '').split(',').map((x) => x.trim()).filter(Boolean);
for (const [key, name, seen] of legs) {
  if (seen) { pass++; console.log('  PASS  leg exercised: ' + name); }
  else if (REQUIRED.indexOf(key) > -1) {
    fail++; console.log('  FAIL  leg REQUIRED by this run was never exercised: ' + name);
  } else { skip('leg exercised: ' + name, 'no recording under ' + EV + ' shows it'); }
}
console.log('');
/* BODY MATCHING. Selecting recordings by EVENT TYPE alone means a recording from
 * an earlier turn — a different question — can satisfy a criterion about THIS one;
 * the suite then answers every new question with an old answer and stays green.
 * The window (`CHAIN_SINCE`) cuts by time; this cuts by content. */
{
  const WANT = process.env.CHAIN_PROMPT || '';
  if (!WANT) { skip('the recordings answer the prompt this run sent', 'CHAIN_PROMPT not given'); }
  else {
    const said = byType('user/message').map(function (r) { return (r.data || {}).text; });
    check('the recordings answer the prompt this run sent',
      said.length > 0 && said.every(function (t) { return t === WANT; }),
      said.length ? JSON.stringify(said.slice(0, 3)) + ' vs ' + JSON.stringify(WANT) : 'no user/message');
  }
}

console.log('-- soundness (these are assertions, not coverage) --');

/* 1. A tool call and its result are a PAIR. A call with no result is a request
 *    that vanished; a result with no call is an answer to nothing. */
{
  const calls = byType('tool/call'), results = byType('tool/result');
  const key = (r) => (r.period_id || '') + '#' + (r.data || {}).index;
  const ck = new Set(calls.map(key)), rk = new Set(results.map(key));
  const orphanCalls = [...ck].filter((k) => !rk.has(k));
  const orphanResults = [...rk].filter((k) => !ck.has(k));
  if (!calls.length) { skip('every tool call has a result', 'no tool/call in the recordings'); }
  else {
    check('every tool call has a result', orphanCalls.length === 0, orphanCalls.join(', ') || calls.length + ' pair(s)');
  }
  if (results.length) {
    check('every tool result answers a call', orphanResults.length === 0, orphanResults.join(', ') || results.length + ' pair(s)');
  }
}

/* 2. A verdict must not contradict its own checks. This is CI-144 §2's first hard
 *    constraint seen from the data side: "pass" may not be inferred from an
 *    intermediate Ok — here, a `Met` beside a failing check would be exactly that. */
{
  const vs = byType('verdict/status');
  if (!vs.length) { skip('a Met verdict has no failing check', 'no verdict/status in the recordings'); }
  else {
    const bad = vs.filter((v) => {
      const pid = v.period_id;
      const pre = byType('check/status').filter((c) => c.period_id === pid);
      const failed = pre.filter((c) => String((c.data || {}).actual || '').indexOf('=false') > -1
        || /fail/i.test(String((c.data || {}).expect || '')));
      return String((v.data || {}).status) === 'Met' && failed.length > 0;
    });
    check('a Met verdict has no failing check', bad.length === 0,
      bad.length ? bad.map((b) => b.period_id).join(', ') : vs.length + ' verdict(s)');
  }
}

/* 3. The metering facts stay disjoint: a usage row that reported prompt and
 *    completion must have both as numbers, never a derived total stuffed into one. */
{
  const us = byType('assistant/usage');
  if (!us.length) { skip('usage carries both disjoint counts', 'no assistant/usage in the recordings'); }
  else {
    const bad = us.filter((r) => {
      const d = r.data || {};
      return typeof d.prompt_tokens !== 'number' || typeof d.completion_tokens !== 'number';
    });
    check('usage carries both disjoint counts', bad.length === 0,
      bad.length ? bad.length + ' row(s) without both counts' : us.length + ' row(s)');
  }
}

console.log('');
console.log(fail === 0
  ? 'OK — ' + pass + ' checks green' + (skipped ? ', ' + skipped + ' unproven (no recording)' : '')
  : 'FAILED — ' + fail + ' of ' + (pass + fail) + ' red');
process.exit(fail === 0 ? 0 : 1);
