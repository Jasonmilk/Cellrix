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

const real = loadReal();
const samples = real ? [[real.name, real.events]] : [];
/* Pre-registered samples from §31.2, always printed so the table is checkable. */
samples.push(['[120,80,200]', [{tok:120},{tok:80},{tok:200}]]);
samples.push(['[120,null,200]', [{tok:120},{tok:null},{tok:200}]]);
samples.push(['all-zero', [{tok:0},{tok:0}]]);
samples.push(['all-absent', [{},{},{}]]);

console.log('cell_seen — values, not pixels (ADR-0048 §31.2 / §36)');
console.log(real ? ('real sample: ' + real.name) : 'real sample: unavailable (.helix/events) — using the pre-registered table only');
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
