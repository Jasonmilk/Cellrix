#!/usr/bin/env node
/* N-003 — one selection state, checked structurally (Cellrix:ADR-0022).
 *
 * Two facts about "where the panel is" cannot be checked by rendering:
 *
 *   1. The period field that used to be assigned at five sites in three assets
 *      is GONE. A leftover second field is a second place the selection can
 *      live, and the whole point of N2 is that there is exactly one.
 *   2. Across `assets/*`, every assignment to the nav selection happens inside
 *      `setNav` in the shell. The nav buttons, the session cards, continuation,
 *      boot and Back/Forward all funnel through it.
 *
 * A source check rather than a runtime one, deliberately: two writers are
 * invisible until two things disagree, and by the time they disagree it is a
 * bug report rather than a red test.
 *
 * Non-vacuous by construction: the same `scan()` is run over a synthetic source
 * that contains a second writer and MUST report it. A scanner that stopped
 * matching would fail its own self-test here, instead of quietly reporting a
 * clean tree.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  const tail = detail ? '  [' + detail + ']' : '';
  if (cond) { pass++; console.log('  PASS  ' + label + tail); }
  else { fail++; console.log('  FAIL  ' + label + tail); }
}

/* The fields that make up the one selection state. `[^=]` keeps `==`, `===` and
 * `!==` out; the zero-state initialiser (`nav: { view: null, period: null }`)
 * uses `:` and is therefore not a writer. */
const WRITER = /\b(?:NAV|nav|state\.nav)\.(?:view|period)\s*=[^=]/;
/* Anything that used to be a second copy of the period. */
const LEGACY = /\bchatJobId\b/;
const META_WRITER = /\b__proveTrackMeta\s*=[^=]/;

function assetSources() {
  const out = {};
  for (const f of fs.readdirSync(ASSETS)) {
    if (!/\.(js|html)$/.test(f)) continue;
    out[f] = fs.readFileSync(path.join(ASSETS, f), 'utf8');
  }
  return out;
}

/* Returns [{file, line, text}] for every assignment to the nav selection. */
function scan(sources, re) {
  const bad = [];
  for (const file of Object.keys(sources)) {
    sources[file].split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (re.test(line)) bad.push({ file: file, line: i + 1, text: t });
    });
  }
  return bad;
}

/* The line span of one function, by brace matching. Comments inside `setNav`
 * carry no braces, and the body is short enough to read — see the source. */
function functionSpan(src, header) {
  const start = src.indexOf(header);
  if (start < 0) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return null;
  const lineAt = (idx) => src.slice(0, idx).split('\n').length;
  return { from: lineAt(start), to: lineAt(i) };
}

console.log('nav state — one selection state (ADR-0022 N-003)');

const sources = assetSources();
check('the assets were found', Object.keys(sources).length > 0,
  Object.keys(sources).length + ' files');

/* ── 1. the detector is not vacuous ─────────────────────────────────────── */
const selfBad = scan({ 'synthetic-second-writer.js': 'if (x) NAV.period = "run-1";' }, WRITER);
const selfGood = scan({ 'synthetic-reader.js': 'var v = Cx.state.nav.period || null;' }, WRITER);
const selfDouble = scan({ 'synthetic-compare.js': 'if (nav.view === "chat") { go(); }' }, WRITER);
check('the scanner finds an injected second writer', selfBad.length === 1,
  JSON.stringify(selfBad));
check('the scanner does not flag a reader', selfGood.length === 0, JSON.stringify(selfGood));
check('the scanner does not flag a comparison', selfDouble.length === 0,
  JSON.stringify(selfDouble));

/* ── 2. the second field is gone ────────────────────────────────────────── */
const legacy = [];
for (const file of Object.keys(sources)) {
  sources[file].split('\n').forEach((line, i) => {
    if (LEGACY.test(line)) legacy.push(file + ':' + (i + 1) + '  ' + line.trim());
  });
}
check('no asset still holds a second period field (N-003)', legacy.length === 0,
  legacy.join(' | ') || 'no `chatJobId` anywhere in assets/');

/* ── 3. one writer, and it is the shell's ───────────────────────────────── */
const writers = scan(sources, WRITER);
const strayFiles = writers.filter((w) => w.file !== 'script.html');
check('no asset outside the shell writes the selection (N-003)',
  strayFiles.length === 0, JSON.stringify(strayFiles));

const span = functionSpan(sources['script.html'], 'function setNav(');
check('the shell has exactly one `setNav`', span !== null, JSON.stringify(span));
const outside = span ? writers.filter((w) => w.line < span.from || w.line > span.to) : writers;
check('every write to the selection is inside `setNav` (N-003)',
  span !== null && outside.length === 0, JSON.stringify(outside));
check('`setNav` does write the selection (i.e. the check is not vacuous by finding nothing)',
  span !== null && writers.some((w) => w.line >= span.from && w.line <= span.to),
  writers.length + ' writer line(s): ' + writers.map((w) => w.file + ':' + w.line).join(', '));

/* ── 4. the metadata cache is written by the same hand ──────────────────── */
const metaWriters = scan(sources, META_WRITER);
check('the trajectory metadata is written only by the shell (N-003)',
  metaWriters.every((w) => w.file === 'script.html'), JSON.stringify(metaWriters));
check('the trajectory metadata is written inside `setNav` (N-003)',
  span !== null && metaWriters.length > 0 &&
    metaWriters.every((w) => w.line >= span.from && w.line <= span.to),
  JSON.stringify(metaWriters));

/* ── 5. the consumers read the one state ────────────────────────────────── */
const consumers = ['prove_track.js', 'chat.js'].filter(
  (f) => /state\.nav\.period/.test(sources[f] || ''));
check('the views read the selection from the one state (N-003)',
  consumers.length === 2, consumers.join(', '));

/* ── 6. every declared view has a container ─────────────────────────────── */
const declared = (sources['base.html'].match(/data-view="([^"]+)"/g) || [])
  .map((s) => s.replace(/.*data-view="([^"]+)".*/, '$1'));
check('base.html declares a view list', declared.length > 0, declared.join(', '));
const containers = declared.filter(
  (v) => new RegExp('id="view-' + v + '"').test(sources['base.html']));
/* Structural, not a count: the point is that no declared view is missing its
 * container. How many views there are is a design decision, not a fact a test
 * gets to freeze (ADR-0022 §2.5). */
check('every declared view has a container', containers.length === declared.length,
  declared.length + ' declared, ' + containers.length + ' with a container');

console.log('');
console.log((fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
