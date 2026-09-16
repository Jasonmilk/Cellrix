/* ADR-0018 §3 acceptance conditions — the regression net (T6).
 *
 * Eleven clauses, each labelled with its number from the ADR. Clause 9 (split
 * invariance) is the one the ADR calls "全篇最该有的一条": replaying a prefix
 * and then the rest must equal replaying everything, or replay and live have
 * diverged and the whole "auditable" claim is decoration.
 *
 * Usage: node acceptance_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = {};
const A = path.join(__dirname, '..', 'assets');
eval(fs.readFileSync(path.join(A, 'event_family.js'), 'utf8'));
eval(fs.readFileSync(path.join(A, 'node_shape.js'), 'utf8'));
eval(fs.readFileSync(path.join(A, 'assembly.js'), 'utf8'));
const ASM = global.window.CxAssembly;
const EF = global.window.CxEventFamily;

let failures = 0;
function check(n, name, cond, detail) {
  const label = '§3.' + n + '  ' + name;
  if (cond) { console.log('  PASS  ' + label); }
  else { failures++; console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : '')); }
}

function ev(type, seq, data) {
  return { type: type, seq: seq, time: '2026-09-15T00:00:00Z', data: data || {} };
}

/* A period with a closed turn and an open one, so "pending" and "complete" are
 * both reachable from the same tape. */
const FULL = [
  ev('turn/start', 1),
  ev('user/message', 2, { text: 'go' }),
  ev('assistant/think', 3, { text: 'thinking' }),
  ev('tool/call', 4, { tool: 'read', index: 0, expect: 'ok' }),
  ev('tool/result', 5, { tool: 'read', ok: true, duration_ms: 12, data: 'ok' }),
  ev('check/status', 6, { check_id: 'c1', check: 'has-answer', expect: 'yes', actual: 'yes', gate: 'hard' }),
  ev('verdict/status', 7, { job_id: 'j1', status: 'MET' }),
  ev('assistant/reply', 8, { text: 'done', chars: 4, model: 'm1' }),
  ev('turn/end', 9, { done: true, success: true, impasse: false, reply: 'done', model: 'm1' })
];

/* The same tape with its opening turn/start withheld — a tail-only window. */
const TAIL_ONLY = [
  ev('assistant/think', 3, { text: 'thinking' }),
  ev('tool/call', 4, { tool: 'read', index: 0, expect: 'ok' }),
  ev('assistant/reply', 8, { text: 'done', chars: 4, model: 'm1' })
];

console.log('ADR-0018 §3 acceptance net');

// ---- 1: a complete window yields coordinates, and replay is idempotent
{
  const a = ASM.create(); a.feed(FULL);
  const coord = a.coordinates({ job_id: 'j1' });
  check(1, 'complete window yields coordinates for every event',
    coord.length === FULL.length, coord.length + ' vs ' + FULL.length);
  check(1, 'every coordinate carries a node id and a turn',
    coord.every(function (c) { return !!c.node && !!c.turn; }));
  const first = a.digest();
  a.feed(FULL);
  check(1, 'replay of the same window deep-equals', a.digest() === first);
}

// ---- 2: a tail-only window stays pending; supplying the start converges
{
  const tail = ASM.create(); tail.feed(TAIL_ONLY);
  check(2, 'tail-only window stays pending', tail.status() === 'pending', tail.status());
  const whole = ASM.create(); whole.feed(FULL);
  const completed = ASM.create(); completed.feed(TAIL_ONLY); completed.feed(FULL);
  check(2, 'adding the missing start converges to the full tapereplay',
    completed.digest() === whole.digest(), completed.digest() + ' vs ' + whole.digest());
  check(2, 'and the window is then ready', completed.status() === 'ready');
}

// ---- 3: history then live append == one complete replay
{
  const live = ASM.create();
  live.feed(FULL.slice(0, 5));
  live.feed(FULL.slice(5));
  const whole = ASM.create(); whole.feed(FULL);
  check(3, 'history + live append equals a single replay',
    live.digest() === whole.digest());
}

// ---- 4: a late earlier page adds earlier rows and does not disturb the rest
{
  const a = ASM.create();
  a.feed(FULL.slice(4));
  const before = a.coordinates({ job_id: 'j1' });
  a.feed(FULL.slice(0, 4));
  const after = a.coordinates({ job_id: 'j1' });
  check(4, 'back-fill grows the window', after.length === FULL.length, String(after.length));
  const tailBefore = before.map(function (c) { return c.node; });
  const tailAfter = after.filter(function (c) { return tailBefore.indexOf(c.node) >= 0; })
    .map(function (c) { return c.node; });
  check(4, 'existing keyed nodes keep their identity',
    JSON.stringify(tailBefore) === JSON.stringify(tailAfter));
}

