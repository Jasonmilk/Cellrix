/* Assembly layer tests (Cellrix:ADR-0018 T2).
 *
 * Pure-logic harness: the assets are browser IIFEs that only touch `window`,
 * so they load under node with a one-line shim. No browser, no mocks.
 *
 * Usage: node assembly_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = {};
const A = path.join(__dirname, '..', 'assets');
eval(fs.readFileSync(path.join(A, 'event_family.js'), 'utf8'));
eval(fs.readFileSync(path.join(A, 'period_normalize.js'), 'utf8'));
eval(fs.readFileSync(path.join(A, 'node_shape.js'), 'utf8'));
eval(fs.readFileSync(path.join(A, 'assembly.js'), 'utf8'));
const ASM = global.window.CxAssembly;
const NORM = global.window.CxNormalize;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

/* Build one event. seq is explicit because the whole point is that the tape —
 * not arrival order — decides the result. */
function ev(type, seq, data) {
  return { type: type, seq: seq, time: '2026-09-15T00:00:00Z', data: data || {} };
}

/* A small but complete window: two turns, the second one still open. */
/* UNREAL: seq is globally unique here (1..6). Real periods restart seq at 0
 * each turn — see the MULTI-TURN clause below, which feeds the real shape and
 * currently fails.
 *
 * This fixture exercises single-sequence mechanics only. It must NOT be read
 * as evidence that multi-turn works: the "second turn is t2" assertion below
 * passes against it, and that pass means nothing about a real period. */
const WINDOW_SINGLE_SEQ = [
  ev('turn/start', 1),
  ev('user/message', 2, { text: 'hi' }),
  ev('assistant/think', 3, { text: 'hmm' }),
  ev('turn/end', 4, { done: true, success: true, impasse: false, reply: 'ok', model: null }),
  ev('turn/start', 5),
  ev('user/message', 6, { text: 'again' })
];

console.log('assembly layer ' + ASM.VERSION + ' (T2)');

// ---- D4: pending until a turn/start exists
{
  const a = ASM.create();
  a.feed([ev('user/message', 1, { text: 'x' })]);
  check('pending without a turn/start', a.status() === 'pending', a.status());
  a.feed([ev('turn/start', 2)]);
  check('ready once a turn/start arrives', a.status() === 'ready', a.status());
}

// ---- acceptance 1: replaying the same window is idempotent
{
  const a = ASM.create();
  a.feed(WINDOW_SINGLE_SEQ);
  const first = a.digest();
  a.feed(WINDOW_SINGLE_SEQ);
  check('replay of the same window is idempotent', a.digest() === first,
    first + ' vs ' + a.digest());
}

// ---- acceptance 9: split invariance — replay(k) + live(k..n) == replay(all)
{
  const all = ASM.create(); all.feed(WINDOW_SINGLE_SEQ);
  let ok = true;
  let detail = '';
  for (let k = 0; k <= WINDOW_SINGLE_SEQ.length; k++) {
    const split = ASM.create();
    split.feed(WINDOW_SINGLE_SEQ.slice(0, k));
    split.feed(WINDOW_SINGLE_SEQ.slice(k));
    if (split.digest() !== all.digest()) { ok = false; detail = 'k=' + k; break; }
  }
  check('split invariance (acceptance 9)', ok, detail);
}

// ---- acceptance 4: an earlier page arriving late is an insert, not a rewind
{
  const a = ASM.create();
  a.feed(WINDOW_SINGLE_SEQ.slice(2));
  const wmBefore = a.watermark();
  a.feed(WINDOW_SINGLE_SEQ.slice(0, 2));
  check('late earlier page does not lower the watermark', a.watermark() === wmBefore,
    wmBefore + ' -> ' + a.watermark());
  const seqs = a.events().map(function (e) { return e.seq; });
  const sorted = seqs.slice().sort(function (x, y) { return x - y; });
  check('late earlier page keeps the tape seq-ordered',
    JSON.stringify(seqs) === JSON.stringify(sorted), JSON.stringify(seqs));
  check('late earlier page is still counted',
    a.events().length === WINDOW_SINGLE_SEQ.length, String(a.events().length));
}

