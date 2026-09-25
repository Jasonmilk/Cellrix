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
    const f = files[files.length - 1];
    const evs = fs.readFileSync(path.join(EV, f), 'utf8').trim().split('\n')
      .filter(Boolean).map(function (l) { try { return JSON.parse(l); } catch (e) { return {}; } });
    return { name: f, events: evs };
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
  const c = srcCounts(real.events);
  console.log('src counts (pre-flight, from the events): dur=' + c.durN + ' tok=' + c.tokN
    + ' unknown=' + c.unknownN + '  total=' + real.events.length);
  console.log('  expect after wiring: tok = assistant/usage count (' + c.tokN + '), dur = tool/result count ('
    + c.durN + '), unknown = the rest (' + c.unknownN + ')');
  console.log('  COMPLETION (§44.1): the folded summary tok must become present(<a real number>), NOT absent.'
    + ' If it stays absent, only the path or the evs selection can be wrong — adjust nothing else.');
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
