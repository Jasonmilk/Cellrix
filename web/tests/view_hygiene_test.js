/* view_hygiene_test — THE GATE POINTS AT THE TARGET (ADR-0048 §65 … §82).
 *
 * Five checks, each answering a DIFFERENT question; none substitutes for another:
 *   DERIVED-STORE  is any derived value STORED in the view?    (§82 — cache = 2nd truth)
 *   REFERENCE      is every global the view calls PROVIDED?    (presence; §67.4 crash)
 *   MEMBER         is every member it calls EXPORTED?          (§69.2 — read off assets)
 *   META           can the detectors still SEE a broken sample? (§66.2 — anti always-green)
 *   COUNTS         four absence-type classes, target 0         (§0.3b attribution table)
 *
 * `bad` is declared FIRST: a check that THROWS when it should FAIL is not a check
 * (learned twice, §68.5 / §82.4). Checks quote CODE, never line numbers — they drift.
 */
const fs = require('fs');
const path = require('path');

/* VIEW_TARGET lets the pre-commit script run the RED-PATH self-test against a
 * temporary copy: an unverified red path is how a check silently stops working. */
const TARGET = process.env.VIEW_TARGET || path.join(__dirname, '..', 'assets', 'prove_track.view.js');
const ASSETS = path.join(__dirname, '..', 'assets');
const BOOT = path.join(__dirname, '..', 'src', 'boot.rs');

/* RECORDED START (measured, not guessed); the criterion is 0. A baseline used as a
 * tolerance once made this gate green while the cell was 100% broken (§65.5). */
const BASELINE = { 'bare-slash': 7, 'fallback-numeric': 3, 'fallback-other': 30,
                   'typeof-existence': 1, 'bare-threshold': 3 };
const ASSERTED = ['bare-slash', 'fallback-numeric', 'typeof-existence', 'bare-threshold'];
const SCOPE_NOTE = 'whole file (cell-scoped proof of concept measured 9)';

