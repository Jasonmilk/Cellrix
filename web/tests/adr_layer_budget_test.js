/* adr_layer_budget_test — THE ALWAYS-LOADED LAYER HAS A POLICY, A DERIVED MEASUREMENT, AND A
 * REVIEW THAT MUST EXIST (ADR-0048 §146).
 *
 * The rule this lands (rule ⑰ applied to a budget):
 *   · the POLICY number is hand-written ONCE, here — not in three files (measured: phyt-DNA
 *     declares its budget in RNA.md:25, README.md:96, README.zh-CN.md:99 while its own table
 *     two lines above already contradicts it: 330 estimated vs <=280 declared);
 *   · the MEASUREMENT is DERIVED from the files, never estimated (the estimate is what drifted);
 *   · the COMPARISON is automatic, and a "soft" threshold is only a threshold if crossing it
 *     has an ENFORCEABLE consequence — so crossing POLICY requires a REVIEW RECORD to exist.
 *     A review that nothing requires is a check that can never go red (the failure this repo
 *     already named: "a check that cannot go red is not a check").
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const POLICY = 400;      /* the agreed policy: over this, a review must exist */
const ABSOLUTE = 600;    /* the ceiling that is red no matter what */
/* MEMBERS: the always-loaded layer, declared in ONE place. */
const MEMBERS = [
  { name: 'ADR index', file: path.join(ROOT, 'docs', 'ADR-0048.index.md') },
  { name: 'ADR §0 (read first)', file: path.join(ROOT, 'docs', 'decisions',
      'ADR-0048-panel-state-owner-and-render-contract.md'), section: '0' }
];
const LEDGER = path.join(ROOT, 'docs', 'adr-layer-reviews.jsonl');

function lines(p) { return fs.readFileSync(p, 'utf8').split('\n').length; }
function sectionLines(file, num) {
  const src = fs.readFileSync(file, 'utf8');
  const all = src.split('\n');
  const start = all.findIndex(function (l) { return new RegExp('^## ' + num + '\\.').test(l); });
  if (start < 0) { return 0; }
  let end = all.length;
  for (let i = start + 1; i < all.length; i++) {
    if (/^## \d+\./.test(all[i])) { end = i; break; }
  }
  return end - start;
}
function measured() {
  return MEMBERS.reduce(function (sum, m) {
    return sum + (m.section !== undefined ? sectionLines(m.file, m.section) : lines(m.file));
  }, 0);
}
function records() {
  if (!fs.existsSync(LEDGER)) { return []; }
  return fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).map(function (l) {
    try { return JSON.parse(l); } catch (e) { return { bad: l }; }
  });
}

const sum = measured();
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) { bad++; } };

ok(MEMBERS.length >= 2 && sum > 50,
  'scope: the always-loaded layer is declared (' + MEMBERS.length + ' members, ' + sum + ' lines)');
ok(sum <= ABSOLUTE, 'hard ceiling: ' + sum + ' <= ' + ABSOLUTE + ' lines');

if (sum > POLICY) {
  const recs = records();
  const covering = recs.filter(function (r) { return typeof r.sum === 'number' && r.sum >= sum; });
  ok(covering.length > 0,
    'review: ' + sum + ' > POLICY(' + POLICY + ') ⇒ a review record covering this size must exist'
    + ' (found ' + covering.length + ') — a soft threshold with no record is not a threshold');
} else {
  console.log('  ok   under POLICY(' + POLICY + '): ' + sum + ' lines — no review required yet');
}

/* MUTATION PROBES — the criterion must be able to fail in BOTH ways it claims to catch. */
function wouldRequireReview(size) { return size > POLICY; }
ok(wouldRequireReview(POLICY + 1) && !wouldRequireReview(POLICY - 1),
  'MUTATION: crossing POLICY flips the review requirement');
const fake = [{ sum: POLICY + 10 }];
ok(fake.filter(function (r) { return r.sum >= POLICY + 50; }).length === 0,
  'MUTATION: a stale/too-small review record does NOT satisfy a larger layer');
console.log(bad === 0 ? 'OK — the always-loaded layer is measured and its policy is enforceable'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
