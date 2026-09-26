#!/usr/bin/env node
/* The anchoring-table validator ADR-0022 §4.1 asks for.
 *
 * WHY THIS FILE EXISTS. §4.1 made "every `[派生自 X]` must really exist; if it
 * cannot be found, it is an impersonation" an acceptance criterion — and then
 * left it as a sentence. A criterion nobody can run is the same shape as the
 * hand-rebuilt ADR index this ecosystem already removed once: one fact, two
 * derivations, one of them stale.
 *
 * WHAT IT ASSERTS (these can be settled by reading the repository):
 *   1. every N-xxx row is complete — dimension, rule, source type, hardness
 *   2. the table is well formed — exactly five columns, so a stray `|` inside a
 *      cell cannot silently shift a hardness into the source column
 *   3. `[派生自 N-xxx]` points at a row that exists in this table
 *   4. every `ADR-NNNN` in the repository resolves to a real file in SOME
 *      ecosystem repo — cross-repo references resolve by fact, not by assuming
 *      the current repo's name (see the ADR's citation convention)
 *   5. a row whose hardness contains 陶土 carries the `[ENG]` marker §2.4
 *      requires
 *   6. no `[待锚定]` row survives — the four that existed were graded in N6
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT. Phrases like `[派生自 容忍降级]` or
 * `[派生自 极致复用]` name principles this repo has no registry for. Checking
 * them would mean inventing that registry here, which is exactly the
 * impersonation §2.4 is about: a validator that manufactures its own anchors
 * certifies nothing. They are REPORTED (so a human sees them drift) and never
 * asserted. Same for the reverse direction: this tool never rewrites the ADR.
 *
 * FAIL-OPEN on the one input it cannot supply: when the sibling repos are not
 * checked out, cross-repo resolution is skipped with a warning rather than
 * failing. A gate that refuses everything is a 100%-coverage, zero-assertion
 * test — and it would make this repo uncommittable wherever it is checked out
 * alone. The precedent is helix-mind's ADR-header hook.
 *
 * NON-VACUOUS BY CONSTRUCTION: the audit functions are pure, and the self-test
 * below feeds each of them a synthetic violation that MUST be reported. A
 * scraper that stopped matching fails its own self-test here instead of
 * reporting a clean table.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CELLRIX = path.join(__dirname, '..');
const ADR_PATH = path.join(CELLRIX, 'docs/decisions/ADR-0022-panel-navigation-constraints.md');
const SKIP_DIRS = new Set(['target', 'node_modules', '.git', 'data', 'dist', 'archive']);

let pass = 0, fail = 0;
const reported = [];
function check(label, cond, detail) {
  const tail = detail ? '  [' + detail + ']' : '';
  if (cond) { pass++; console.log('  PASS  ' + label + tail); }
  else { fail++; console.log('  FAIL  ' + label + tail); }
}
/* An observation, not a verdict. Printed, never counted as a failure. */
function report(label, items) {
  if (items.length) reported.push(label + ' (' + items.length + '): ' + items.slice(0, 8).join(' · '));
}

/* ── the ecosystem map ─────────────────────────────────────────────────────
 * Derived by looking at which siblings actually carry `docs/decisions/`, not
 * from a list written here: a hardcoded roster is a second, hand-maintained
 * copy of a fact the filesystem already carries. */
/* LOCKFILE MODE (ADR-0048 §159). The verdict must not depend on which directories happen
 * to sit next to the checkout: measured, this check was BLIND on a clean clone (it never saw
 * an injected dangling reference — mutual information 0.000 bits) and only became sharp when
 * a sibling happened to exist. Cargo.lock / go.sum solve exactly this: a DERIVED artifact is
 * committed so resolution works without the registry, and freshness is an EXPLICIT action.
 *   · the lockfile is the input the verdict is computed from (hermetic, 1 bit everywhere);
 *   · siblings present ⇒ `--refresh` rewrites it; a diff is a DECLARED stale, not a silent one;
 *   · neither present ⇒ exit 5 (input source unavailable) — never a silent SKIP. */
