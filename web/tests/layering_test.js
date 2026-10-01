#!/usr/bin/env node
/* THE LAYERS ARE ENFORCED, NOT ASSUMED (ADR-0048 §308).
 *
 * The constraint set (L0 fact store · L1 write path · L2 projection/render · L3 envelope) makes four
 * claims. Measured 2026-09-30: L0 holds *in fact* — the 18 "view-like" hits in `session_events` were
 * `preview` / `review`, i.e. FALSE POSITIVES, which is why every pattern below is word-bounded. What was
 * missing was not the property but a criterion guarding it: a future import would have gone unnoticed.
 *
 * Usage: node layering_test.js [panel_base_url]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REQUIRES = 'panel-http';

const ROOT = path.join(__dirname, '..', '..', '..');   /* the WORKSPACE root: repos are siblings */
const ANAPHASE = path.join(ROOT, 'anaphase-helix', 'src');
const CELLRIX = path.join(__dirname, '..');

/* DECLARED ENGINEERING THRESHOLDS (ADR-0022 §2.5): a tuned number carries a NAME and a reason —
 * a bare literal inside an assertion is what the runner's own rule forbids. */
const MIN_L0_FILES = 1;                 /* one module is enough to prove the layer is scannable */
const NO_OFFENDERS = 0;                 /* a layer constraint tolerates ZERO references, declared not typed */
const ONE_INJECTED = 1;                 /* the mutation must be caught exactly once */
const MIN_PERIODS_FOR_INVARIANTS = 2;   /* with fewer, "no dangling parent" says nothing */

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) { return out; }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { walk(f, out); } else if (e.name.endsWith('.rs') || e.name.endsWith('.js')) { out.push(f); }
  }
  return out;
}
/* WORD-BOUNDED, AND LAYER-APPROPRIATE (both lessons came from false positives):
 *   · `preview` / `review` must not read as view-layer references  -> word boundaries;
 *   · `window` in Rust names the QUERY WINDOW (`filled after the window is known`), not the DOM
 *     -> the Rust L0 pattern carries VIEW-MODULE names, never DOM words;
 *   · a TRAILING comment is not code either -> strip `//` and `/*` tails, not only whole-line comments. */
const VIEW_MODULES = /\b(?:CxPanelTree|prove_track|panel_tree|cell_metering)\b/;
const DOM_WORDS = /\b(?:document|window|innerHTML|localStorage|requestAnimationFrame)\b/;
function offenders(files, rx) {
  const hits = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*$/, '');   /* a COMMENT imports nothing */
      if (rx.test(code)) { hits.push(path.relative(ROOT, f) + ':' + (i + 1) + '  ' + line.trim().slice(0, 70)); }
    });
  }
  return hits;
}

/* ---- C1: L0 (the fact store) must not know the view ------------------------------------- */
const l0 = walk(path.join(ANAPHASE, 'session_events'));
ok('L0 (session_events) exists and is scannable', l0.length >= MIN_L0_FILES, l0.length + ' file(s)');
const l0hits = offenders(l0, VIEW_MODULES);   /* Rust L0: view module names only */
ok('C1: L0 imports no view-layer identifiers (ADR-0048 §308)', l0hits.length === NO_OFFENDERS, l0hits.slice(0, 2).join(' | '));
ok('C1 MUTATION: the pattern is not vacuous (it DOES catch an injected reference)',
  VIEW_MODULES.test('const x = CxPanelTree.mountSidebar;') && DOM_WORDS.test('el.innerHTML = s;'),
  'word-bounded pattern matches a real reference');

/* ---- C2: the write path must not import the projection ---------------------------------- */
const writePath = walk(path.join(ANAPHASE, 'run_cycle')).concat(
  [path.join(ANAPHASE, 'session_events', 'types_and_stream.rs')].filter((f) => fs.existsSync(f)));
const wHits = offenders(writePath, /\b(?:prove_track|panel_tree|cell_metering|CxPanelTree)\b/);
ok('C2: the write path does not import the projection (writing cannot see the view)',
  wHits.length === NO_OFFENDERS, wHits.slice(0, 2).join(' | '));

