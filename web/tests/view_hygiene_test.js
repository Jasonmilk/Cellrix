/* view_hygiene_test — THE GATE POINTS AT THE TARGET (ADR-0048 §65, milestone M0).
 *
 * Until now every criterion acted on files WE wrote; not one read prove_track.view.js,
 * so a fully green gate was compatible with that cell being 100% broken. This is the
 * baseline N that §33 registered long ago ("record a classified baseline, then drive it
 * to 0") and that had never been executed because there was nothing reading the view.
 *
 * Four classes, each a DIFFERENT root cause:
 *   bare-slash      `a / b`            -> NaN/Infinity at the geometry layer
 *   fallback-or     `x || lit`         -> one operator swallowing 0/null/absent
 *   typeof-existence `typeof x === 'number'` -> presence judged by type, not state
 *   bare-threshold  `0.5 / 1.2 / 0.05` -> undeclared decision thresholds
 *
 * Comments are stripped first: a rule must not be satisfied (or broken) by prose.
 * cell_before.js is the museum piece and is exempt via deferrals.json (the FILE, not
 * the rule).
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'assets', 'prove_track.view.js');
/* BASELINE IS MEASURED, AND ITS SCOPE IS DECLARED (ADR-0048 §65.2).
 * The reviewer's proof of concept measured THIS CELL's path and got 9; this checker
 * scans the WHOLE FILE and measures 30. Neither number is invented; they answer
 * different questions. M3 targets the whole file — a STRONGER bar than the cell alone —
 * and the refinement to a cell-scoped range is registered rather than guessed. */
/* MEASURED, NOT GUESSED (the first draft wrote 3/15 here and the run immediately
 * corrected it to 4/30 — the third time in this chain that a written expectation
 * outran the measurement). */
const BASELINE = { 'bare-slash': 7, 'fallback-numeric': 4, 'fallback-other': 30,
                   'typeof-existence': 2, 'bare-threshold': 3 };
const SCOPE_NOTE = 'whole file (cell-scoped proof of concept measured 9)';
/* ASSERTED classes must reach 0; RECORDED-ONLY classes are printed, not judged. */
const ASSERTED = ['bare-slash', 'fallback-numeric', 'typeof-existence', 'bare-threshold'];

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}
const raw = fs.readFileSync(TARGET, 'utf8');
const code = stripComments(raw);

const counts = { 'bare-slash': 0, 'fallback-numeric': 0, 'fallback-other': 0,
                 'typeof-existence': 0, 'bare-threshold': 0 };