const LOCK = path.join(CELLRIX, 'docs', 'adr-ecosystem.lock.json');
function scanSiblings() {
  const parent = path.join(CELLRIX, '..');
  const map = {}, roots = [];
  let entries = [];
  try { entries = fs.readdirSync(parent); } catch (e) { return { map, roots }; }
  const selfName = path.basename(CELLRIX);
  for (const name of entries) {
    if (name.startsWith('.') || name === selfName) continue;   /* SELF IS NOT A SIBLING:
      * counting it made "no siblings" undetectable (the `roots.length > 1` magic this
      * replaced), so a missing input never reached exit 5. */
    const dir = path.join(parent, name, 'docs', 'decisions');
    let files = [];
    try { if (!fs.statSync(dir).isDirectory()) continue; files = fs.readdirSync(dir); }
    catch (e) { continue; }
    roots.push(name);
    for (const f of files) {
      const m = /^ADR-(\d{4})/.exec(f);
      if (m) (map[m[1]] = map[m[1]] || []).push(name);
    }
  }
  return { map, roots };
}
function ecosystem() {
  const live = scanSiblings();
  if (process.argv.indexOf('--refresh') > -1 && live.roots.length > 0) {
    const sources = {};
    Object.keys(live.map).forEach(function (n) { sources[n] = live.map[n].slice().sort(); });
    fs.writeFileSync(LOCK, JSON.stringify({ 'generated-from': 'sibling checkouts',
      sources: sources, note: 'derived artifact, committed on purpose (ADR-0048 §159)' }, null, 1) + '\n');
    console.log('  refreshed ' + LOCK + ' (' + Object.keys(sources).length + ' ADR numbers)');
  }
  let locked = null;
  try { locked = JSON.parse(fs.readFileSync(LOCK, 'utf8')).sources; } catch (e) { locked = null; }
  if (!locked) {
    if (live.roots.length === 0) {
      console.log('  INPUT-SOURCE-UNAVAILABLE: no lockfile and no sibling checkouts —'
        + ' the reference check cannot be evaluated (exit 5, rule ⑳)');
      process.exit(5);
    }
    return { map: live.map, roots: live.roots, available: true, source: 'siblings (no lockfile yet)' };
  }
  const map = {};
  Object.keys(locked).forEach(function (n) { map[n] = locked[n].slice(); });
  /* A COMPUTED `stale` THAT IS NEVER PRINTED IS A SILENT ONE (ADR-0048 §160): the comment
   * above promises "a diff is a DECLARED stale" while the value only ever reached a `source`
   * string nobody printed. Measured: with a lockfile deliberately out of step with the
   * siblings the tool printed OK and exited 0. A drifting lockfile then degrades from
   * "1 bit everywhere" to "1 bit judging a stale table". Now it SPEAKS and it has a code. */
  const stale = live.roots.length > 0
    && JSON.stringify(Object.keys(live.map).sort()) !== JSON.stringify(Object.keys(locked).sort());
  if (stale) {
    const missing = Object.keys(live.map).filter(function (n) { return !locked[n]; });
    const extra = Object.keys(locked).filter(function (n) { return !live.map[n]; });
    console.log('  DECLARED STALE: the lockfile differs from the sibling checkouts'
      + ' (live-only: ' + missing.length + ', lockfile-only: ' + extra.length + ')'
      + ' — run `--refresh` and commit the diff (ADR-0048 §160).');
    console.log('  exit 3 = declared absent/needs action; this is NOT a red (rule ⑳).');
    process.exit(3);
  }
  return { map: map, roots: live.roots, available: true, source: 'lockfile' };
}

/* ── the anchoring table ─────────────────────────────────────────────────── */
const ROW = /^\|\s*(N-\d{3})\s*\|/;
function parseRows(text) {
  const rows = [];
  text.split('\n').forEach((line, i) => {
    if (!ROW.test(line)) return;
    const c = line.split('|').map((s) => s.trim());
    rows.push({ line: i + 1, cells: c, id: c[1], dim: c[2], rule: c[3], src: c[4], hard: c[5] });
  });
  return rows;
}

function auditRows(rows) {
  const bad = { incomplete: [], shape: [], dangling: [], noEng: [] };
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    /* c[0] and c[6] are the empty ends of `| a | b | c | d | e |`. */
    if (r.cells.length !== 7) { bad.shape.push('line ' + r.line + ' has ' + r.cells.length + ' parts'); continue; }
    if (!r.dim || !r.rule || !r.src || !r.hard) bad.incomplete.push('line ' + r.line + ' (' + r.id + ')');
    for (const ref of (r.src.match(/N-\d{3}/g) || [])) {
      if (!ids.has(ref)) bad.dangling.push('line ' + r.line + ' (' + r.id + ' → ' + ref + ')');
    }
    if (r.hard.includes('陶土') && !r.src.includes('[ENG]')) {
      bad.noEng.push('line ' + r.line + ' (' + r.id + ' is 陶土, source lacks [ENG])');
    }
  }
  return bad;
}

/* Anchors that are prose rather than identifiers: named for a human to read,
 * never asserted — see the header. */
function proseAnchors(rows) {
  const out = new Set();
  for (const r of rows) {
    for (const m of (r.src.match(/\[派生自\s+([^\]]+)\]/g) || [])) {
      const inner = m.replace(/^\[派生自\s+/, '').replace(/\]$/, '').trim();
      if (/^N-\d{3}/.test(inner)) continue;
      if (/^ADR-\d{4}/.test(inner)) continue;
      out.add(inner);
    }
  }
  return Array.from(out);
}

/* ── ADR references, repository-wide ─────────────────────────────────────── */
function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(md|rs|html|js|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

function adrRefs(files) {
  const refs = new Map(); /* number -> [file:line] */
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    text.split('\n').forEach((line, i) => {
      for (const m of (line.match(/ADR-\d{4}/g) || [])) {
        const n = m.slice(4);
        if (!refs.has(n)) refs.set(n, []);
        const rel = path.relative(CELLRIX, f);
        if (refs.get(n).length < 4) refs.get(n).push(rel + ':' + (i + 1));
      }
    });
  }
  return refs;
}