// ---- acceptance 10: chunk invariance
{
  const all = ASM.create(); all.feed(WINDOW_SINGLE_SEQ);
  let ok = true, detail = '';
  [1, 3, 7, WINDOW_SINGLE_SEQ.length].forEach(function (size) {
    const a = ASM.create();
    for (let i = 0; i < WINDOW_SINGLE_SEQ.length; i += size) {
      a.feed(WINDOW_SINGLE_SEQ.slice(i, i + size));
    }
    if (a.digest() !== all.digest()) { ok = false; detail = 'chunk=' + size; }
  });
  check('chunk invariance (acceptance 10)', ok, detail);
}

// ---- acceptance 8: purity — same tape twice, byte-identical result
{
  const coordsA = ASM.deriveCoordinates(WINDOW_SINGLE_SEQ, { job_id: 'j1' });
  const coordsB = ASM.deriveCoordinates(WINDOW_SINGLE_SEQ, { job_id: 'j1' });
  check('deriveCoordinates is a pure function',
    JSON.stringify(coordsA) === JSON.stringify(coordsB));
}

// ---- D3: idempotent upsert on (kind, id)
{
  const state = {};
  ASM.upsert(state, { kind: 'turn', id: 't1', note: 'first' });
  ASM.upsert(state, { kind: 'turn', id: 't1', note: 'second' });
  check('upsert replaces rather than appends',
    Object.keys(state).length === 1 && state['turn\u0000t1'].note === 'second',
    JSON.stringify(state));
}

// ---- coordinates come from the tape, not from arrival order
{
  const forward = ASM.deriveCoordinates(WINDOW_SINGLE_SEQ, { job_id: 'j1' });
  const shuffled = WINDOW_SINGLE_SEQ.slice().reverse();
  const a = ASM.create();
  a.feed(shuffled);
  const viaTape = a.coordinates({ job_id: 'j1' });
  check('coordinates ignore arrival order',
    JSON.stringify(viaTape) === JSON.stringify(forward),
    JSON.stringify(viaTape.map(function (c) { return c.seq; })));
  check('turn numbers are ordinal (second turn is t2)',
    viaTape[5].turn === 't2', viaTape[5].turn);
  check('node ids are job-scoped',
    viaTape[0].node === 'j1#1', viaTape[0].node);
}

// ---- unknown / malformed events never enter the tape
{
  const a = ASM.create();
  a.feed([{ type: 'nope/nope', seq: 1, time: 't', data: {} },
          { type: 'turn/start', seq: 2, time: 't', data: {} },
          null]);
  check('malformed events are rejected, not counted',
    a.events().length === 1, String(a.events().length));
  check('unknown type does not become a turn',
    a.coordinates()[0].turn === 't1', a.coordinates()[0].turn);
}

// ---- the renderer's type table is a subset of the contract's vocabulary
//
// Not derived: a renderer needs `track` and a validator does not, so one table
// cannot serve both without letting UI concerns dictate the contract. What
// must hold is that the renderer never names a type the contract does not
// know — otherwise a render row exists for an event the tape will refuse.
{
  // the renderer table lives in prove_track.data.js; it needs CxAssembly, which
  // is already loaded above
  eval(fs.readFileSync(path.join(A, 'prove_track.data.js'), 'utf8'));
  const PT = global.window.CxProveTrack;
  const EFX = global.window.CxEventFamily;
  const unknown = Object.keys(PT.TYPES).filter(function (k) { return !EFX.isKnownType(k); });
  check('renderer types are all known to the contract', unknown.length === 0,
    JSON.stringify(unknown));
}

