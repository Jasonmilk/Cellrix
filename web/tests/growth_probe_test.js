/* growth_probe_test — THE FOUR GROWTH EXPERIMENTS, MADE PERMANENT (ADR-0048 §142).
 *
 * A criterion that only checks today's values cannot see a member added tomorrow. These four
 * experiments perturb the STRUCTURE and assert the gate reacts:
 *   A  grow SHAPES (the single source)              => the matrix must report an unclassified pair
 *   C  the same growth, reaching allocate           => it must be LOUD, never silently absent
 *   D  a NEW shape-branching function, unregistered => the registry scan must report a gap
 * (B, "growth that reaches the tests as a crash", is covered by using the PURE unclassified()
 *  function here: a growth reds as FAIL(1), never as CRASH(4).)
 */
const fs = require('fs');
const path = require('path');
const ASSET = path.join(__dirname, '..', 'assets', 'cell_metering.js');
const SRC = fs.readFileSync(ASSET, 'utf8');
const TMP = path.join(__dirname, '..', 'assets', 'zz_growth_probe.js');
const M = require(ASSET);

let bad = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) bad++; };

/* D: every shape-branching function must be REGISTERED (or declared exempt with a reason). */
function shapeBranchingFunctions(src) {
  const re = /^  function ([A-Za-z0-9_]+)\(/gm;
  const idx = []; let m;
  while ((m = re.exec(src))) { idx.push({ name: m[1], start: m.index }); }
  return idx.filter(function (f, i) {
    const end = (i + 1 < idx.length) ? idx[i + 1].start : src.length;
    return /SHAPES\.|isKnownShape\(|\.k ===/.test(src.slice(f.start, end));
  }).map(function (f) { return f.name; });
}
const found = shapeBranchingFunctions(SRC);
const gaps = found.filter(function (n) {
  return !M.CONSUMERS[n] && !M.REGISTRY_EXEMPT[n];
});
ok(found.length >= 5, 'D scope: the scan found >= 5 shape-branching functions (got ' + found.length + ')');
ok(gaps.length === 0, 'D: every shape-branching function is registered or declared exempt'
  + (gaps.length ? ' — UNREGISTERED: ' + gaps.join(', ') : ''));
/* The scan must be able to FAIL: a fabricated name is reported as a gap. */
const fabricated = shapeBranchingFunctions(SRC.replace('  function foldedCell(',
  '  function zzNewConsumer(rows) { return rows.map(function (r) { return r.k === SHAPES.p; }); }\n  function foldedCell('));
ok(fabricated.indexOf('zzNewConsumer') > -1
  && !M.CONSUMERS.zzNewConsumer && !M.REGISTRY_EXEMPT.zzNewConsumer,
  'D mutation: a fabricated consumer IS reported as unregistered (the scan is not blind)');

/* A + C: really grow the single source, in a copy, and see whether the gate notices. */
function grownCopy() {
  const grown = SRC.replace("a: TS.A().k };", "a: TS.A().k, xx: 'xx' };");
  if (grown === SRC) { throw new Error('growth probe could not find the SHAPES literal'); }
  fs.writeFileSync(TMP, grown);
  return require(TMP);
}
try {
  const G = grownCopy();
  const un = G.unclassified();
  ok(un.length > 0, 'A: growing SHAPES is DETECTED (unclassified pairs: ' + un.length + ')'
    + ' — this was [] before ADR-0048 §141');
  let loud = false;
  try { G.allocate([{ state: { k: 'xx' } }], { gridCols: 200, mode: 'value' }); }
  catch (e) { loud = true; }
  ok(loud, 'C: the grown shape cannot pass allocate silently (it is LOUD)');
  /* STRONGER THAN EXPECTED: with SHAPES grown, the gate CLOSES for every call, not just the
   * one carrying the new shape — `assertExhaustive()` runs at the entry, so no allocation
   * proceeds while a shape is unclassified. (The first draft asserted `empty.counts` here and
   * died on an uncaught throw — the throw IS the pass.) */
  let closed = false;
  try { G.allocate([], { gridCols: 200, mode: 'value' }); } catch (e) { closed = true; }
  ok(closed, 'C: while a shape is unclassified, EVERY allocation is refused (the gate closes, not just the new shape)');
} finally {
  try { fs.unlinkSync(TMP); } catch (e) { /* already gone */ }
}
console.log(bad === 0 ? 'OK — growth is DETECTED in every experiment (A / C / D)'
  : 'FAILED — ' + bad + ' growth experiment(s) not detected');
process.exit(bad ? 1 : 0);
