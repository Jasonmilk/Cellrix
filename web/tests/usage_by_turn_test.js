/* usage_by_turn_test — THE AGGREGATE'S GRANULARITY MUST MATCH THE CLAIM'S (ADR-0048 §183).
 *
 * Measured before: a period total was written into turn[0], so a two-turn session (A: 5, B: 7)
 * rendered "12 tok" on A and "· 无数据" on B — a false statement and a resurrection of the symptom
 * we had just removed. ISO 9075 GROUP BY: a SUM that is correct at period grain is not thereby
 * correct at turn grain. Kimball: `completion` is ADDITIVE, so per-turn grouping is legal — which
 * gives a self-check: Σ(per-turn) == period, or something is being attributed to the wrong window.
 */
const fs = require('fs'), path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('NEEDS-INPUT: jsdom 未安装'); process.exit(3); }
const AP = require('./assemble_page.js');

/* two turns, each with its own usage event (the real shape the assembly accepts) */
const EVENTS = [
  { type: 'turn/start', data: {} },
  { type: 'assistant/usage', data: { prompt_tokens: 9, completion_tokens: 5, model: 'm' } },
  { type: 'turn/end', data: { done: true, success: true, impasse: false } },
  { type: 'turn/start', data: {} },
  { type: 'assistant/usage', data: { prompt_tokens: 11, completion_tokens: 7, model: 'm' } },
  { type: 'turn/end', data: { done: true, success: true, impasse: false } }
];

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

const w = new JSDOM(AP.assemble().html, { runScripts: 'dangerously', url: 'http://127.0.0.1:1/' }).window;
const st = w.CxAssembly.create(); st.register('p', { name: 'p' }); st.activate('p');
st.feed(EVENTS.map((e, i) => Object.assign(
  { seq: i + 1, time: '2026-01-01T00:00:0' + i + 'Z', job_id: 'fx', period_id: 'fx' }, e)));
const NODES = (st.snapshot() && (st.snapshot().nodes || st.snapshot())) || [];
const rows = w.CxProveTrack.node.buildSession(NODES);
const byTurn = w.CxProveTrack.node.usageByTurn(NODES);
const period = w.CxProveTrack.node.derivePeriodUsage(NODES);
const proj = w.CxCellMetering.project(rows, { usage: period, usageByTurn: byTurn });
w.close();

const turns = proj.turns || [];
const per = turns.map((t) => (t.tok && t.tok.k === 'p' ? t.tok.v : null));
ok(turns.length === 2, 'the session really has two turns (' + turns.length + ')');
ok(per[0] === 5, 'turn A shows ITS OWN 5, not the period total  [' + per[0] + ']');
ok(per[1] === 7, 'turn B shows ITS OWN 7 instead of "· 无数据"  [' + per[1] + ']');
ok(proj.tok && proj.tok.k === 'p' && proj.tok.v === 12, 'the period total stays 12  [' + (proj.tok && proj.tok.v) + ']');
ok(per[0] + per[1] === (proj.tok && proj.tok.v),
  'SELF-CHECK: Σ(per-turn) == period (' + per[0] + ' + ' + per[1] + ' == ' + (proj.tok && proj.tok.v) + ')');

/* MUTATION: the previous behaviour (turn 0 absorbs the period, later turns fall back to the fold) */
const w2 = new JSDOM(AP.assemble().html, { runScripts: 'dangerously', url: 'http://127.0.0.1:1/' }).window;
const p2 = w2.CxCellMetering.project(rows, { usage: period });   /* no usageByTurn ⇒ old path */
const per2 = (p2.turns || []).map((t) => (t.tok && t.tok.k === 'p' ? t.tok.v : null));
ok(per2[0] === 12 && per2[1] === null,
  'MUTATION: without per-turn attribution turn A absorbs 12 and B reads "无数据" — exactly the bug  ['
  + per2[0] + ', ' + per2[1] + ']');
w2.close();
console.log(bad === 0 ? 'OK — each turn is told what it spent, and the parts still sum to the whole'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