const EFX = global.window.CxEventFamily;

// ---- MULTI-TURN (RED until the seq work lands)
//
// The fixture above numbers its events 1..6, one global sequence, so "second
// turn is t2" passed while real periods were rejected wholesale — a green
// assertion proving a false conclusion.
//
// A real period restarts seq at 0 each turn (measured: run-7efbf0f8 has
// 0..10 five times). This clause feeds that shape and is EXPECTED TO FAIL
// until `comparePosition`, the dedupe key and the watermark all learn about
// turn together. Red here means "the fix is not in yet" — not "the test is
// wrong". It is the only thing standing between us and believing multi-turn
// already works.
{
  const a = ASM.create();
  const twoTurns = [
    ev('turn/start', 0), ev('user/message', 1, { text: 'q1' }),
    ev('assistant/reply', 2, { text: 'a1', chars: 2 }),
    ev('turn/end', 3, { done: true, success: true, impasse: false }),
    ev('turn/start', 0), ev('user/message', 1, { text: 'q2' }),
    ev('assistant/reply', 2, { text: 'a2', chars: 2 }),
    ev('turn/end', 3, { done: true, success: true, impasse: false })
  ];
  /* Through the REAL read boundary. The spike hand-assigned gseq, which was
   * fairly criticised: that tests the consumer with an input no caller
   * produces. */
  a.feed(NORM.normalize(twoTurns, { job_id: 'j1' }).events);
  const rej = a.rejections();
  check('MULTI-TURN: a second turn is not refused as duplicate (RED = fix pending)',
    rej.total === 0, JSON.stringify(rej.counts));
  check('MULTI-TURN: every event of both turns reaches the tape (RED = fix pending)',
    a.events().length === twoTurns.length,
    a.events().length + ' of ' + twoTurns.length);
  const nodes = a.coordinates({ job_id: 'j1' }).map(function (c) { return c.node; });
  check('MULTI-TURN: node ids are unique across turns (RED = fix pending)',
    new Set(nodes).size === twoTurns.length,
    new Set(nodes).size + ' unique of ' + nodes.length);
}

// ---- gseq + back-fill: the invariant gseq exists for
//
// Until now the back-fill assertions ran only on the single-sequence fixture,
// i.e. through the fallback path. The invariant gseq is meant to protect was
// never exercised in the mode that uses it.
{
  const rows = [
    ev('turn/start', 0), ev('user/message', 1, { text: 'q1' }),
    ev('turn/start', 0), ev('user/message', 1, { text: 'q2' })
  ];
  /* Normalised ONCE on the complete stream; the chunks fed below are slices of
   * that normalised array, not separately normalised. Doing it per chunk
   * restarts gseq at 0 and collides — measured while writing this. */
  const norm = NORM.normalize(rows, { job_id: 'j1' }).events;
  const whole = ASM.create();
  whole.feed(norm);
  const back = ASM.create();
  back.feed(norm.slice(2));       // later half first
  back.feed(norm.slice(0, 2));    // then the earlier half
  check('gseq: back-fill converges to the same tape',
    back.digest() === whole.digest(), back.digest() + ' vs ' + whole.digest());
  const nw = whole.coordinates({ job_id: 'j1' }).map(function (c) { return c.node; }).sort();
  const nb = back.coordinates({ job_id: 'j1' }).map(function (c) { return c.node; }).sort();
  check('gseq: existing node ids survive back-fill unchanged',
    JSON.stringify(nw) === JSON.stringify(nb), JSON.stringify(nb));
  /* gseqFallback is module-level, so other fixtures in this file have already
   * contributed to it. The delta is the fact; the absolute value is not. */
  const fbBefore = ASM.create().diagnostics().gseqFallback;
  const probe = ASM.create();
  probe.feed(norm);
  check('gseq: a normalised feed adds no fallback',
    probe.diagnostics().gseqFallback === fbBefore,
    fbBefore + ' -> ' + probe.diagnostics().gseqFallback);
}

