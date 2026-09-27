/* walk_state_test — THE WALK HAS FOUR ENDINGS AND ALL FOUR ARE NAMED (ADR-0048 §185).
 *
 * Measured before: the truncation observable had 1.0 of 2.0 bits — ① a COMPLETE walk reported a
 * truncation (a root legitimately has no parent), ② a CYCLE returned null, ③ a MISSING START
 * returned an empty array and null. The two structural failures were exactly as silent as the
 * defect the observable was added to remove. Rule ⑮: one `null` may not carry two meanings.
 */
/* MACHINE-READABLE, NOT ONLY HUMAN-READABLE (ADR-0048 §203): this suite already SAID
 * `NEEDS-INPUT: jsdom 未安装` — in prose. The ledger reads `REQUIRES`, so "said" and
 * "declared" were separated by a BLOCKING. Both hosts, or neither counts. */
const REQUIRES = 'jsdom';

const fs = require('fs'), path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('NEEDS-INPUT: jsdom 未安装'); process.exit(3); }

function load(overrideNormalize) {
  const w = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' }).window;
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'event_family.js'), 'utf8'));
  let src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'period_normalize.js'), 'utf8');
  if (overrideNormalize) { src = overrideNormalize(src); }
  w.eval(src);
  return w;
}
/* a window is a map id -> {parent} */
/* `chainJobIds(periods, startId)` — periods is an ARRAY of {id, parent} (measured signature). */
/* `chainJobIds(periods, startId)`; periods are keyed by **period_id** (not job_id — that is a
 * content digest, so two runs of one input would collide and drop a row). */
const W = (rows) => Object.keys(rows).map((k) => ({ period_id: k, parent: rows[k] }));

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

{ /* ① complete: A -> B (B is the root) */
  const w = load();
  const ids = w.CxNormalize.chainJobIds(W({ A: 'B', B: null }), 'B');
  const walk = w.CxNormalize.lastWalk();
  ok(walk && walk.kind === 'root', 'a COMPLETE walk is named root, not "truncated"  [' + (walk && walk.kind) + ']');
  ok(w.CxNormalize.lastTruncation() === null,
    'and the compatibility reading is null on success (it used to fire here)');
  ok(ids.length === 1 && ids[0] === 'B', 'the path is still correct  [' + ids.join(',') + ']');
  w.close();
}
{ /* ② truncated: A -> MISSING */
  const w = load();
  const ids = w.CxNormalize.chainJobIds(W({ A: 'NOT_IN_WINDOW' }), 'A');
  const walk = w.CxNormalize.lastWalk();
  ok(walk && walk.kind === 'truncated' && walk.parent === 'NOT_IN_WINDOW',
    'a TRUNCATED walk names the parent it could not follow  [' + JSON.stringify(walk) + ']');
  ok(ids.length === 1, 'and still returns the partial path it has');
  w.close();
}
{ /* ③ cycle: P -> Q -> P */
  const w = load();
  const ids = w.CxNormalize.chainJobIds(W({ P: 'Q', Q: 'P' }), 'P');
  const walk = w.CxNormalize.lastWalk();
  ok(walk && walk.kind === 'cycle', 'a CYCLE is named, not silent  [' + (walk && walk.kind) + ']');
  ok(ids.length === 2, 'the walked nodes are still reported (as data, not as a trustworthy order)');
  w.close();
}
{ /* ④ start absent */
  const w = load();
  const ids = w.CxNormalize.chainJobIds(W({ A: 'B', B: null }), 'ZZZ');
  const walk = w.CxNormalize.lastWalk();
  ok(walk && walk.kind === 'start-absent', 'a MISSING START is named, not silent  [' + (walk && walk.kind) + ']');
  ok(Array.isArray(ids) && ids.length === 0, 'and the empty answer is a stated fact, not an accident');
  w.close();
}
{ /* MUTATION: merging cycle/start-absent back into null must be caught */
  const w = load((src) => src.replace(
    "walk = { kind: 'cycle', at: cur, parent: null, pathLength: path.length }; break;",
    "walk = { kind: 'root', at: cur, parent: null, pathLength: path.length }; break;"));
  w.CxNormalize.chainJobIds(W({ P: 'Q', Q: 'P' }), 'P');
  const walk = w.CxNormalize.lastWalk();
  ok(!walk || walk.kind !== 'cycle',
    'MUTATION: mis-reporting a cycle as root IS visible to these checks (this criterion can fail)  ['
    + (walk && walk.kind) + ']');
  w.close();
}
console.log(bad === 0 ? 'OK — four endings, four names, and the state is recomputed every walk'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