/* ---- C3: the envelope is ABSENT, and that is NAMED, not passed -------------------------- */
const envelope = walk(ANAPHASE).filter((f) => /ci144|envelope/i.test(f));
if (envelope.length === 0) {
  /* A criterion that cannot fail would be a tautology; the honest verdict is UNVERIFIED, named the same
   * way the skip roster names its unverified switches (§294). */
  console.log('  UNVERIFIED TODAY: L3 envelope (CI-144) is not present in this checkout — '
    + 'its "no domain imports" rule cannot be judged yet');
} else {
  const eHits = offenders(envelope, /\b(?:PeriodSummary|SessionEvent|list_periods|read_period)\b/);
  ok('C3: the envelope imports no domain semantics', eHits.length === NO_OFFENDERS, eHits.slice(0, 2).join(' | '));
}

/* ---- C4: views write no state — covered by the one-writer rule, REFERENCED not duplicated - */
const navState = fs.readFileSync(path.join(__dirname, 'nav_state_test.js'), 'utf8');
ok('C4: "views write no state" is enforced by the one-writer criterion (referenced, not re-implemented)',
  /every write to the selection is inside/.test(navState) && /META_WRITER/.test(navState),
  'nav_state_test.js owns the one-writer rule');

/* ---- the theorem: kept is ancestor-closed ⇒ no dangling parent (live) -------------------- */
let base = process.argv[2] || process.env.CELLRIX_PANEL || '';
if (!base) {
  for (const c of [path.join(ROOT, 'chain.json'), path.join(ROOT, 'anaphase-helix', 'ecosystem', 'chain.json')]) {
    try {
      const d = JSON.parse(fs.readFileSync(c, 'utf8'));
      const comp = (d.components || []).filter((x) => x && x.name === 'panel')[0];
      if (comp && comp.port) { base = 'http://127.0.0.1:' + comp.port; break; }
    } catch (e) { /* next */ }
  }
}
if (!base) { console.log('NEEDS-INPUT: no panel address declared (chain.json components[panel])'); process.exit(3); }

(async () => {
  let ps = [];
  try {
    const r = await fetch(base + '/api/sessions?limit=500', { signal: AbortSignal.timeout(8000) });
    if (!r.ok) { console.log('NEEDS-INPUT: panel answered ' + r.status); process.exit(3); }
    ps = (await r.json()).periods || [];
  } catch (e) { console.log('NEEDS-INPUT: panel unreachable at ' + base); process.exit(3); }
  if (ps.length < MIN_PERIODS_FOR_INVARIANTS) { console.log('NEEDS-INPUT: fewer than ' + MIN_PERIODS_FOR_INVARIANTS + ' periods — the invariants need data'); process.exit(3); }

  const by = {};
  ps.forEach((p) => { by[p.period_id] = p; });
  const dangling = ps.filter((p) => p.parent && !by[p.parent]).map((p) => p.period_id);
  const dupes = ps.map((p) => p.period_id).filter((id, i, a) => a.indexOf(id) !== i);
  ok('INVARIANT (theorem): a kept period\'s parent is kept — no dangling parent in the window',
    dangling.length === NO_OFFENDERS, dangling.slice(0, 2).join(',') || 'none');
  ok('INVARIANT: ids are ISSUED, never content-derived — period_id is unique  [job_id may repeat]',
    dupes.length === NO_OFFENDERS, dupes.slice(0, 2).join(',') || 'unique');
  /* MUTATIONS: the two checks above must be able to go red. */
  const brokenDangle = ps.map((p, i) => (i === 0 ? Object.assign({}, p, { parent: 'run-missing' }) : p));
  const bBy = {}; brokenDangle.forEach((p) => { bBy[p.period_id] = p; });
  ok('INVARIANT MUTATION: an injected dangling parent IS detected (the check is not vacuous)',
    brokenDangle.filter((p) => p.parent && !bBy[p.parent]).length === 1);
  const brokenDup = ps.concat([Object.assign({}, ps[0])]);
  ok('INVARIANT MUTATION: a duplicated period_id IS detected',
    brokenDup.map((p) => p.period_id).filter((id, i, a) => a.indexOf(id) !== i).length > 0);

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(4); });
