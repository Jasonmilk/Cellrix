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
 * uses `:` and is therefore not a writer.
 *
 * ⚠️ This list must stay **as long as `parseHash`/`buildHash`'s field list**.
 * Measured (2026-09-24 review): after `sup` was added to `period_normalize.js`
 * as the fourth field, this regex still had three — so the "one selection
 * state" (N-003) structural guard **could no longer see the new field**, while
 * the commit message for that same change claimed "nav_state 14 (sup written
 * by setNav)". A criterion that is present but no longer bites is exactly what
 * rule 9 exists to treat.
 * ⇒ The self-test in §1 injects **one writer per field**, so dropping any field
 * turns this red on the spot. */
const WRITER = /\b(?:NAV|nav|state\.nav)\.(?:view|period|panel|sup)\s*=[^=]/;
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

/* ── 1. the detector is not vacuous, and it covers EVERY field ──────────────
 *
 * The authoritative field list is **not copied by hand here**: it is derived
 * from the `parseHash` zero-state literal in `period_normalize.js` — the single
 * source for the shape of the selection state. Then **every field** is injected
 * once.
 *
 * Why per field: injecting one "representative" field cannot prove the list is
 * complete. Measured (2026-09-24): after `sup` was added to `parseHash`, the
 * `NAV.period = …` self-test was still fully green while the actual second
 * writer, `NAV.sup = …`, was no longer guarded. Once the self-test and the list
 * it guards share one source, adding a field makes this require the `WRITER`
 * update by itself. */
const DECLARED = (function () {
  const m = (sources['period_normalize.js'] || '').match(/var\s+out\s*=\s*\{([^}]*)\}/);
  return m ? m[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean) : null;
})();
check('the selection-state shape has one source (`parseHash` zero state)',
  Array.isArray(DECLARED) && DECLARED.length > 0, JSON.stringify(DECLARED));

const missed = (DECLARED || []).filter(
  (f) => scan({ 'synthetic-second-writer.js': 'if (x) NAV.' + f + ' = "v";' }, WRITER).length !== 1);
check('the scanner finds an injected second writer — for every field of the state',
  (DECLARED || []).length > 0 && missed.length === 0,
  missed.length ? 'NOT covered: ' + missed.join(', ') : (DECLARED || []).join(', '));

const selfGood = scan({ 'synthetic-reader.js': 'var v = Cx.state.nav.period || null;' }, WRITER);
const selfDouble = scan({ 'synthetic-compare.js': 'if (nav.view === "chat") { go(); }' }, WRITER);
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
/* §299 — VIEWING IS NOT RESUMING. The original intent stands: whoever reads the selection reads it
 * from the ONE state (no second field). What changed is WHO may read `nav.period`:
 *   · `prove_track.js` reads it as a VIEW (what am I looking at) — unchanged;
 *   · `chat.js` must NOT read it as its resume target, because the panel selects a default detail on
 *     boot: falling back to it made every first message continue that period ("no new conversations").
 * The second check pins the positive half — the resume target comes only from the explicit metadata. */
const readsPeriod = (f) => /state\.nav\.period/.test(sources[f] || '');
check('the views read the selection from the one state (N-003)',
  readsPeriod('prove_track.js'), 'prove_track=' + readsPeriod('prove_track.js'));
check('and `chat.js` does NOT treat the viewed period as a resume target (§299)',
  !readsPeriod('chat.js'),
  (sources['chat.js'] || '').match(/var job = [^\n]*/)?.[0] || 'no `var job =` line in chat.js');
/* §299.3 — THE READER MUST NAME THE SLOT THE WRITER USES. `setNav` stores the metadata in
 * `window.__proveTrackMeta`; the old reader looked for `nav.meta`, a name that never existed in the
 * state shape (`{view, period, panel, sup}`) — the channel had a writer and no reader, so clicking a
 * card could not continue anything. */
/* ── THE THIRD LAYER: REFS (ADR-0048 §307) ────────────────────────────────────────────────
 * Objects + edges existed; the POINTER did not. It is one explicit field with ONE writer, and the
 * checks below pin the four operations down to the code that performs them. */
check('the ref is its own state field, outside the hashed location state',
  /ref:\s*\{\s*current:/.test(sources['script.html'] || '') && !/nav:\s*\{[^}]*ref/.test(sources['script.html'] || ''),
  'ref must not share the `nav` slot');
check('`setRef` is the ONLY writer of the pointer (same discipline as `setNav`)',
  /function setRef\(/.test(sources['script.html'] || '')
    && (sources['session_list.js'] || '').indexOf('ref.current =') < 0
    && (sources['chat.js'] || '').indexOf('ref.current =') < 0,
  'writers outside script.html would make the pointer untraceable');
check('`chat.js` reads the pointer as the ONLY resume target (§307)',
  /Cx\.state\.ref && Cx\.state\.ref\.current/.test(sources['chat.js'] || '')
    && !/__proveTrackMeta/.test(sources['chat.js'] || ''),
  'the sticky metadata slot must not come back');
check('the four operations are present: new (✗) clears · choose sets · the reply ADVANCES',
  /Cx\.setRef\(null\)/.test(sources['session_list.js'] || '')
    && /Cx\.setRef\(id[,)]/.test(sources['session_list.js'] || '')   /* the optional 2nd arg is the conversation (M1d) */
    && /Cx\.setRef\(j\.period_id\)/.test(sources['chat.js'] || ''),
  'new / continue / fork+advance');
check('MUTATION: restoring the sticky slot would make these checks red (it is not a tautology)',
  !/__proveTrackMeta/.test(sources['chat.js'] || ''), 'chat.js carries no metadata slot');

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
