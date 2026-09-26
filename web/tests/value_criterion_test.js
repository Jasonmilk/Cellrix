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
const ROOT = process.env.PORTS_ROOT || path.join(__dirname, '..', '..', '..');
const EV = path.join(ROOT, '.helix', 'events');
/* The sample is a DECLARED input (env override) so a mutation can feed a changed tape
 * and prove the criterion can go red. Default = the pinned real sample. */
const PINNED = process.env.VALUE_SAMPLE || 'run-1453c697e434ecfa-p006ab547d0000002.events.jsonl';

/* ── ORACLE (independent) ───────────────────────────────────────────────────── */
function readRows(file) {
  return fs.readFileSync(path.join(EV, file), 'utf8').trim().split('\n')
    .filter(Boolean).map(function (l) { return JSON.parse(l); });
}
function expectedTok(rows) {
  let sum = 0, carriers = 0;
  rows.forEach(function (e) {
    const d = e.data;
    if (d && Object.prototype.hasOwnProperty.call(d, 'completion_tokens') && d.completion_tokens !== null) {
      sum += d.completion_tokens; carriers++;
    } else if (d && Object.prototype.hasOwnProperty.call(d, 'completion_tokens')) { carriers++; }
  });
  return { tok: sum, carriers: carriers, rows: rows.length };
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
ok(oracle.carriers > 0, 'scope: the pinned sample carries >= 1 metering row (got ' + oracle.carriers + ')');

/* ② b1b-1: the NUMBER the cell shows == the independently computed number. */
const proj = M.project(rows);
const folded = M.foldedCell(proj.turns.length === 1 ? proj.turns[0] : proj);
ok(proj.tok.k === 'p' && proj.tok.v === oracle.tok,
  'b1b-1 tok outlet: project shows ' + (proj.tok.k === 'p' ? proj.tok.v : proj.tok.k)
  + ' and the oracle says ' + oracle.tok);
ok(String(folded) === String(oracle.tok),
  'b1b-1 folded text: "' + folded + '" == oracle "' + oracle.tok + '"');

/* ③ PARTICIPATION: which rows entered the sum — a zero-filled implementation also gives 12. */
const present = proj.bars.filter(function (b) { return b.src === 'tok'; }).length;
const excluded = proj.bars.length - present;
ok(present === oracle.carriers,
  'b1b-1 participation: exactly ' + oracle.carriers + ' rows are present (got ' + present + ')');
ok(excluded === oracle.rows - oracle.carriers,
  'b1b-1 exclusion: the other ' + (oracle.rows - oracle.carriers) + ' rows are excluded, not counted as 0 (got ' + excluded + ')');

/* ④ b1b-2: EVERY turn, not just the total (the total can hide a compensating error). */
let turnBad = 0;
proj.turns.forEach(function (t) {
  const want = expectedTok(t.events).tok;
  const got = t.tok.k === 'p' ? t.tok.v : null;
  if (want !== got) { turnBad++; console.log('     turn ' + t.id + ': got ' + got + ' want ' + want); }
});
ok(proj.turns.length > 0 && turnBad === 0,
  'b1b-2 per-turn: every turn matches the oracle (' + proj.turns.length + ' turn(s))');

console.log(bad === 0
  ? 'OK — THE VALUE CRITERION IS EXERCISED: the cell shows the number the event stream implies'
  : 'FAILED — ' + bad + ' value check(s) red');
process.exit(bad ? 1 : 0);