// ---- the fallback counter has its own negative test
//
// A guard whose counter has never been seen to move is indistinguishable from
// one that cannot move.
{
  const a = ASM.create();
  const before = a.diagnostics().gseqFallback;
  a.feed([ev('turn/start', 0), ev('user/message', 1, { text: 'raw' })]);
  const after = a.diagnostics().gseqFallback;
  check('gseq: raw events raise the fallback counter (guard is testable)',
    after - before === 2, 'delta=' + (after - before));
}

// ---- a REAL period slice (the shape that was never in the net)
//
// Sliced from a real period file, two complete turns. Every fixture before this
// was synthetic, and the synthetic ones numbered seq globally — which is
// precisely how the multi-turn bug stayed invisible: the net agreed with a
// shape the producer never emits.
{
  const real = [
  {"type": "turn/start", "seq": 0, "time": "2026-09-08T21:11:53Z", "data": {}},
  {"type": "user/message", "seq": 1, "time": "2026-09-08T21:11:53Z", "data": {"text": "现在北京天气怎么样？"}},
  {"type": "context/inject", "seq": 2, "time": "2026-09-08T21:11:53Z", "data": {"chars": 800, "nodes": 0}},
  {"type": "assistant/think", "seq": 3, "time": "2026-09-08T21:11:54Z", "data": {"text": "我们 need answer user. Need follow identity? User asks weather Beijing now. We have tools available: web_search. Need use tool before guessing. Need end reply with only JSON call? The instruction says when need tool end reply with ONLY {\"calls\":...} no prose. We need make tool call. Need determine query. We'll call web_search for \"北京天气 现在\". Need top-N. Expect ok. So final with JSON only."}},
  {"type": "assistant/attempt", "seq": 4, "time": "2026-09-08T21:11:54Z", "data": {"empty": false, "text": "{\"calls\":[{\"tool\":\"web_search\",\"args\":{\"query\":\"北京天气 现在 2026-09-09\"},\"expect\":\"ok\"}]}"}},
  {"type": "tool/call", "seq": 5, "time": "2026-09-08T21:11:56Z", "data": {"expect": "ok", "index": 0, "tool": "web_search"}},
  {"type": "tool/result", "seq": 6, "time": "2026-09-08T21:11:56Z", "data": {"duration_ms": 1407, "index": 0, "ok": true, "outcome": "{\"ok\":true,\"results\":[{\"title\":\"McAfee AI-Powered Antivirus, Scam, Identity, and Privacy ...\",\"url\":\"https://www.bing.com/ck/a?!&amp;&amp;p=66584a8776c984b2fe473160dbc99c9b9964a4d584d3013ee6588b393c9c41b4JmltdHM9MTc4ODgyNTYwMA&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;fclid=149b6866-154f-6e9a-3b37-7fa814126f92&amp;u=a1aHR0cHM6Ly93d3cubWNhZmVlLmNvbS8_bXNvY2tpZD0xNDliNjg2NjE1NGY2ZTlhM2IzNzdmYTgxNDEyNmY5Mg&amp;ntb=1\"},{\"title\":\"Download and Install our Award Winning Products | McAfee\",\"url\":\"https://www.bing.com/ck/a?!&amp;&amp;p=746abcfde5d64f1bb0f4211d5c4fc1e6fe8843911fa5164da706f0fa1a11eda8JmltdHM9MTc4ODgyNTYwMA&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;fclid=149b6866-154f-6e9a-3b37-7fa814126f92&amp;u=a1aHR0cHM6Ly93d3cubWNhZmVlLmNvbS9lbi11cy9hbnRpdmlydXMvZG93bmxvYWRzLmh0bWw_bXNvY2tpZD0xNDliNjg2NjE1NGY2ZTlhM2IzNzdmYTgxNDEyNmY5Mg&amp;ntb=1\"},{\"title\":\"Antivirus Software and Internet Security For Your PC ... - McAfee\",\"url\":\"https://www.bing.com/ck/a?!&amp;&amp;p=a442970adf40bdd287cbce605f3ccfc4d485b5c890715805b7aa6fc2191506ffJmltdHM9MTc4ODgyNTYwMA&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;fclid=149b6866-154f-6e9a-3b37-7fa814126f92&amp;u=a1aHR0cHM6Ly9teWFjY291bnQubWNhZmVlLmNvbS92Mi8&amp;ntb=1\"},{\"title\":\"McAfee - Wikipedia\",\"url\":\"https://www.bing.com/ck/a?!&amp;&amp;p=6393bf1d3454fa2046f1b782266d6e675d9ed82312fa2cdfe7c976610b5b4420JmltdHM9MTc4ODgyNTYwMA&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;fclid=149b6866-154f-6e9a-3b37-7fa814126f92&amp;u=a1aHR0cHM6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvTWNBZmVl&amp;ntb=1\"},{\"title\":\"How to Get Rid of Fake McAfee Virus Pop-Ups - Cybernews\",\"url\":\"https://www.bing.com/ck/a?!&amp;&amp;p=4d038a559e92d04d11c1f3e847600414dc8411c16b338de0017a14ffa6eb3c5bJmltdHM9MTc4ODgyNTYwMA&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;fclid=149b6866-154f-6e9a-3b37-7fa814126f92&amp;u=a1aHR0cHM6Ly9jeWJlcm5ld3MuY29tL21hbHdhcmUvcmVtb3ZlLW1jYWZlZS12aXJ1cy1wb3AtdXBzLw&amp;ntb=1\"}]}", "outcome_sha": "1b6b783c", "tool": "web_search"}},
  {"type": "check/status", "seq": 7, "time": "2026-09-08T21:11:56Z", "data": {"actual": "ok=true", "check": "exec_ok", "check_id": "run-7efbf0f8aacf96d5#c0", "evidence_id": "run-7efbf0f8aacf96d5#0", "expect": "ok", "gate": "hard", "judge": "rule", "passed": true, "reason": "ok=true"}},
  {"type": "check/status", "seq": 8, "time": "2026-09-08T21:11:56Z", "data": {"actual": "no business result in tool return", "check": "answer.delivered", "check_id": "run-7efbf0f8aacf96d5#c1", "evidence_id": "run-7efbf0f8aacf96d5#0", "expect": "ok", "gate": "hard", "judge": "rule", "passed": false, "reason": "no business result in tool return"}},
  {"type": "verdict/status", "seq": 9, "time": "2026-09-08T21:11:56Z", "data": {"checks": 2, "job_id": "run-7efbf0f8aacf96d5", "reason": "failed: answer.delivered", "status": "Unmet"}},
  {"type": "turn/end", "seq": 10, "time": "2026-09-08T21:11:56Z", "data": {"done": true, "impasse": false, "success": false, "verdict": "Unmet"}},
  {"type": "turn/start", "seq": 0, "time": "2026-09-08T21:13:47Z", "data": {}},
  {"type": "user/message", "seq": 1, "time": "2026-09-08T21:13:47Z", "data": {"text": "现在北京天气怎么样？"}},
  {"type": "context/inject", "seq": 2, "time": "2026-09-08T21:13:47Z", "data": {"chars": 800, "choice": {"tiers": {"L1": 1, "L3": 1}, "top": [{"heat": 0.5, "id": "2dcd6a5f-9225-537f-966b-a0748e486767", "phase": "liquid", "tier": "L1"}, {"heat": 0.5, "id": "76b3755d-60b7-45db-b73d-fcf3a76e7d06", "phase": "liquid", "tier": "L3"}]}, "nodes": 2}},
  {"type": "assistant/think", "seq": 3, "time": "2026-09-08T21:13:49Z", "data": {"text": "我们需要 understand identity/rules. Need answer in Chinese. Need decide about tools. User asks Beijing weather now. We have time anchor 2026-09-09 05:13:47 +0800. Need know weather. We have web_search tool. But before big LLM use tools. We should call web_search likely for Beijing weather. Need end with only JSON calls if tool needed. Need not include prose? So need first maybe think? Need make call. We can use web_search args query. Need ensure deterministic. Let's call web_search."}},
  {"type": "assistant/attempt", "seq": 4, "time": "2026-09-08T21:13:49Z", "data": {"empty": false, "text": "{\"calls\":[{\"tool\":\"web_search\",\"args\":{\"query\":\"北京 天气 2026-09-09\"},\"expect\":\"ok\"}]}"}},
  {"type": "tool/call", "seq": 5, "time": "2026-09-08T21:13:50Z", "data": {"expect": "ok", "index": 0, "tool": "web_search"}},
  {"type": "tool/result", "seq": 6, "time": "2026-09-08T21:13:50Z", "data": {"duration_ms": 1039, "index": 0, "ok": true, "outcome": "{\"ok\":true,\"results\":[{\"title\":\"北京市_百度百科\",\"url\":\"https://www.bing.com/ck/a?!&amp;&amp;p=fbbb41d1091ed8937777119c608a593c0ba1e663dcf7be069c8674ad839c73c3JmltdHM9MTc4ODgyNTYwMA&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;fclid=227e699b-68ec-6011-0b24-7e5569ad6105&amp;u=a1aHR0cHM6Ly9iYWlrZS5iYWlkdS5jb20vaXRlbS8lZTUlOGMlOTclZTQlYmElYWMlZTUlYjglODIvMTI2MDY5&amp;ntb=1\"},{\"title\":\"北京市 - 维基百科，自由的百科全书\",\"url\":\"https://www.bing.com/ck/a?!&amp;&amp;p=5931807433e9548f6cfc05398e7213fd2b70ef250cafc83c5cfc880db4938c22JmltdHM9MTc4ODgyNTYwMA&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;fclid=227e699b-68ec-6011-0b24-7e5569ad6105&amp;u=a1aHR0cHM6Ly96aC53aWtpcGVkaWEub3JnL3dpa2kvJUU1JThDJTk3JUU0JUJBJUFDJUU1JUI4JTgy&amp;ntb=1\"},{\"title\":\"Beijing - 北京市人民政府门户网站\",\"url\":\"https://www.bing.com/ck/a?!&amp;&amp;p=99f533fdc25060c0a2bd6bfa726f3d03c4b45f8bd27c32d0e0f7a2bce2ff779cJmltdHM9MTc4ODgyNTYwMA&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;fclid=227e699b-68ec-6011-0b24-7e5569ad6105&amp;u=a1aHR0cHM6Ly93d3cuYmVpamluZy5nb3YuY24v&amp;ntb=1\"},{\"title\":\"北京市 - 维基百科，自由的百科全书\",\"url\":\"https://www.bing.com/ck/a?!&amp;&amp;p=557bcdafd96233a6001bf9661c6a78ba226ce030c7615764f013516867b301a9JmltdHM9MTc4ODgyNTYwMA&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;fclid=227e699b-68ec-6011-0b24-7e5569ad6105&amp;u=a1aHR0cHM6Ly96aC53aWtpcGVkaWEub3JnL3poLWNuLyVFNSU4QyU5NyVFNCVCQSVBQyVFNSVCOCU4Mg&amp;ntb=1\"},{\"title\":\"北京市海淀区人民政府门户网站\",\"url\":\"https://www.bing.com/ck/a?!&amp;&amp;p=493407419f0fa9baa0937132039d48d01c8c0ae62c78fba7ab90ec425b21f1d9JmltdHM9MTc4ODgyNTYwMA&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;fclid=227e699b-68ec-6011-0b24-7e5569ad6105&amp;u=a1aHR0cHM6Ly93d3cuYmpoZC5nb3YuY24v&amp;ntb=1\"}]}", "outcome_sha": "7146c9c7", "tool": "web_search"}},
  {"type": "check/status", "seq": 7, "time": "2026-09-08T21:13:50Z", "data": {"actual": "ok=true", "check": "exec_ok", "check_id": "run-7efbf0f8aacf96d5#c0", "evidence_id": "run-7efbf0f8aacf96d5#0", "expect": "ok", "gate": "hard", "judge": "rule", "passed": true, "reason": "ok=true"}},
  {"type": "check/status", "seq": 8, "time": "2026-09-08T21:13:50Z", "data": {"actual": "result produced, delivery confirmed at tool edge", "check": "answer.delivered", "check_id": "run-7efbf0f8aacf96d5#c1", "evidence_id": "run-7efbf0f8aacf96d5#0", "expect": "ok", "gate": "hard", "judge": "rule", "passed": true, "reason": "result produced, delivery confirmed at tool edge"}},
  {"type": "verdict/status", "seq": 9, "time": "2026-09-08T21:13:50Z", "data": {"checks": 2, "job_id": "run-7efbf0f8aacf96d5", "reason": "all checks passed", "status": "Met"}},
  {"type": "turn/end", "seq": 10, "time": "2026-09-08T21:13:50Z", "data": {"done": true, "impasse": false, "success": true, "verdict": "Met"}}
  ];
  const canon = NORM.normalize(real, { job_id: 'j-real' });
  const a = ASM.create();
  a.feed(canon.events);
  const coords = a.coordinates({ job_id: 'j-real' });
  check('REAL slice: zero refusals',
    a.rejections().total === 0, JSON.stringify(a.rejections().counts));
  check('REAL slice: every event reaches the tape',
    a.events().length === real.length, a.events().length + ' of ' + real.length);
  check('REAL slice: two turns derived',
    new Set(coords.map(function (c) { return c.turn; })).size === 2,
    JSON.stringify(Array.from(new Set(coords.map(function (c) { return c.turn; })))));
  check('REAL slice: node ids are unique across turns',
    new Set(coords.map(function (c) { return c.node; })).size === real.length,
    new Set(coords.map(function (c) { return c.node; })).size + ' of ' + real.length);
  /* gseqFallback is module-level, so earlier raw fixtures have already moved
   * it. The delta is the fact; the absolute value is not. */
  const fbBefore = ASM.create().diagnostics().gseqFallback;
  const probe = ASM.create();
  probe.feed(canon.events);
  check('REAL slice: no fallback on the normalised path',
    probe.diagnostics().gseqFallback === fbBefore,
    fbBefore + ' -> ' + probe.diagnostics().gseqFallback);
}