function auditRefs(refs, map, available) {
  const unresolved = [];
  if (!available) return unresolved;
  for (const [n, where] of refs) {
    if (!map[n]) unresolved.push('ADR-' + n + ' ← ' + where.join(', '));
  }
  return unresolved;
}

/* ── self-test: each audit must report a synthetic violation ─────────────── */
function selfTest() {
  const isGood = ['', 'N-900', '1 维度', '一条约束', '[派生自 N-901] + [ENG]', '钻石 + 陶土', ''];
  const good = parseRows('| N-900 | x | y | z | w |');
  const badShape = parseRows('| N-900 | 1 维度 | 约束里有个 | 竖线 | [ENG] | 陶土 |');
  const rows = [
    { line: 1, cells: isGood, id: 'N-900', dim: '1', rule: 'r', src: '[派生自 N-999]', hard: '钻石' },
    { line: 2, cells: isGood, id: 'N-901', dim: '1', rule: 'r', src: '[派生自 N-900]', hard: '陶土' },
    { line: 3, cells: isGood, id: 'N-902', dim: '1', rule: 'r', src: '[ENG]', hard: '' }
  ];
  const a = auditRows(rows);
  check('the row scanner finds the rows it was given', good.length === 1, JSON.stringify(good.map((r) => r.id)));
  check('a cell containing a `|` is caught as a shape error',
    auditRows(badShape).shape.length === 1, JSON.stringify(auditRows(badShape).shape));
  check('a `[派生自 N-xxx]` pointing outside the table is caught',
    a.dangling.length === 1, JSON.stringify(a.dangling));
  check('a 陶土 row without `[ENG]` is caught', a.noEng.length === 1, JSON.stringify(a.noEng));
  check('an incomplete row is caught', a.incomplete.length === 1, JSON.stringify(a.incomplete));
  check('a resolvable reference is NOT reported',
    auditRefs(new Map([['0022', ['x']]]), { '0022': ['Cellrix'] }, true).length === 0);
  check('an unresolvable reference IS reported',
    auditRefs(new Map([['0099', ['x']]]), { '0022': ['Cellrix'] }, true).length === 1);
  check('cross-repo resolution is skipped, not failed, when siblings are absent',
    auditRefs(new Map([['0099', ['x']]]), {}, false).length === 0);
  check('prose anchors are reported, never asserted',
    proseAnchors(rows).length === 0 && proseAnchors([{ src: '[派生自 容忍降级]' }]).length === 1);
}

/* ── run ─────────────────────────────────────────────────────────────────── */
console.log('adr anchor — the anchoring table can be checked (ADR-0022 §4.1)');
selfTest();

let adrText = '';
try { adrText = fs.readFileSync(ADR_PATH, 'utf8'); }
catch (e) { check('ADR-0022 is readable', false, e.message); }
if (adrText) {
  const rows = parseRows(adrText);
  check('the anchoring table has rows', rows.length > 0, rows.length + ' rows');
  const bad = auditRows(rows);
  check('every row is complete (dimension · rule · source · hardness)',
    bad.incomplete.length === 0, bad.incomplete.join(' | '));
  check('the table is well formed (five columns per row)',
    bad.shape.length === 0, bad.shape.join(' | '));
  check('every `[派生自 N-xxx]` resolves inside this table',
    bad.dangling.length === 0, bad.dangling.join(' | '));
  check('every 陶土 row carries the `[ENG]` marker §2.4 requires',
    bad.noEng.length === 0, bad.noEng.join(' | '));
  check('no `[待锚定]` row survives (N6 graded all four)',
    rows.every((r) => !(r.src + r.hard).includes('[待锚定]')),
    rows.filter((r) => (r.src + r.hard).includes('[待锚定]')).map((r) => r.id).join(' | '));
  report('prose anchors (reported, not asserted — this repo has no principle registry)', proseAnchors(rows));
}

const eco = ecosystem();
const refs = adrRefs(walk(CELLRIX, []));
if (eco.available) {
  const unresolved = auditRefs(refs, eco.map, true);
  check('every ADR reference resolves somewhere in the ecosystem',
    unresolved.length === 0, unresolved.join(' | '));
  console.log('        ecosystem roots: ' + eco.roots.join(', ') + ' · ' +
    refs.size + ' distinct ADR numbers referenced by Cellrix');
} else {
  console.log('  SKIP  cross-repo ADR resolution — sibling repos not checked out (fail-open)');
}
report('ADR numbers resolving outside Cellrix (cross-repo references: qualify them when editing)',
  [...refs.keys()].filter((n) => eco.available && eco.map[n] && !eco.map[n].includes('Cellrix')).map((n) => 'ADR-' + n));

console.log('');
for (const r of reported) console.log('  note  ' + r);
console.log((fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