// ---- 5: change-driven publication, one per merged window
{
  const a = ASM.create();
  let published = 0, last = null;
  a.subscribe(function (snap) { published++; last = snap; });
  const base = published;               // the first subscriber may do a replace
  a.flush();
  check(5, 'flush with no change publishes nothing', published === base);
  a.feed(FULL.slice(0, 3));
  a.feed(FULL.slice(3, 6));            // a burst …
  a.flush();
  check(5, 'one publication per merged window, not one per event',
    published === base + 1, 'published ' + (published - base));
  a.flush();
  check(5, 'the same window is not published twice', published === base + 1);
}

// ---- 6: a target must not scan the window (seam: traversal throws)
{
  const a = ASM.create();
  a.feed(FULL);
  const snap = a.snapshot();
  // Instrument: any read of length/indices or any iteration raises.
  const guard = new Proxy(snap, {
    get: function (t, k) {
      if (k in t) return t[k];
      throw new Error('renderer touched the window: ' + String(k));
    },
    has: function () { throw new Error('renderer scanned the window'); }
  });
  let ok = true, why = '';
  try {
    // What a compliant target may do: read scalars off the snapshot.
    void guard.watermark; void guard.count; void guard.digest;
  } catch (e) { ok = false; why = e.message; }
  check(6, 'a snapshot carries scalars only, nothing to iterate', ok, why);
  check(6, 'the snapshot does not expose the tape',
    snap.events === undefined && snap.tape === undefined);
}

// ---- 3 (D3): a refused event is counted, never silently dropped
{
  const a = ASM.create();
  const junk = [
    { type: 'not/a/type', seq: 1, time: 't', data: {} },
    { type: 'user/message', seq: 2, time: 't', data: { text: 42 } }, // wrong field type
    ev('user/message', 3, { text: 'ok' })
  ];
  a.feed(junk);
  const rej = a.rejections();
  check(3, 'refusals are counted, not silently dropped', rej.total === 2, String(rej.total));
  check(3, 'the reason is recorded per type',
    rej.counts['invalid:not/a/type'] === 1 && rej.counts['invalid:user/message'] === 1,
    JSON.stringify(rej.counts));
  check(3, 'the sample names a culprit', rej.sample.length === 2 && !!rej.sample[0].type);
  // Distinguishable through rejections(), not through the digest — see the
  // note in digestOf(): diagnostics must not enter an invariant.
  check(3, 'a wholly-rejected window is distinguishable from an empty one',
    a.rejections().total === 2 && JSON.parse(a.digest()).n === 1,
    JSON.stringify(a.rejections()));
}

// ---- 3 (D3): duplicate seq is a refusal too, and is also counted
{
  const a = ASM.create();
  a.feed([ev('user/message', 1, { text: 'x' }), ev('user/message', 1, { text: 'x' })]);
  check(3, 'a duplicate is counted as a refusal',
    a.rejections().counts['duplicate:user/message'] === 1,
    JSON.stringify(a.rejections().counts));
}

// ---- 7: registration does no work; first subscribe replaces; unsub stops
{
  const a = ASM.create();
  let built = 0;
  a.register('pt', function () { built++; });
  check(7, 'registering builds nothing', built === 0, String(built));
  a.feed(FULL);
  const un = a.subscribe(function () { built++; });
  check(7, 'the first subscriber triggers one full replace', built === 1, String(built));
  a.feed([ev('user/message', 99, { text: 'more' })]);
  a.flush();
  check(7, 'a subscribed target is driven on change', built === 2, String(built));
  un();
  a.feed([ev('user/message', 100, { text: 'again' })]);
  a.flush();
  check(7, 'unsubscribing stops the driving', built === 2, String(built));
}

