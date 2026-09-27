/* usage_aggregate_test — ONE COLUMN'S UNKNOWN MUST NOT VOID ANOTHER COLUMN'S KNOWN (ADR-0048 §177).
 *
 * Measured before: metering nodes [9,5] · [11,7] · [3, null] produced
 *     calls=2  prompt=20  completion=12  total=32        (shown)
 * while the truth is
 *     calls=3  prompt=23  completion=12 (lower bound)  total >= 35
 * The whole third node was dropped because ONE of its two columns was unknown — losing the KNOWN
 * prompt=3 and the call count with it. §131 fixed exactly this poisoning inside `add`; the
 * aggregation path was never enumerated when the invariant's channels were listed.
 */
/* MACHINE-READABLE, NOT ONLY HUMAN-READABLE (ADR-0048 §203): this suite already SAID
 * `NEEDS-INPUT: jsdom 未安装` — in prose. The ledger reads `REQUIRES`, so "said" and
 * "declared" were separated by a BLOCKING. Both hosts, or neither counts. */
const REQUIRES = 'jsdom';

const path = require('path');
const fs = require('fs');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('NEEDS-INPUT: jsdom 未安装 — 聚合判据无法行使'); process.exit(3); }
const AP = require('./assemble_page.js');

const NODES = [
  { kind: 'metering', payload: { promptTokens: 9, completionTokens: 5 } },
  { kind: 'metering', payload: { promptTokens: 11, completionTokens: 7 } },
  { kind: 'metering', payload: { promptTokens: 3, completionTokens: null } }
];

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

function derive(overrides) {
  const w = new JSDOM(AP.assemble(overrides).html, { runScripts: 'dangerously', url: 'http://127.0.0.1:1/' }).window;
  const out = w.CxProveTrack.node.derivePeriodUsage(NODES);
  w.close();
  return out;
}

const u = derive();
ok(u && u.calls === 3, 'all three calls are counted (' + (u && u.calls) + ') — a call that happened is a call');
ok(u && u.prompt === 23, 'prompt == 23: the KNOWN 3 of the node whose OTHER column is unknown survives ('
  + (u && u.prompt) + ')');
ok(u && u.completion === 12 && u.completionPartial === true,
  'completion == 12 AND flagged partial (lower bound) [' + (u && u.completion)
  + ' partial=' + (u && u.completionPartial) + ']');
ok(u && u.total === 35 && u.totalPartial === true,
  'total reports the LOWER BOUND 35 and says so (totalPartial) [' + (u && u.total)
  + ' partial=' + (u && u.totalPartial) + ']');

/* MUTATION (re-aimed after §180 introduced the four-way classification): make a LEGAL null be
 * treated as ILLEGAL (refused) — the exact inversion §176/§177 exist to forbid. The row must then
 * vanish from the aggregate again (calls=2, prompt=20), which is what the old behaviour looked like. */
const broken = derive({ 'prove_track.node.js': (src) => src.replace(
  "if (n === null || n === undefined) { return 'U'; }",
  "if (n === null || n === undefined) { return 'R'; }") });
ok(broken.calls === 2 && broken.prompt === 20 && broken.refused === 1,
  'MUTATION: treating a LEGAL null as ILLEGAL IS caught (calls=2, prompt=20, refused=1)  ['
  + broken.calls + ', ' + broken.prompt + ', ' + broken.refused + ']');
console.log(bad === 0 ? 'OK — an unknown column lowers a bound instead of voiding the row'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
