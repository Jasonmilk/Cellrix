#!/usr/bin/env node
/* THE BUILT ARTIFACT MUST CARRY THE SOURCE ASSETS, BYTE FOR BYTE (ADR-0048 §316, ledger P4).
 *
 * Assets are `include_str!`d at compile time, so a stale embed serves a stale page — this session hit
 * that twice. The first design compared the SERVED PAGE with each asset and went red for the wrong
 * reason (the page is assembled by placeholder substitution, so `boot.json`/`base.html` must NOT appear
 * verbatim). The second design compared MTIMES, and that is a false green:
 *
 *   · mtime is the attribute of the CHECKOUT, not of the CONTENT — `touch target/debug/cellrix-web`
 *     turns it green while the page is still stale, and a fresh clone carries content without mtime;
 *   · `include_str!` embeds the BYTES, so the property that actually holds is "the asset's bytes are
 *     IN the built artifact" — mechanism-agnostic, and unfakeable by a timestamp.
 *
 * So: parse the compile-time manifest in `web/src/boot.rs`, then require every asset's bytes to be
 * found in the binary. Nothing is compared against "now", so no clock can satisfy it.
 *
 * WHAT THIS DOES NOT CATCH (named, not hidden): a rebuilt binary whose RUNNING PROCESS is old — that
 * is a restart check, and it needs the served page, which is a different judgement (see boot.rs:29
 * `BOOT_JSON`, the assembly spec, which must not appear verbatim in the page).
 *
 * Usage: node asset_parity_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MIN_ASSETS = 10;        /* declared threshold (ADR-0022 §2.5): the manifest is a real list, not one row */

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* THE COMPARISON IS NAMED, so the mutation below tests IT rather than today's filesystem. */
const contentPresent = (artifactBytes, assetBytes) =>
  assetBytes.length > 0 && artifactBytes.includes(assetBytes);

const BOOT_RS = path.join(__dirname, '..', 'src', 'boot.rs');
const BINARY = path.join(__dirname, '..', '..', 'target', 'debug', 'cellrix-web');

/* One manifest line per asset: ("name", include_str!("../assets/file")). Paths are relative to web/src. */
function readManifest() {
  const src = fs.readFileSync(BOOT_RS, 'utf8');
  const out = [];
  const re = /\(\s*"([^"]+)"\s*,\s*include_str!\(\s*"([^"]+)"\s*\)\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ name: m[1], file: path.resolve(path.dirname(BOOT_RS), m[2]) });
  }
  /* `boot.json` is the assembly spec, embedded on its own line — not a tuple, so the loop above misses it. */
  const bj = /const\s+BOOT_JSON:\s*&str\s*=\s*include_str!\(\s*"([^"]+)"\s*\)/.exec(src);
  if (bj) { out.push({ name: 'boot.json', file: path.resolve(path.dirname(BOOT_RS), bj[1]) }); }
  return out;
}

const assets = readManifest().map((a) => Object.assign(a, { bytes: fs.existsSync(a.file) ? fs.readFileSync(a.file) : null }));
ok('the manifest is a real list, not one row (the criterion is not vacuous)',
  assets.length >= MIN_ASSETS, assets.length + ' entries declared, threshold ' + MIN_ASSETS);
ok('every declared asset exists on disk (a renamed file is named here, not skipped)',
  assets.every((a) => a.bytes !== null),
  assets.filter((a) => a.bytes === null).map((a) => a.name).join(',') || 'all present');

if (!fs.existsSync(BINARY)) {
  console.log('NEEDS-INPUT: no built panel binary at ' + BINARY + ' (build it first: cargo build -p cellrix-web)');
  process.exit(3);
}
const artifact = fs.readFileSync(BINARY);

/* THE CHECK: content in artifact. A stale embed differs from its source, so this goes red on exactly
 * the mistake it names — and no timestamp can make it pass. */
const missing = assets.filter((a) => a.bytes && !contentPresent(artifact, a.bytes))
  .map((a) => a.name + '(' + a.bytes.length + 'B)');
ok('every manifest asset is carried by the built artifact, byte for byte',
  missing.length === 0,
  missing.length ? ('STALE: ' + missing.join(' ')) : (assets.length + ' assets found in ' + path.basename(BINARY)));

/* MUTATION: the comparison must be able to go red, and it must not be satisfiable by a size match. */
const probe = assets.find((a) => a.bytes && a.bytes.length > 200) || assets[0];
const altered = Buffer.concat([probe.bytes, Buffer.from('\n/* a byte that is not in the artifact */\n')]);
ok('MUTATION: the comparison itself can go red (altered source ⇒ absent)',
  contentPresent(artifact, probe.bytes) === true && contentPresent(artifact, altered) === false,
  'probe ' + probe.name);
ok('MUTATION: an empty asset is refused rather than trivially "found"',
  contentPresent(artifact, Buffer.alloc(0)) === false, 'empty buffer is not presence');

console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