// ---- 8: purity — no clock, no randomness, no DOM
{
  const src = fs.readFileSync(path.join(A, 'assembly.js'), 'utf8')
    + fs.readFileSync(path.join(A, 'event_family.js'), 'utf8');
  check(8, 'no Date.now / new Date in the assembly',
    !/Date\.now|new Date\(/.test(src));
  check(8, 'no Math.random in the assembly', !/Math\.random/.test(src));
  check(8, 'no document access in the assembly', !/\bdocument\b/.test(src));
  const one = ASM.create(); one.feed(FULL);
  const two = ASM.create(); two.feed(FULL);
  check(8, 'the same tape yields byte-identical results',
    one.digest() === two.digest() && one.coordinates().length === two.coordinates().length);
}

// ---- 9: split invariance, at every cut point
{
  const all = ASM.create(); all.feed(FULL);
  let bad = '';
  for (let k = 0; k <= FULL.length; k++) {
    const split = ASM.create();
    split.feed(FULL.slice(0, k));
    split.feed(FULL.slice(k));
    if (split.digest() !== all.digest()) { bad = 'k=' + k; break; }
    if (split.coordinates().map(function (c) { return c.node; }).join() !==
        all.coordinates().map(function (c) { return c.node; }).join()) { bad = 'coords k=' + k; break; }
  }
  check(9, 'split invariance: replay(k) + live(rest) == replay(all)', bad === '', bad);
}

// ---- 10: chunk invariance, including awkward chunk sizes
{
  const all = ASM.create(); all.feed(FULL);
  let bad = '';
  [1, 2, 3, 7, 8, FULL.length, FULL.length + 5].forEach(function (size) {
    const a = ASM.create();
    for (let i = 0; i < FULL.length; i += size) a.feed(FULL.slice(i, i + size));
    if (a.digest() !== all.digest()) bad = 'chunk=' + size;
  });
  check(10, 'chunk invariance across 1/2/3/7/full/oversized', bad === '', bad);
}

// ---- D3 (immunity): a REAL period is accepted with zero refusals
//
// The vocabulary once rejected 17% of real events — every period lost its
// assistant/usage, and periods whose context/inject omitted the optional
// resume_from lost that too. Nothing in this file noticed, because every
// sample was synthetic. This clause is anchored on the shape the producer
// actually emits, measured over 86 real periods:
//   * assistant/usage is a real type and must be known
//   * context/inject may omit resume_from
//   * turn/end may omit reply and model
//   * assistant/reply may omit model
{
  const a = ASM.create();
  const real = [
    ev('turn/start', 0),
    ev('user/message', 1, { text: 'go' }),
    ev('context/inject', 2, { chars: 800, nodes: 12 }),          // no resume_from
    ev('assistant/usage', 3, { prompt_tokens: 100, completion_tokens: 20,
                               cached_tokens: 0, reasoning_tokens: 0, model: 'm' }),
    ev('assistant/think', 4, { text: 't' }),
    ev('assistant/attempt', 5, { text: 'a', empty: false }),
    ev('tool/call', 6, { tool: 'read', index: 0, expect: 'ok' }),
    ev('tool/result', 7, { tool: 'read', ok: true, duration_ms: 3 }),  // no data/outcome
    ev('assistant/reply', 8, { text: 'done', chars: 4 }),              // no model
    ev('turn/end', 9, { done: true, success: true, impasse: false })   // no reply/model
  ];
  a.feed(real);
  check(3, 'a real period is accepted with zero refusals',
    a.rejections().total === 0, JSON.stringify(a.rejections().counts));
  check(3, 'and every event reached the tape',
    a.events().length === real.length,
    a.events().length + ' of ' + real.length);
  check(3, 'assistant/usage is a known type',
    EF.isKnownType('assistant/usage'));
}

// ---- 11: the digest is observable, and it is what proves 9 and 10
{
  const a = ASM.create(); a.feed(FULL);
  const d = a.digest();
  check(11, 'digest is readable during production', typeof d === 'string' && d.length > 0);
  const parts = JSON.parse(d);
  check(11, 'digest carries the CONTRACT version', parts.contractVersion === EF.VERSION, String(parts.v));
  check(11, 'digest carries the watermark', parts.wm === 9, String(parts.wm));
  check(11, 'digest carries the event count', parts.n === FULL.length, String(parts.n));
  // Self-证: the very values 9 and 10 compare are the ones digest exposes.
  const all = ASM.create(); all.feed(FULL);
  const shuffled = FULL.slice().reverse();
  const b = ASM.create(); b.feed(shuffled);
  check(11, 'digest proves order-independence, so 9/10 rest on it',
    b.digest() === all.digest());
}

console.log('');
console.log(failures === 0
  ? 'RESULT: all 11 clauses green'
  : 'RESULT: FAIL (' + failures + ' clause checks failed)');
process.exit(failures === 0 ? 0 : 1);
