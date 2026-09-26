/* value_criterion_test — THE VALUE CRITERION, EXERCISED (ADR-0048 §122 / b1b-1 + b1b-2).
 *
 * Until now every green was STRUCTURAL (no dual encoding / shapes / names). This is the
 * first assertion whose subject is the NUMBER ITSELF: the value the cell shows must equal
 * the value computed independently from the event stream.
 *
 * THE ORACLE MUST NOT BE THE SYSTEM UNDER TEST: it does plain arithmetic over
 * data.completion_tokens and never calls project / allocate / foldedCell. b1b-2 needs that
 * to be executable, so the oracle region is scanned (comments stripped) and the scan is
 * asserted — an oracle that calls the SUT makes "equal" true by construction.
 *
 * Two outlets were named in §112 and both are checked here:
 *   tok outlet   : project(events).turns[i].tok   (the number)
 *   participation: which rows are present vs excluded (12 must NOT be counted)
 * The second is required because a ZERO-FILLED implementation also produces 12.
 */
const fs = require('fs');
const path = require('path');
/* CRASH != RED (same discipline as port_table_test / the gate): an uncaught error exits 4,
 * an assertion failure exits 1. A crash that exits 1 is indistinguishable from a red, and
 * that is exactly how a broken harness gets read as a finding. */
process.on('uncaughtException', function (e) {
  console.log('  TEST CRASHED (this is NOT a red and NOT a killed mutant): ' + e.message);
  process.exit(4);
});
const ROOT = process.env.PORTS_ROOT || path.join(__dirname, '..', '..', '..');
/* THE EVIDENCE IS IN VERSION CONTROL (ADR-0048 §128.1). The runtime corpus (`.helix/events`)
 * is deliberately NOT committed (ecosystem rule), so a criterion that needed it could not be
 * reproduced from a fresh clone — and M3 requires the evidence to be in version control.
 * Default = the in-repo synthetic fixture; VALUE_SAMPLE/CORPUS point at the real corpus,
 * which is then an ADDITION rather than a precondition. */
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const CORPUS_DIR = process.env.VALUE_CORPUS || path.join(ROOT, '.helix', 'events');
const USE_CORPUS = !!process.env.VALUE_SAMPLE;
const EV = USE_CORPUS ? CORPUS_DIR : FIXTURE_DIR;
const PINNED = process.env.VALUE_SAMPLE || 'pinned.events.jsonl';

/* ── ORACLE (independent) ───────────────────────────────────────────────────── */
function readRows(file) {
  return fs.readFileSync(path.join(EV, file), 'utf8').trim().split('\n')
    .filter(Boolean).map(function (l) { return JSON.parse(l); });
}
function readRowsIn(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n')
    .filter(Boolean).map(function (l) { return JSON.parse(l); });
}
function expectedTok(rows) {
  /* THREE DIFFERENT COUNTS, kept apart on purpose (the fixture with a null row caught this):
   *   measured   — the field exists AND has a number   => a PRESENT row, enters the sum
   *   unmeasured — the field exists but is null        => the "≥" marker, NOT in the sum
   *   rows       — every row, including those with no field at all
   * The first version collapsed the first two into "carriers" and passed only because the real
   * sample happened to have no null row — i.e. it was green for the wrong reason. */
  let sum = 0, measured = 0, unmeasured = 0;
  rows.forEach(function (e) {
    const d = e.data;
    if (!d || !Object.prototype.hasOwnProperty.call(d, 'completion_tokens')) { return; }
    if (d.completion_tokens === null) { unmeasured++; return; }
    sum += d.completion_tokens; measured++;
  });
  return { tok: sum, measured: measured, unmeasured: unmeasured, rows: rows.length };
}
/* ── end ORACLE ─────────────────────────────────────────────────────────────── */

let bad = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) bad++; };

/* The oracle region must not call the SUT (executable form of "independent"). */
(function () {
  const src = fs.readFileSync(__filename, 'utf8').split('── ORACLE')[1].split('── end ORACLE')[0]
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  const banned = ['project', 'allocate', 'foldedCell'].filter(function (n) {
    return new RegExp('\\b' + n + '\\b').test(src);
  });
  ok(banned.length === 0, 'oracle independence: the oracle does not call the SUT'
    + (banned.length ? ' (calls: ' + banned.join(', ') + ')' : ''));
}());

const M = require(path.join(__dirname, '..', 'assets', 'cell_metering.js'));
const rows = readRows(PINNED);
const oracle = expectedTok(rows);

/* ① SCOPE NON-EMPTY — on a sample with no metering row every comparison is 0 == 0. */
ok(oracle.measured > 0, 'scope: the pinned sample carries >= 1 MEASURED row (got ' + oracle.measured + ')');

