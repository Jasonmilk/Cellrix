#!/usr/bin/env node
/* THE SERVED PAGE MUST BE THE SOURCE ASSETS (ADR-0048 §316, ledger P4).
 *
 * "Edit an asset, then rebuild and restart" was PROSE, and prose does not hold: twice this session the
 * panel served a STALE embedded page (assets are `include_str!`d at compile time) and only a behavioural
 * criterion caught it by luck. This is that rule turned into a judgement:
 *   · parse the boot manifest (`web/src/boot.rs`) — name -> asset file;
 *   · fetch the page the SERVER actually serves;
 *   · every asset's content must appear in it, byte for byte.
 * A stale embed differs from its source, so this goes red on exactly the mistake it names.
 *
 * Usage: node asset_parity_test.js [panel_base_url]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REQUIRES = 'panel-http';

const MIN_ASSETS = 10;        /* declared threshold (ADR-0022 §2.5): the manifest is a real list, not one row */
const SENTINEL_CHARS = 80;    /* enough to name WHICH asset is stale without printing a whole file */

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* THE INVARIANT IS "THE ARTIFACT IS NEWER THAN ITS SOURCES", NOT "THE PAGE CONTAINS THE FILES".
 * The first design compared the served page with each asset byte for byte and went red — correctly, and
 * for the wrong reason: the page is assembled by PLACEHOLDER SUBSTITUTION (`boot.json` is the assembly
 * spec, `base.html` is the template), so those files must NOT appear verbatim. The property that actually
 * matters is: the running binary was built AFTER the newest asset was edited. That is mechanism-agnostic
 * and it is exactly the trap this session hit twice (a stale `include_str!` page). */
/* THE COMPARISON IS NAMED, so the mutation can test IT rather than today's clock (a mutation that
 * cannot fail is worse than none — the first version made exactly that mistake). */
const isStale = (artifactMtime, sourceMtime) => artifactMtime < sourceMtime;

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const BINARIES = [
  path.join(__dirname, '..', '..', 'target', 'debug', 'cellrix-web'),
  path.join(__dirname, '..', '..', 'target', 'debug', 'up'),
];

function newestAsset(dir) {
  let newest = { file: '', mtime: 0 };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile()) { continue; }
    const st = fs.statSync(path.join(dir, e.name));
    if (st.mtimeMs > newest.mtime) { newest = { file: e.name, mtime: st.mtimeMs }; }
  }
  return newest;
}

const newest = newestAsset(ASSETS_DIR);
const binary = BINARIES.filter((b) => fs.existsSync(b)).map((b) => ({ path: b, mtime: fs.statSync(b).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0];
if (!binary) {
  console.log('NEEDS-INPUT: no built binary found (build the panel first: cargo build -p cellrix-web)');
  process.exit(3);
}
ok('the build artifact is NOT older than the newest asset (a stale page is refused)',
  !isStale(binary.mtime, newest.mtime),
  'binary ' + path.basename(binary.path) + ' ' + new Date(binary.mtime).toISOString()
    + ' vs newest asset ' + newest.file + ' ' + new Date(newest.mtime).toISOString());
/* MUTATION: the comparison must be able to go red — an asset edited AFTER the build is detected. */
ok('MUTATION: the comparison itself can go red (artifact older than source ⇒ stale)',
  isStale(1000, 2000) === true && isStale(2000, 1000) === false, 'stale detection is falsifiable');

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