// ---- the contract's alias table is complete against its own schema
{
  const listed = Object.keys(EFX.TYPES).map(function (k) { return EFX.TYPES[k]; }).sort();
  const known = EFX.KNOWN_TYPES.slice().sort();
  check('contract TYPES is complete against DATA_SCHEMA',
    JSON.stringify(listed) === JSON.stringify(known),
    'TYPES=' + listed.length + ' KNOWN=' + known.length +
    ' missing=' + JSON.stringify(known.filter(function (t) { return listed.indexOf(t) < 0; })));
}

// ---- the target registry does no work at registration (D5)
{
  const a = ASM.create();
  var built = 0;
  a.register('prove_track', function () { built++; return { name: 'prove_track' }; });
  check('registered target is not active', a.activeTargets().length === 0);
  check('registration does not build the target', built === 0, String(built));
  a.activate('prove_track');
  check('activation is the construction point', built === 1, String(built));
  check('activated target is active',
    JSON.stringify(a.activeTargets()) === '["prove_track"]');
  a.deactivate('prove_track');
  check('deactivation stops the driving', a.activeTargets().length === 0);
  /* The lock, stated as an assertion: an inactive target is not built. A second
   * activation builds a fresh instance, which is the only way to get one. */
  var second = a.activate('prove_track');
  check('re-activation builds a fresh instance (nothing was retained)',
    built === 2 && second && second.name === 'prove_track', String(built));
  a.deactivate('prove_track');
}