/* ② b1b-1: the NUMBER the cell shows == the independently computed number. */
const proj = M.project(rows);
const folded = M.foldedCell(proj.turns.length === 1 ? proj.turns[0] : proj);
ok(proj.tok.k === 'p' && proj.tok.v === oracle.tok,
  'b1b-1 tok outlet: project shows ' + (proj.tok.k === 'p' ? proj.tok.v : proj.tok.k)
  + ' and the oracle says ' + oracle.tok);
/* The projection may declare UNMEASURED data with a "≥" marker (ADR §4.4): the marker must
 * be present exactly when some carrier row exists but is unmeasured, and the NUMBER must
 * equal the oracle either way. Comparing raw strings made the projection's extra honesty
 * look like a mismatch (measured: it showed "8 ≥" where the oracle said "8"). */
(function () {
  const txt = String(folded);
  const num = Number((/(\d+)/.exec(txt) || [])[1]);
  const unmeasured = proj.bars.filter(function (b) { return b.src === 'unmeasured'; }).length;
  const hasMarker = txt.indexOf('≥') > -1;
  ok(num === oracle.tok, 'b1b-1 folded number: "' + txt + '" carries the oracle number ' + oracle.tok);
  ok(hasMarker === (unmeasured > 0),
    'b1b-1 declared-unknown marker: "≥" present ⟺ unmeasured rows exist (marker=' + hasMarker
    + ', unmeasured=' + unmeasured + ')');
}());

/* ③ PARTICIPATION: which rows entered the sum — a zero-filled implementation also gives 12. */
const present = proj.bars.filter(function (b) { return b.src === 'tok'; }).length;
const excluded = proj.bars.length - present;
ok(present === oracle.measured,
  'b1b-1 participation: exactly ' + oracle.measured + ' MEASURED rows are present (got ' + present + ')');
ok(excluded === oracle.rows - oracle.measured,
  'b1b-1 exclusion: the other ' + (oracle.rows - oracle.measured) + ' rows are excluded, not counted as 0 (got ' + excluded + ')');

/* ④ b1b-2: EVERY turn, not just the total (the total can hide a compensating error). */
let turnBad = 0;
proj.turns.forEach(function (t) {
  const want = expectedTok(t.events).tok;
  const got = t.tok.k === 'p' ? t.tok.v : null;
  if (want !== got) { turnBad++; console.log('     turn ' + t.id + ': got ' + got + ' want ' + want); }
});
ok(proj.turns.length > 0 && turnBad === 0,
  'b1b-2 per-turn: every turn matches the oracle (' + proj.turns.length + ' turn(s))');

/* ── b1b-2 BREADTH: EVERY real sample on disk, not just the pinned one ──────────────
 * A single sample proves the wiring; the breadth is what makes "值 == 真值" a property of
 * the system rather than of one file. Files with no metering row are counted SEPARATELY:
 * "no metering here" and "metering broke" must not be the same number (rule ⑪). */
(function () {
  let files = [];
  try { files = fs.readdirSync(CORPUS_DIR).filter(function (f) { return /\.events\.jsonl$/.test(f); }); }
  catch (e) {
    console.log('  SKIP  breadth: no runtime corpus at ' + CORPUS_DIR
      + ' (declared skip — the in-repo fixture already exercised the criterion)');
    return;
  }
  let withTok = 0, withoutTok = 0, mismatched = 0, totalTurns = 0;
  files.forEach(function (f) {
    let rows;
    try { rows = readRowsIn(CORPUS_DIR, f); } catch (e) { mismatched++; return; }
    const want = expectedTok(rows);
    const p = M.project(rows);
    if (want.measured === 0) { withoutTok++; return; }
    withTok++;
    totalTurns += p.turns.length;
    const got = p.tok.k === 'p' ? p.tok.v : null;
    if (got !== want.tok) { mismatched++; if (mismatched <= 3) console.log('     ' + f + ': got ' + got + ' want ' + want.tok); }
  });
  console.log('  --- breadth: ' + files.length + ' sample(s) on disk; ' + withTok + ' carry metering, '
    + withoutTok + ' carry none (DECLARED, not "broken"), ' + totalTurns + ' turn(s) compared');
  ok(files.length > 0, 'breadth scope: at least one real sample on disk');
  ok(mismatched === 0, 'b1b-2 breadth: every metering-bearing sample matches the oracle (' + mismatched + ' mismatch)');
}());

console.log(bad === 0
  ? 'OK — THE VALUE CRITERION IS EXERCISED: the cell shows the number the event stream implies'
  : 'FAILED — ' + bad + ' value check(s) red');
process.exit(bad ? 1 : 0);
