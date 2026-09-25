/* cell_seen.js — how this cell is SEEN without a browser (ADR-0048 §37).
 *
 * a/b/c1/c2 all live in prove_track.view.js, so after wiring them nothing can show
 * that anything runs. This exercise is the spike's verifiable deliverable: it calls
 * project()/shares() on REAL events and prints the folded summary plus every bar, so
 * the pre-registered expectations (§31.2) and the source marker (§36) can be compared.
 *
 * It sees VALUES, not pixels. A browser would be better; this does not wait for one.
 * It adds NO new criterion: it prints.
 */
const fs = require('fs');
const path = require('path');
const M = require('../assets/cell_metering.js');

const WS = path.join(__dirname, '..', '..', '..');
const EV = path.join(WS, '.helix', 'events');

function loadReal() {
  /* Real samples (hermetic-in-spirit: read-only, and the sha is printed). */
  try {
    const files = fs.readdirSync(EV).filter(function (f) { return f.endsWith('.events.jsonl'); }).sort();
    if (!files.length) { return null; }
    /* DECLARE which sample the criterion applies to (ADR-0048 §45). Taking the
     * "newest" file picked a 5-event period with NO assistant/usage events, so the
     * completion criterion (§44.1) could not be satisfied by construction — the
     * "evs 取错" case. Pick the RICHEST file by content: the one that actually
     * carries usage (and note the counts either way). */
    /* DECLARED, NOT FILTERED (ADR-0048 §46). Searching for "the file that contains
     * usage" makes the result depend on the outcome — the HARKing shape — and the
     * criterion stays green forever. So the sample is PINNED by name AND sha, and its
     * preconditions are ASSERTED rather than used to select: if the pinned sample
     * does not meet them, that is a DISCOVERY to record, not a reason to pick another
     * file. Run ids are hex random strings, so lexicographic order is NOT time order
     * and "newest" is not even well defined by filename. */
    const PIN = { name: 'run-1453c697e434ecfa-p006ab547d0000002.events.jsonl', sha256_16: '13bffc1b0a39a9b6' };
    const f = files.indexOf(PIN.name) > -1 ? PIN.name : null;
    if (f === null) {
      console.log('DISCOVERY: the pinned sample ' + PIN.name + ' is not present in .helix/events.');
      console.log('  That is a fact to record, not a reason to select a different file.');
      process.exit(3);
    }
    const evs = fs.readFileSync(path.join(EV, f), 'utf8').trim().split('\n')
      .filter(Boolean).map(function (l) { try { return JSON.parse(l); } catch (e) { return {}; } });
    return { name: f, events: evs, pinned: PIN };
  } catch (e) { return null; }
}

/* §44.2 — "count first, then judge" (Prometheus `count by` / `absent()`).
 * These three counts are computed FROM THE EVENTS (pre-flight), because `src` is
 * not in the projection yet (step b). They are the baseline the completion
 * criterion compares against: tok should equal the assistant/usage count, dur the
 * tool/result count, and unknown the rest (inject and friends). */
function srcCounts(events) {
  let durN = 0, tokN = 0, unknownN = 0;
  for (const e of events) {
    const d = e && e.data;
    const hasDur = !!(d && Object.prototype.hasOwnProperty.call(d, 'duration_ms'));
    const hasTok = !!(d && (Object.prototype.hasOwnProperty.call(d, 'completion_tokens')
                        || Object.prototype.hasOwnProperty.call(d, 'output_tokens')));
    if (hasDur) { durN++; } else if (hasTok) { tokN++; } else { unknownN++; }
  }
  return { durN, tokN, unknownN };
}
const real = loadReal();
const samples = real ? [[real.name, real.events]] : [];
/* Pre-registered samples from §31.2, always printed so the table is checkable. */
samples.push(['[120,80,200]', [{tok:120},{tok:80},{tok:200}]]);
samples.push(['[120,null,200]', [{tok:120},{tok:null},{tok:200}]]);
samples.push(['all-zero', [{tok:0},{tok:0}]]);
samples.push(['all-absent', [{},{},{}]]);

console.log('cell_seen — values, not pixels (ADR-0048 §31.2 / §36)');
console.log(real ? ('real sample: ' + real.name) : 'real sample: unavailable (.helix/events) — using the pre-registered table only');
if (real) {
  const pids = Array.from(new Set(real.events.map(function (e) { return e.period_id === undefined ? '' : e.period_id; }))).sort();
  const c = srcCounts(real.events);
  console.log('pinned sample ' + real.pinned.name + ' (sha256:' + real.pinned.sha256_16 + ')');
  console.log('period_ids in this sample: ' + JSON.stringify(pids)
    + (pids.length > 1 ? '  <-- MIXED: project will THROW, and that is a DISCOVERY (ADR-0048 §44.3)' : ''));
  /* PRECONDITIONS ASSERTED, not used to select. */
  if (!(c.tokN >= 1)) { console.log('PRECONDITION FAILED: this sample has no assistant/usage event'
    + ' — the completion criterion cannot be exercised. Record it; do not switch files.'); }
  console.log('src counts (pre-flight, from the events): dur=' + c.durN + ' tok=' + c.tokN
    + ' unknown=' + c.unknownN + '  total=' + real.events.length);
  console.log('  expect after wiring: tok = assistant/usage count (' + c.tokN + '), dur = tool/result count ('
    + c.durN + '), unknown = the rest (' + c.unknownN + ')');
  console.log('  COMPLETION (§44.1): the folded summary tok must become present(<a real number>), NOT absent.'
    + ' It is RED RIGHT NOW: tok is absent until the path is fixed.');
}
console.log('');
for (const [label, evs] of samples) {
  const r = M.project(evs);
  const k = (n) => n.k + (n.v === undefined ? '' : ':' + n.v) + (n.bound ? ' ' + n.bound : '');
  console.log('  ' + label);
  console.log('    folded   tok=' + k(r.tok) + '  partial=' + r.partial
    + '  max(denom)=' + k(r.max) + '  maxDisplay=' + k(r.maxDisplay));
  const sh = M.shares(r);
  console.log('    bars     ' + sh.map(function (x) { return k(x.value) + (x.reason ? '/' + x.reason : ''); }).join('  '));
  console.log('    counters legitUnknown=' + sh.legitUnknown + '  nonFinite=' + sh.nonFinite
    + (sh.nonFinite === 0 ? '  (gate: ok)' : '  (gate: MUST BE 0)'));
  /* §36 coverage: `maxDur` is a GLOBAL switch — when it is missing every bar is
   * effectively src=unknown even if tok has a value. Not yet in the projection, so
   * the gap is PRINTED rather than hidden. */
  console.log('    src       NOT YET IN THE PROJECTION (step b must add maxDur + src);'
    + ' until then every bar width carries the 1.2 identity element (§36).');
  console.log('');
}
