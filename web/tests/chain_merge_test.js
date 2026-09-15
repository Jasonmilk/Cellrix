/* mergeChain tests (L0 — the view-layer session reconstruction).
 *
 * The bug this exists to prevent: normalising each period separately restarts
 * gseq at 0 for every file, so the keys collide and every period after the
 * first is refused as a duplicate. Same failure as chunked normalisation,
 * one scale up. The mutation below is that exact mistake, and it must go red.
 *
 * Usage: node chain_merge_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const A = path.join(__dirname, '..', 'assets');
global.window = {};
eval(fs.readFileSync(path.join(A, 'event_family.js'), 'utf8'));
eval(fs.readFileSync(path.join(A, 'period_normalize.js'), 'utf8'));
eval(fs.readFileSync(path.join(A, 'assembly.js'), 'utf8'));

const NORM = global.window.CxNormalize;
const ASM = global.window.CxAssembly;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

/* Six periods, eight events each, every one numbered 0..7 — which is what the
 * producer actually emits: seq is per-period. */
function period(n, text) {
  const ev = (t, s, d) => ({ type: t, seq: s, time: '2026-09-16T00:0' + n + ':0' + s + 'Z', data: d || {} });
  return [
    ev('turn/start', 0),
    ev('user/message', 1, { text: text }),
    ev('assistant/think', 2, { text: 'h' }),
    // required fields come from the frozen contract in event_family.js:
    // reply needs chars, usage needs both token counts, tool/call needs
    // index+expect, tool/result needs duration_ms. Missing any of them is
    // refused as invalid — measured, not guessed.
    ev('assistant/reply', 3, { text: 'r' + n, chars: 2 }),
    ev('assistant/usage', 4, { prompt_tokens: 1, completion_tokens: 1 }),
    ev('tool/call', 5, { tool: 'x', index: 0, expect: 'string' }),
    ev('tool/result', 6, { tool: 'x', ok: true, duration_ms: 1, outcome: 'o' }),
    ev('turn/end', 7, { done: true, success: true, impasse: false, reply: 'r' + n, model: null })
  ];
}

const jobs = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'];
const byJob = {};
jobs.forEach(function (j, i) { byJob[j] = period(i + 1, 'q' + (i + 1)); });

// ---------------------------------------------------------------- the merge
const merged = NORM.mergeChain(byJob, jobs);
check('six periods of eight events merge to 48', merged.events.length === 48,
  String(merged.events.length));
check('the merged stream has no diagnostics', merged.diagnostics.ok === true,
  JSON.stringify(merged.diagnostics));
check('jobCount reports six', merged.jobCount === 6, String(merged.jobCount));

// gseq must be contiguous across files, not restart per file
const gseqs = merged.events.map(function (e) { return e.gseq; });
check('gseq runs 0..47 with no repeat',
  gseqs.length === 48 && gseqs.every(function (g, i) { return g === i; }),
  gseqs.slice(0, 10).join(',') + '...');

// turn must increment across files: period 2 opens at t2, not t1
const turns = merged.events.map(function (e) { return e.turn; });
const distinctTurns = turns.filter(function (t, i) { return i === 0 || turns[i - 1] !== t; });
check('turn is contiguous across files (six turns, not six restarts)',
  JSON.stringify(distinctTurns) === JSON.stringify([1, 2, 3, 4, 5, 6]),
  JSON.stringify(distinctTurns));

// every event knows which period it came from
check('every event carries a non-enumerable sourceJob',
  merged.events.every(function (e, i) { return e.sourceJob === jobs[Math.floor(i / 8)]; }),
  merged.events[0].sourceJob + ' ... ' + merged.events[47].sourceJob);
check('sourceJob does not appear in the serialised shape',
  JSON.stringify(merged.events[0]).indexOf('sourceJob') === -1);

// ------------------------------------------------- the whole point: assembly
const a = ASM.create();
const accepted = a.feed(merged.events);
check('assembly accepts all 48 events', accepted === 48, String(accepted));
check('assembly refuses none',
  a.rejections().total === 0, JSON.stringify(a.rejections().counts));
check('48 unique node ids',
  new Set(a.coordinates({ job_id: 'sess' }).map(function (c) { return c.node; })).size === 48);

/* MUTATION — the mistake the reviewer named: normalise each period separately,
 * then feed. It must be refused, or this test is not testing anything. */
{
  const b = ASM.create();
  let n = 0;
  jobs.forEach(function (j) {
    const one = NORM.normalize(byJob[j], { job_id: j });
    n += b.feed(one.events);
  });
  check('MUTATION: per-period normalisation is refused (gseq collides)',
    n < 48 && b.rejections().total > 0,
    'accepted=' + n + ' refused=' + b.rejections().total);
}

// ------------------------------------------------------------ chain direction
//
// resume_from points backwards, so collecting from the newest yields
// newest-first. Without the explicit sort the conversation renders in reverse,
// with every assertion above still green — the point of these two.
{
  // A chain of four, in the shape the producer emits: each period names its
  // predecessor, and the newest was created last.
  const chainPeriods = [
    { job_id: 'p4', parent: 'p3', first_ts: '2026-09-16T04:00:00Z' },
    { job_id: 'p3', parent: 'p2', first_ts: '2026-09-16T03:00:00Z' },
    { job_id: 'p2', parent: 'p1', first_ts: '2026-09-16T02:00:00Z' },
    { job_id: 'p1', parent: null, first_ts: '2026-09-16T01:00:00Z' }
  ];
  const ordered = NORM.chainJobIds(chainPeriods, 'p4');
  check('chainJobIds returns the whole chain', ordered.length === 4, JSON.stringify(ordered));
  check('chainJobIds is OLDEST FIRST (the root leads)',
    ordered[0] === 'p1', JSON.stringify(ordered));
  check('chainJobIds ends at the period we asked from',
    ordered[ordered.length - 1] === 'p4', JSON.stringify(ordered));

  // Asking from the middle must give the same chain, same order.
  const fromMiddle = NORM.chainJobIds(chainPeriods, 'p2');
  check('asking from the middle yields the same order',
    JSON.stringify(fromMiddle) === JSON.stringify(ordered), JSON.stringify(fromMiddle));

  // MUTATION: newest-first, the naive walk. Must disagree with the assertions.
  const naive = ['p4', 'p3', 'p2', 'p1'];
  check('MUTATION: newest-first disagrees with the direction assertions',
    naive[0] !== 'p1' && JSON.stringify(naive) !== JSON.stringify(ordered));
}

// ------------------------------------------------- single period (the common case)
//
// 91 periods, 63 roots: most have no chain at all. This path must not be
// special-cased into behaving differently.
{
  const solo = { s1: period(9, 'alone') };
  const m = NORM.mergeChain(solo, ['s1']);
  const direct = NORM.normalize(solo.s1, { job_id: 's1' });
  check('a single period merges to the same length as normalize',
    m.events.length === direct.events.length,
    m.events.length + ' vs ' + direct.events.length);
  check('a single period keeps the same order',
    JSON.stringify(m.events.map(function (e) { return e.seq; })) ===
    JSON.stringify(direct.events.map(function (e) { return e.seq; })));
  check('a single period differs from normalize only by sourceJob',
    m.events[0].sourceJob === 's1' && direct.events[0].sourceJob === undefined);
}

console.log('');
console.log(failures === 0 ? 'OK — all passed' : 'FAILED: ' + failures);
process.exit(failures === 0 ? 0 : 1);
