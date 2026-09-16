/* Two naming accidents, made structurally impossible where that is possible.
 *
 * Both cost a real regression today and both were prevented only by a rule —
 * "ask yourself whether this name means something else here". That kind of rule
 * had already failed repeatedly in this project (grep alternation eight times, a
 * [large] marker, three write-then-read-back incidents). A rule that has to be
 * remembered is not a guard.
 *
 * WHAT IS CHECKED: a local declaration that shadows a module-level one. This is
 * the `var st = stamp(...)` accident — `st` was that asset's state object, and
 * every later read in the function broke. The scan is sound: shadowing is a
 * property of the source, so it can be decided without running anything.
 *
 * WHAT IS NOT CHECKED, and why — recorded so nobody re-adds it as a guard:
 * the other accident was `state.chatJobId = ...` inside an object literal, where
 * `state` was a KEY, not a variable, so the write landed on the DOM element with
 * id="state" (a browser makes every id a global). A scan for "bare identifier
 * that is also a DOM id" cannot separate that mistake from the intended use:
 * `mode.textContent = ...` is the same shape and is deliberate. Making the class
 * impossible needs the other fix — ban named access in the shell and take
 * everything from getElementById — which is a refactor of working code, not a
 * check. It is registered in HANDOFF's un-fixed section instead.
 *
 * Usage: node naming_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, '..', 'assets');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

const js = fs.readdirSync(A).filter(f => f.endsWith('.js'))
  .map(f => ({ f: f, text: fs.readFileSync(path.join(A, f), 'utf8') }));

/* A declaration at column 0-2 is module level; anything deeper is inside a
 * function (this asset family is written that way throughout). Comparing the two
 * sets per file is the whole check. */
function scan(text) {
  const lines = text.split('\n');
  const top = new Set(), shadows = [];
  lines.forEach(function (l) {
    const m = /^(?: {0,2})(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l);
    if (m) { top.add(m[1]); }
  });
  lines.forEach(function (l, i) {
    const m = /^\s{3,}(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l);
    if (m && top.has(m[1])) { shadows.push((i + 1) + ':' + m[1]); }
  });
  return { top: top, shadows: shadows };
}

const all = [];
js.forEach(function (j) {
  const r = scan(j.text);
  r.shadows.forEach(function (s) { all.push(j.f + ' ' + s); });
});
check('no local declaration shadows a module-level one in any asset',
  all.length === 0, JSON.stringify(all));

/* Positive control: the planted case is the shape that actually shipped. */
const planted = [
  '(function () {',
  '  var st = { chatJobId: null };',
  '  function renderSide() {',
  '      var st = { date: 1, time: 2 };',
  '      st.chatJobId = null;',
  '  }',
  '})();',
].join('\n');
const plantedShadows = scan(planted).shadows;
check('the scan reports the planted shadow (positive control)',
  plantedShadows.length === 1, JSON.stringify(plantedShadows));

/* And it must not fire on the fixed form of the same code. */
const fixed = planted.replace('      var st = { date: 1, time: 2 };', '      var when = { date: 1, time: 2 };')
  .replace('      st.chatJobId = null;', '      when.chatJobId = null;');
check('the scan is silent on the fixed form (negative control)',
  scan(fixed).shadows.length === 0, JSON.stringify(scan(fixed).shadows));

console.log('');
console.log(failures === 0 ? 'OK — all passed' : 'FAILED: ' + failures);
process.exit(failures === 0 ? 0 : 1);