// ---- the type lock, as an assertion rather than a sentence
//
// Re-reading the protocol needs two things: a name to branch on, and raw fields
// to interpret. Remove both and re-interpretation is not forbidden, it has no
// material. Every one-sentence rule today was broken anyway, so it is checked.
{
  const a = ASM.create();
  const norm = NORM.normalize([
    { type: 'turn/start', seq: 0, time: 't', data: {} },
    { type: 'user/message', seq: 1, time: 't', data: { text: 'hi' } },
    { type: 'tool/call', seq: 2, time: 't', data: { tool: 'x', index: 0, expect: 's' } }
  ], { job_id: 'j1' });
  a.feed(norm.events);
  const nodes = a.coordinates({ job_id: 'j1' });
  check('a node carries no protocol type', nodes.every(function (n) { return n.type === undefined; }));
  check('a node carries no raw data', nodes.every(function (n) { return n.data === undefined; }));
  check('a node carries a semantic kind',
    nodes.every(function (n) { return typeof n.kind === 'string' && n.kind.length > 0; }),
    JSON.stringify(nodes.map(function (n) { return n.kind; })));
  check('a node carries an interpreted payload',
    nodes.every(function (n) { return n.payload && typeof n.payload === 'object'; }));
  check('identity and stream position are separate fields',
    nodes.length === 3 && nodes[2].ord === 2 && nodes[2].node !== String(nodes[2].ord));
}

