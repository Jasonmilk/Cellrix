/* no_host_paths_test — HOST PATHS ARE DECLARED INPUTS, AS A CLASS (ADR-0048 §130).
 * The same move that made rule ⑫ ("no coercing numeric guard") a class instead of one fix:
 * a single corrected site proves nothing about the next one. Three sites were still absolute
 * (precommit.sh, cell_before.js, pinned_expectation.js) while the rule lived only in prose.
 */
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
let bad = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) bad++; };

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)#[^\n]*/g, '$1')
            .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}
function scan(list) {
  const hits = [];
  list.forEach((f) => {
    let src = '';
    try { src = fs.readFileSync(path.join(DIR, f), 'utf8'); } catch (e) { return; }
    stripComments(src).split('\n').forEach((l, i) => {
      if (/\/Users\/|\/home\/[a-z]/.test(l)) { hits.push(f + ':' + (i + 1)); }
    });
  });
  return hits;
}

const files = fs.readdirSync(DIR).filter((f) => /\.(js|sh)$/.test(f)).sort();
ok(files.length >= 20, 'scope: scanned >= 20 files (got ' + files.length + ')');
const hits = scan(files);
ok(hits.length === 0, 'no host-absolute path literal in any test/tool file'
  + (hits.length ? ' — found: ' + hits.join(', ') : ''));

/* MUTATION PROBE: a fabricated absolute path must be caught, or this check is blind. */
/* BUILT FROM FRAGMENTS ON PURPOSE: a host path written literally here would be found by the
 * scan of this very file (that happened — third self-reference in this ADR; the check caught
 * itself, which is the same failure as a check that can never go red). */
const HOST = '/' + 'Users' + '/';
const probe = new RegExp('/' + 'Users/').test(stripComments("const ROOT = '" + HOST + "x/y';"));
ok(probe, 'MUTATION PROBE: a host-absolute literal would be detected');
console.log(bad === 0 ? 'OK — host paths are declared inputs, everywhere' : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