let bad = 0;

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}
function classOf(line) {
  const hits = [];
  if (/[A-Za-z0-9_)\]]\s*\/\s*[A-Za-z0-9_(]/.test(line)) { hits.push('bare-slash'); }
  if (/\|\|\s*\d/.test(line)) { hits.push('fallback-numeric'); }
  else if (/\|\|/.test(line)) { hits.push('fallback-other'); }
  if (/typeof\s+[A-Za-z_$][\w$.]*\s*===?\s*['"]number['"]/.test(line)) { hits.push('typeof-existence'); }
  if (/(^|[^\w.])(0\.5|1\.2|0\.05)(?![\d])/.test(line)) { hits.push('bare-threshold'); }
  return hits;
}

let code;
try { code = stripComments(fs.readFileSync(TARGET, 'utf8')); }
catch (e) { console.log('  FAIL  TARGET unreadable: ' + e.message); process.exit(1); }
const lines = code.split('\n');

const counts = {};
Object.keys(BASELINE).forEach(function (k) { counts[k] = 0; });
lines.forEach(function (line) { classOf(line).forEach(function (k) { counts[k] = (counts[k] || 0) + 1; }); });

if (process.argv.indexOf('--emit-baseline') > -1) { console.log(JSON.stringify(counts)); process.exit(0); }
if (process.argv.indexOf('--emit-sites') > -1) {
  lines.forEach(function (line, n) {
    const hits = classOf(line);
    if (hits.length) { console.log('prove_track.view.js:' + (n + 1) + '\t' + hits.join(',')); }
  });
  process.exit(0);
}

const KNOWN_ALL_BROKEN = ['var a = b / c;', 'var d = e || 0;', "typeof f === 'number';", 'var g = 1.2;'];
(function () {
  const probe = { 'bare-slash': 0, 'fallback-numeric': 0, 'typeof-existence': 0, 'bare-threshold': 0 };
  KNOWN_ALL_BROKEN.forEach(function (line) {
    classOf(line).forEach(function (k) { if (probe[k] !== undefined) { probe[k]++; } });
  });
  const blind = Object.keys(probe).filter(function (k) { return probe[k] === 0; });
  console.log((blind.length ? '  FAIL ' : '  ok   ') + 'META — the detectors see a known all-broken sample'
    + (blind.length ? ' (blind to: ' + blind.join(', ') + ')' : ''));
  if (blind.length) { bad++; }
}());

(function () {
  const hits = [];
  lines.forEach(function (line, n) {
    if (/^\s*(S\._\w+|[A-Z][A-Z0-9_]*)\s*=\s*window\.CxCellMetering\.project\s*\(/.test(line)) {
      hits.push((n + 1) + ': ' + line.trim().slice(0, 60));
    }
  });
  console.log((hits.length ? '  FAIL ' : '  ok   ') + 'DERIVED-STORE — no projection result is stored in the view'
    + (hits.length ? ' (' + hits.join(' | ') + ')' : ''));
  if (hits.length) { bad++; }
}());

const loaded = [], membersByGlobal = {}, usedGlobals = [];
try {
  const boot = fs.readFileSync(BOOT, 'utf8');
  const files = (boot.match(/"([A-Za-z0-9_.]+[.](html|js))"/g) || []).map(function (x) { return x.replace(/"/g, ''); });
  for (const f of files) {
    const fp = path.join(ASSETS, f);
    if (!fs.existsSync(fp)) { continue; }
    const src = fs.readFileSync(fp, 'utf8');
    const globals = [];
    (src.match(/(?:window|root)\.(Cx[A-Za-z0-9_]+)\s*=/g) || []).forEach(function (m) {
      globals.push(m.replace(/^(window|root)\./, '').replace(/\s*=$/, ''));
    });
    (src.match(/(?:^|\n)\s*var\s+(Cx[A-Za-z0-9_]+)\s*=/g) || []).forEach(function (m) {
      globals.push(m.replace(/^\s*var\s+/, '').replace(/\s*=$/, ''));
    });
    for (const g of Array.from(new Set(globals))) {
      loaded.push(g);
      membersByGlobal[g] = membersByGlobal[g] || [];
      const direct = new RegExp('(?:window|root)\\.' + g + '\\s*=\\s*\\{([\\s\\S]*?)\\}').exec(src);
      if (direct) {
        (direct[1].match(/([A-Za-z_$][\w$]*)\s*:/g) || []).forEach(function (m) {
          membersByGlobal[g].push(m.replace(/\s*:$/, ''));
        });
      }
      (src.match(new RegExp(g + '\\.([A-Za-z_$][\\w$]*)\\s*=', 'g')) || []).forEach(function (m) {
        membersByGlobal[g].push(m.replace(new RegExp('^' + g + '\\.'), '').replace(/\s*=$/, ''));
      });
      (src.match(/return\s*\{([\s\S]*?)\}\s*;/g) || []).forEach(function (blk) {
        (blk.match(/([A-Za-z_$][\w$]*)\s*:/g) || []).forEach(function (m) {
          membersByGlobal[g].push(m.replace(/\s*:$/, ''));
        });
      });
    }
  }
  (code.match(/\b(Cx[A-Za-z0-9_]+)\s*\./g) || []).forEach(function (m) {
    usedGlobals.push(m.replace(/\s*\.$/, ''));
  });
} catch (e) { console.log('  FAIL  boot manifest unreadable: ' + e.message); bad++; }

const unresolved = Array.from(new Set(usedGlobals)).filter(function (n) { return loaded.indexOf(n) === -1; });
console.log((unresolved.length ? '  FAIL ' : '  ok   ')
  + 'REFERENCE — every Cx* global the view calls is provided by a boot-manifest asset'
  + (unresolved.length ? ' (unresolved: ' + unresolved.join(', ') + ')' : ''));
if (unresolved.length) { bad++; }

const badMembers = [];
(code.match(/\b(Cx[A-Za-z0-9_]+)\.([A-Za-z_$][\w$]*)/g) || []).forEach(function (m) {
  const parts = m.split('.');
  if (loaded.indexOf(parts[0]) === -1) { return; }
  const known = membersByGlobal[parts[0]] || [];
  if (known.length && known.indexOf(parts[1]) === -1) { badMembers.push(parts[0] + '.' + parts[1]); }
});
console.log((badMembers.length ? '  FAIL ' : '  ok   ') + 'MEMBER — every member the view calls is exported by the loaded asset'
  + (badMembers.length ? ' (unknown: ' + Array.from(new Set(badMembers)).join(', ') + ')' : ''));
if (badMembers.length) { bad++; }

let assertedTotal = 0;
Object.keys(counts).forEach(function (k) {
  const asserted = ASSERTED.indexOf(k) > -1;
  if (asserted) { assertedTotal += counts[k]; }
  const okNow = asserted ? (counts[k] === 0) : true;
  console.log((asserted ? (okNow ? '  ok   ' : '  FAIL ') : '  note ') + k + ': ' + counts[k]
    + ' (recorded start ' + BASELINE[k] + (asserted ? ', target 0)' : ', registered — not asserted)'));
  if (!okNow) { bad++; }
});
console.log('  TARGET  ' + path.relative(process.cwd(), TARGET) + '   [' + SCOPE_NOTE + ']');
console.log('  ASSERTED TOTAL ' + assertedTotal + ' (target 0)');
console.log(bad === 0
  ? 'OK — M3 REACHED: no stored derived values, every name resolves, asserted classes at 0'
  : 'FAILED (expected until M3) — ' + bad + ' check(s) red');
process.exit(bad === 0 ? 0 : 1);