// ---- identity survives a different starting point
//
// The promise identity/ord separation makes: the same event gets the same id no
// matter where the read began. Before, node = jobId#gseq, so one row read B#10
// from the root and B#0 from a middle slice.
//
// The realistic middle read is mergeChain with a shorter chain, not
// normalize() on a slice: normalize receives ONE stream and its lineNo is that
// stream's index, while mergeChain knows each row's position inside its own
// file. Only the latter is the scenario that occurs.
{
  const p1 = [
    { type: 'turn/start', seq: 0, time: 't1', data: {} },
    { type: 'user/message', seq: 1, time: 't1', data: { text: 'a' } }
  ];
  const p2 = [
    { type: 'turn/start', seq: 0, time: 't2', data: {} },
    { type: 'user/message', seq: 1, time: 't2', data: { text: 'b' } }
  ];
  const byJob = { j1: p1, j2: p2 };

  const both = ASM.create(); both.feed(NORM.mergeChain(byJob, ['j1', 'j2']).events);
  const bothIds = both.coordinates({ job_id: 'j1' }).map(function (n) { return n.node; });

  const later = ASM.create(); later.feed(NORM.mergeChain(byJob, ['j2']).events);
  const laterIds = later.coordinates({ job_id: 'j1' }).map(function (n) { return n.node; });

  check('the same event yields the same id from a different starting point',
    JSON.stringify(laterIds) === JSON.stringify(bothIds.slice(2)),
    JSON.stringify(laterIds) + ' vs ' + JSON.stringify(bothIds.slice(2)));
  check('identity names its source file, not the merged position',
    bothIds[2] === 'j2#0' && bothIds[0] === 'j1#0', JSON.stringify(bothIds));
  check('and ord still differs, because it is a stream position',
    later.coordinates({ job_id: 'j1' })[0].ord === 0 &&
    both.coordinates({ job_id: 'j1' })[2].ord === 2);
}

console.log(failures === 0 ? '\nOK — all passed' : '\nFAILED: ' + failures);
process.exit(failures === 0 ? 0 : 1);
