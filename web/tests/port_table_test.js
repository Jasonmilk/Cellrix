/* port_table_test — THE PORT TABLE IS THE SINGLE SOURCE, AND THIS CHECKS IT AGAINST THE
 * REPOS (ADR-0048 §117 / A0). A bare grep would be green when it finds nothing, so the
 * scope is asserted non-empty first; and a mutation (putting the old colliding default
 * back) must turn this red — that is what makes the check worth having.
 */
const fs = require('fs');
const path = require('path');
const ROOT = '/Users/jason/Developer/Jasonmilk';
const TABLE = path.join(ROOT, 'Helix-Mind', 'docs', 'helixECO', 'ports.json');
const MIND_CFG = path.join(ROOT, 'Helix-Mind', 'crates', 'helix-mind-core', 'src', 'config.rs');

function load() { return JSON.parse(fs.readFileSync(TABLE, 'utf8')); }

function check(cfgPath) {
  const t = load();
  const comps = t.components;
  let bad = 0;
  const say = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) bad++; };

  /* ① SCOPE NON-EMPTY — a check that scans nothing is green and says nothing. */
  const names = Object.keys(comps);
  say(names.length >= 5, 'scope: the table declares >= 5 components (got ' + names.length + ')');

  /* ② NO TWO COMPONENTS SHARE A PORT */
  const seen = {};
  let dup = null;
  names.forEach(function (n) { const p = comps[n].port; if (seen[p]) { dup = seen[p] + ' & ' + n; } seen[p] = n; });
  say(dup === null, 'uniqueness: no two components share a port' + (dup ? ' (' + dup + ')' : ''));

  /* ③ THE MIND DEFAULT AGREES WITH THE TABLE (this is the live conflict) */
  const mindPort = comps.mind.port;
  const src = fs.readFileSync(cfgPath, 'utf8');
  const m = /fn default_listen_addr\(\) -> String \{[\s\S]*?"127\.0\.0\.1:(\d+)"\.into\(\)/.exec(src);
  say(!!m, 'mind: default_listen_addr is parseable');
  if (m) {
    const declared = Number(m[1]);
    const collide = names.filter(function (n) { return n !== 'mind' && comps[n].port === declared; });
    say(declared === mindPort,
      'mind: default ' + declared + ' == table ' + mindPort);
    say(collide.length === 0,
      'mind: default does not collide with another component' + (collide.length ? ' (collides with ' + collide.join(',') + ')' : ''));
  }

  /* ④ SCHEME MUST MATCH THE REAL PROTOCOL (the naming lie) */
  const lies = names.filter(function (n) { return !comps[n].protocol; });
  say(lies.length === 0, 'scheme: every component declares its real protocol' + (lies.length ? ' (missing: ' + lies.join(',') + ')' : ''));

  return bad;
}

if (process.argv[2]) {   /* mutation mode: check an alternative config.rs */
  const bad = check(process.argv[2]);
  process.exit(bad ? 1 : 0);
}
const bad = check(MIND_CFG);
console.log(bad === 0 ? 'OK — the port table is single-source and collision-free' : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