code.split('\n').forEach(function (line) {
  /* bare '/' between expressions — exclude '//' comments (already stripped) and '/*' */
  if (/[A-Za-z0-9_)\]]\s*\/\s*[A-Za-z0-9_(]/.test(line)) { counts['bare-slash']++; }
  /* SPLIT: `x || 0` FORCES A NUMBER (the real disease — one operator swallowing
   * 0/null/absent) vs any other `||` (e.g. `a || []`), which is registered, not
   * asserted. Without this split the target 0 is unreachable and M3 stalls —
   * preparation turning into procrastination once more (ADR-0048 §66.3). */
  if (/\|\|\s*\d/.test(line)) { counts['fallback-numeric']++; }
  else if (/\|\|/.test(line)) { counts['fallback-other']++; }
  if (/typeof\s+[A-Za-z_$][\w$.]*\s*===?\s*['"]number['"]/.test(line)) { counts['typeof-existence']++; }
  if (/(^|[^\w.])(0\.5|1\.2|0\.05)(?![\d])/.test(line)) { counts['bare-threshold']++; }
});

/* META-ASSERTION (ADR-0048 §66.2): the detectors must SEE a known all-broken sample.
 * A checker that has silently stopped matching reports 0 and looks like success — the
 * very failure this gate exists to prevent. */
const KNOWN_ALL_BROKEN = ['var a = b / c;', "var d = e || 0;", "typeof f === 'number';", 'var g = 1.2;'].join('\n');
(function () {
  const probe = { 'bare-slash': 0, 'fallback-numeric': 0, 'typeof-existence': 0, 'bare-threshold': 0 };
  KNOWN_ALL_BROKEN.split('\n').forEach(function (line) {
    if (/[A-Za-z0-9_)\]]\s*\/\s*[A-Za-z0-9_(]/.test(line)) { probe['bare-slash']++; }
    if (/\|\|\s*\d/.test(line)) { probe['fallback-numeric']++; }
    if (/typeof\s+[A-Za-z_$][\w$.]*\s*===?\s*['"]number['"]/.test(line)) { probe['typeof-existence']++; }
    if (/(^|[^\w.])(0\.5|1\.2|0\.05)(?![\d])/.test(line)) { probe['bare-threshold']++; }
  });
  const blind = Object.keys(probe).filter(function (k) { return probe[k] === 0; });
  console.log((blind.length ? '  FAIL ' : '  ok   ')
    + 'META — the detectors see a known all-broken sample'
    + (blind.length ? ' (blind to: ' + blind.join(', ') + ')' : ''));
  if (blind.length) { bad++; }
}());

let bad = 0;   /* declared BEFORE any block that increments it (TDZ: a
               * check that throws when it should fail is not a check) */

/* ── PRESENCE-TYPE GATE: can every name the view calls actually RESOLVE? ─────────
 * A count gate is ABSENCE-type: it forbids bad patterns, so it is always satisfiable
 * by DELETION. Written this way it passed a change that made the panel throw
 * `CxCellMetering is not defined` (ADR-0048 §67.4). Lint cannot find "the feature is
 * gone"; a test cannot find "the style is broken" — so BOTH must run (§67.3).
 *
 * The loaded set is DECLARED FROM THE BOOT MANIFEST, not guessed: boot.rs embeds a
 * literal list of asset files, and the page gets exactly those. A `Cx<Name>` used by
 * the view must be provided by one of them.
 */
const BOOT = path.join(__dirname, '..', 'src', 'boot.rs');
const ASSETS = path.join(__dirname, '..', 'assets');
let loaded = [], usedGlobals = [];
try {
  const boot = fs.readFileSync(BOOT, 'utf8');
  const names = (boot.match(/"([A-Za-z0-9_.]+[.]html)"/g) || [])
    .map(function (x) { return x.replace(/"/g, ''); })
    .concat((boot.match(/"([A-Za-z0-9_.]+[.]js)"/g) || []).map(function (x) { return x.replace(/"/g, ''); }));
  for (const f of names) {
    const fp = path.join(ASSETS, f);
    if (!fs.existsSync(fp)) { continue; }
    const src = fs.readFileSync(fp, 'utf8');
    (src.match(/(?:window|root)\.(Cx[A-Za-z0-9_]+)\s*=/g) || [])
      .concat(src.match(/(?:^|\n)\s*var\s+(Cx[A-Za-z0-9_]+)\s*=/g) || []).forEach(function (m) {
      loaded.push(m.replace(/^(window|root)\./, '').replace(/^\s*var\s+/, '').replace(/\s*=$/, ''));
    });
  }
  (code.match(/\b(Cx[A-Za-z0-9_]+)\s*\./g) || []).forEach(function (m) {
    usedGlobals.push(m.replace(/\s*\.$/, ''));
  });
} catch (e) { /* handled below */ }
/* ── M0+: ONE LAYER DEEPER — MEMBERS, NOT JUST GLOBALS (§69.2) ────────────────
 * Last time the panel crashed on a MEMBER that did not exist, while this gate only
 * checked that the GLOBAL was provided. Once cell_metering.js enters the manifest,
 * that crash mode would pass. The member table is READ OFF THE LOADED ASSETS (their
 * export object literals) — not guessed, not maintained here. */
const membersByGlobal = {};
try {
  /* BOTH export shapes, and members are UNIONED across every file that touches the
   * same global: `return { ... }` (factory style) and `window.CxX = { ... }` (direct
   * assignment). First draft only read the factory form and therefore reported
   * `CxWayout.build` — which exists (wayout.js:232) — as unknown: a FALSE POSITIVE.
   * An imprecise gate produces false reds, and a falsely-red gate gets switched off. */
  const boot2 = fs.readFileSync(BOOT, 'utf8');
  const files = (boot2.match(/"([A-Za-z0-9_.]+[.](html|js))"/g) || []).map(function (x) { return x.replace(/"/g, ''); });
  for (const f of files) {
    const fp = path.join(ASSETS, f);
    if (!fs.existsSync(fp)) { continue; }
    const src = fs.readFileSync(fp, 'utf8');
    for (const g of Array.from(new Set((src.match(/(?:window|root)\.(Cx[A-Za-z0-9_]+)/g) || [])
      .map(function (x) { return x.replace(/^(window|root)\./, ''); })))) {
      membersByGlobal[g] = membersByGlobal[g] || [];
      /* (a) direct assignment: window.CxX = { a: ..., b: ... } */
      const direct = new RegExp('(?:window|root)\\.' + g + '\\s*=\\s*\\{([\\s\\S]*?)\\}').exec(src);
      if (direct) {
        (direct[1].match(/([A-Za-z_$][\w$]*)\s*:/g) || []).forEach(function (m) {
          membersByGlobal[g].push(m.replace(/\s*:$/, ''));
        });
      }
      /* (b) member-wise accretion: PT.render = ... ; window.CxX.build = ... */
      (src.match(new RegExp(g + '\\.([A-Za-z_$][\\w$]*)\\s*=', 'g')) || []).forEach(function (m) {
        membersByGlobal[g].push(m.replace(new RegExp('^' + g + '\\.'), '').replace(/\s*=$/, ''));
      });
      /* (c) EVERY `return { ... }` in the file (not just the first): UMD/IIFE modules
       * look like `var CxX = (function () { ... return { tokOf: ..., add: ... }; })()`,
       * so the export object is an inner return. Taking only the first return made this
       * gate report tokOf/add/A — which all exist — as unknown (a FALSE POSITIVE). */
      (src.match(/return\s*\{([\s\S]*?)\}\s*;/g) || []).forEach(function (blk) {
        (blk.match(/([A-Za-z_$][\w$]*)\s*:/g) || []).forEach(function (m) {
          membersByGlobal[g].push(m.replace(/\s*:$/, ''));
        });
      });
    }
  }
} catch (e) { /* handled below */ }
const badMembers = [];
(code.match(/\b(Cx[A-Za-z0-9_]+)[.]([A-Za-z_$][\w$]*)/g) || []).forEach(function (m) {
  const parts = m.split('.');
  const g = parts[0], mem = parts[1];
  if (loaded.indexOf(g) === -1) { return; }          /* reported by the global check */
  const known = membersByGlobal[g] || [];
  if (known.length && known.indexOf(mem) === -1) { badMembers.push(g + '.' + mem); }
});
console.log((badMembers.length ? '  FAIL ' : '  ok   ')
  + 'MEMBER — every member the view calls is exported by the loaded asset'
  + (badMembers.length ? ' (unknown: ' + Array.from(new Set(badMembers)).join(', ') + ')' : ''));
if (badMembers.length) { bad++; }
const unresolved = Array.from(new Set(usedGlobals)).filter(function (n) { return loaded.indexOf(n) === -1; });
console.log((unresolved.length ? '  FAIL ' : '  ok   ')
  + 'REFERENCE — every Cx* global the view calls is provided by a boot-manifest asset'
  + (unresolved.length ? ' (unresolved: ' + unresolved.join(', ') + ')' : ''));
if (unresolved.length) { bad++; }

if (process.argv.indexOf('--emit-baseline') > -1) {
  console.log(JSON.stringify(counts));
  process.exit(0);
}

const total = Object.keys(counts).reduce(function (a, k) { return a + counts[k]; }, 0);
const baseTotal = Object.keys(BASELINE).reduce(function (a, k) { return a + BASELINE[k]; }, 0);
/* THE TARGET IS ZERO, NOT THE BASELINE (ADR-0048 §65.5). Using the baseline as a
 * tolerance made this very checker green while the cell was 100% broken — the disease
 * it exists to treat, committed while writing it. N is a RECORDED STARTING POINT; the
 * criterion is 0, so the gate is RED TODAY and gets greener only by real work. */
for (const k of Object.keys(counts)) {
  const asserted = ASSERTED.indexOf(k) > -1;
  const okNow = asserted ? (counts[k] === 0) : true;
  console.log((asserted ? (okNow ? '  ok   ' : '  FAIL ') : '  note ')
    + k + ': ' + counts[k] + ' (recorded start ' + BASELINE[k]
    + (asserted ? ', target 0)' : ', registered — not asserted)'));
  if (!okNow) { bad++; }
}
console.log('  TARGET  ' + path.relative(process.cwd(), TARGET) + '   [' + SCOPE_NOTE + ']');
console.log('  TOTAL   ' + total + ' (recorded start ' + baseTotal + ', target 0)');
console.log(bad === 0
  ? 'OK — M3 REACHED: the target cell carries 0 occurrences of the four classes'
  : 'FAILED (M0, expected) — the target cell still carries ' + total
    + ' occurrences; M3 is this reaching 0');
process.exit(bad === 0 ? 0 : 1);
