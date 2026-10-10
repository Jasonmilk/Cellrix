/* port_table_test — THE PORT TABLE IS THE SINGLE SOURCE, AND THIS CHECKS IT AGAINST THE
 * REPOS (ADR-0048 §117 / A0). A bare grep would be green when it finds nothing, so the
 * scope is asserted non-empty first; and a mutation (putting the old colliding default
 * back) must turn this red — that is what makes the check worth having.
 */
const fs = require('fs');
const path = require('path');
/* THE PATH IS A DECLARED INPUT, NOT A HARD-CODED FACT (§118.1): PORTS_ROOT may be set by
 * the environment; the first draft hard-coded one person's absolute path, so on any other
 * machine the read threw and the process exited 1 — a CRASH READ AS A RED, the very thing
 * this repo's own rule forbids. Resolution order: $PORTS_ROOT, then the sibling layout. */
const ROOT = process.env.PORTS_ROOT || path.join(__dirname, '..', '..', '..');
const TABLE = path.join(ROOT, 'Helix-Mind', 'docs', 'helixECO', 'ports.json');
const MIND_CFG = path.join(ROOT, 'Helix-Mind', 'crates', 'helix-mind-core', 'src', 'config.rs');

const SKIP = 4;   /* distinct from FAIL(1): an aborted run must not read as a red */

function load() { return JSON.parse(fs.readFileSync(TABLE, 'utf8')); }

/* A DECLARED SKIP, NOT A SILENT PASS AND NOT A CRASH (§118.1/§1.3): when the sibling repo
 * (which hosts the single source) is absent, this says so and exits SKIP. The criterion is
 * that this branch exists and is reachable — mutation: make hasTable() always true ⇒ the
 * "missing table" path still has to be *declared*, not assumed. */
function hasTable() { return fs.existsSync(TABLE); }
if (!hasTable()) {
  console.log('  SKIPPED (declared): the port table is not present at ' + TABLE);
  console.log('  This assertion lives in Cellrix but reads the ecosystem SSOT in Helix-Mind;');
  console.log('  set PORTS_ROOT to that checkout, or fetch the sibling repo. Exit ' + SKIP + '.');
  process.exit(SKIP);
}

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

  /* ⑤ THE PANEL'S OWN ENDPOINT LITERALS MUST BE TABLE PORTS (D2-殘, 2026-10-09).
   *
   * WHY THIS SECTION: ③ looks only at `mind`'s default in `config.rs`; the panel is a SEPARATE
   * code site and carried its own endpoint literals (`routes.rs` et al). A literal that is not in
   * the table is a SECOND SOURCE OF TRUTH — the thing the table's own doc forbids. The assertion
   * is "declared", not "equals one particular port": a project may legitimately define a default
   * (it must still run alone), but the number must be one the table knows.
   *
   * ★ AND WHY IT IS NARROW — the first draft was a BARE grep for 5/6-digit numbers and produced
   * FALSE POSITIVES, measured: `Vec::with_capacity(size.min(65536))` (a BUFFER SIZE, 2^16) and
   * `http://127.0.0.1:50123` inside `#[test] fn config_file_round_trip` (a fixture value).
   * This file's sibling already records the same lesson ("every pattern below is word-bounded"
   * after 18 false positives), so:
   *   · only the HOST:PORT form counts — that is the shape that can drift from the SSOT;
   *   · a `#[cfg(test)]` region is skipped (its numbers are fixtures, not endpoints);
   *   · scope is still asserted non-empty FIRST (a scan finding nothing is green and says nothing);
   *   · the scanned dir is a DECLARED INPUT (`PANEL_SRC`) so the mutation can point it elsewhere
   *     (a hard-coded path would repeat §118.1's own bug: a crash read as a red).
   */
  const PANEL_SRC = process.env.PANEL_SRC || path.join(__dirname, '..', 'src');
  const ENDPOINT = /(?:[A-Za-z0-9_.-]+|\d{1,3}(?:\.\d{1,3}){3}):(\d{4,5})\b/g;
  const known = {};
  names.forEach(function (n) { known[comps[n].port] = n; });
  const found = [];
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f); return; }
      if (!/\.rs$/.test(e.name)) { return; }
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      let inTests = false, m;
      lines.forEach(function (line, i) {
        if (/^\s*#\[cfg\(test\)\]/.test(line)) { inTests = true; }
        if (inTests) { return; }                  /* fixtures, not endpoints */
        if (/^\s*\/\//.test(line)) { return; }    /* comments are not code */
        ENDPOINT.lastIndex = 0;
        while ((m = ENDPOINT.exec(line)) !== null) {
          found.push({ file: path.relative(PANEL_SRC, f) + ':' + (i + 1), port: Number(m[1]) });
        }
      });
    });
  })(PANEL_SRC);
  say(found.length >= 5, 'panel: the scan found >= 5 host:port literals (got ' + found.length + ')');
  const unknown = found.filter(function (x) { return !known[x.port]; });
  say(unknown.length === 0, 'panel: every endpoint literal is a port the table declares' +
    (unknown.length ? ' (undeclared: ' + unknown.slice(0, 5).map(function (x) { return x.port + ' at ' + x.file; }).join(', ') + ')' : ''));

  return bad;
}

if (process.argv[2]) {   /* mutation mode: check an alternative config.rs */
  const bad = check(process.argv[2]);
  process.exit(bad ? 1 : 0);
}
const bad = check(MIND_CFG);
console.log(bad === 0 ? 'OK — the port table is single-source and collision-free' : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
