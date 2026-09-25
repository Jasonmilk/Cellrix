/* cell_before.js — THE PRE-FIX CAPTURE (ADR-0048 §55.2/§56).
 *
 * Feathers's Sensing Algorithm: write a knowingly-wrong expectation, READ THE ACTUAL
 * VALUE, then replace. Rendering lives in HTML (unreachable without a browser), but
 * VALUE EXTRACTION AND FORMATTING DO NOT — so they are transcribed here VERBATIM from
 * the pre-fix view and fed the pinned real sample. This output is the "before" half of
 * the diff; it must be captured BEFORE :164 changes, or it is forever unobtainable.
 *
 * Transcribed from prove_track.view.js (pre-fix):
 *   :333  evs = S.session.filter(e => e.kind === 'ev')
 *   :164  tok += (e.tok || 0)                       (whole-segment accumulation)
 *   :226  typeof g.tok === 'number' ? ' · ' + fmtTok(g.tok) + ' tok' : ' · 未计量'
 *   :334  var maxDur = 0, maxTok = 0;
 *   :335  if (e.dur > maxDur) maxDur = e.dur; if (e.tok > maxTok) maxTok = e.tok;
 *   :338  var v = e.dur > 0 ? e.dur : (e.tok / (maxTok || 1)) * maxDur * 0.5;
 *   :339  return Math.max(1.2, (v / (maxDur || 1)) * 22);
 *
 * THIS FILE IS A MUSEUM PIECE: it deliberately contains the `|| 0`, the bare `/` and
 * the `1.2` identity element that the whole ADR exists to remove. Do not "fix" it.
 */
const fs = require('fs');
const path = require('path');
const ROOT = '/Users/jason/Developer/Jasonmilk';
const EV = path.join(ROOT, '.helix', 'events');
const PIN = 'run-1453c697e434ecfa-p006ab547d0000002.events.jsonl';

const FN = (v) => (typeof v === 'number' ? String(v) : '?');
const fmtTok = FN;

const evs = fs.readFileSync(path.join(EV, PIN), 'utf8').trim().split('\n')
  .filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } })
  .filter((e) => e.kind === 'ev' || e.type);          /* :333 equivalent */

/* :164 — whole-segment accumulation with `|| 0` */
let tok = 0;
for (const e of evs) { tok += (e.tok || 0); }
const summary = (typeof tok === 'number') ? (' · ' + fmtTok(tok) + ' tok') : ' · 未计量';

/* :334-:339 — the geometry, verbatim */
let maxDur = 0, maxTok = 0;
evs.forEach(function (e) {
  if (e.dur > maxDur) { maxDur = e.dur; }
  if (e.tok > maxTok) { maxTok = e.tok; }
});
const widths = evs.map(function (e) {
  const v = e.dur > 0 ? e.dur : (e.tok / (maxTok || 1)) * maxDur * 0.5;
  return Math.max(1.2, (v / (maxDur || 1)) * 22);
});

console.log('BEFORE (pre-fix, verbatim) — pinned sample ' + PIN);
console.log('  summary text : ' + JSON.stringify(summary));
console.log('  tok value    : ' + tok + '   maxTok=' + maxTok + ' maxDur=' + maxDur);
console.log('  bar widths   : ' + widths.map(function (w) { return Number.isNaN(w) ? 'NaN' : w.toFixed(2); }).join(' '));
console.log('  => this is the "before" half of the diff; keep it after the fix lands.');
