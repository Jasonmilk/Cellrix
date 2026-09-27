/* boot_placeholders_test — THREE DECLARATIONS, ONE BEHAVIOUR (ADR-0048 §164, rule ㉓).
 *
 * Measured: the panel served `<script>__THREE_STATE__</script>` UNSUBSTITUTED for weeks. Three
 * places described that hole — base.html (the hole), boot.rs (a substitution table entry),
 * boot.json (the graph that assemble() actually walks) — and only the third drives behaviour,
 * where the entry was MISSING. Two of the three tables said "yes", so reading either one told
 * you nothing was wrong.
 *
 * The check that should have caught it (verify_live.py's "placeholder residue must be zero")
 * had a HAND-WRITTEN list of 18 against a template of 32: 16 holes, exactly including the two
 * that broke. Rule ㉓: a roster must be BIDIRECTIONALLY aligned with the thing it describes —
 * one direction only finds "what is extra", and every disease in this cell is "what is missing".
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const phs = (text) => { const s = new Set(); const re = /__[A-Z][A-Z0-9_]*__/g; let m; while ((m = re.exec(text))) s.add(m[0]); return s; };

const tpl = phs(rd('web/assets/base.html'));
const graph = JSON.parse(rd('web/assets/boot.json'));
const claimed = new Set();
graph.pieces.forEach((p) => claimed.add(p.placeholder));
(graph.derived || []).forEach((d) => claimed.add(d.placeholder));
const rust = rd('web/src/boot.rs');
/* The Rust table's own entries: ("__X__", "asset"). */
const rustTable = new Set();
{ const re = /\("(__[A-Z][A-Z0-9_]*__)",\s*"[^"]+"\)/g; let m; while ((m = re.exec(rust))) rustTable.add(m[1]); }

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const show = (s) => [...s].sort().slice(0, 6).join(' ');

const unclaimed = new Set([...tpl].filter((p) => !claimed.has(p)));
const orphanPieces = new Set([...claimed].filter((p) => !tpl.has(p)));
const tableOnly = new Set([...rustTable].filter((p) => !claimed.has(p)));

ok(tpl.size > 25, 'scope: the template declares placeholders (' + tpl.size + ')');
ok(unclaimed.size === 0,
  'template → graph: every hole in base.html is claimed by a piece/derived entry'
  + (unclaimed.size ? '  MISSING: ' + show(unclaimed) : ''));
ok(orphanPieces.size === 0,
  'graph → template: every claimed entry has a hole to fill'
  + (orphanPieces.size ? '  EXTRA: ' + show(orphanPieces) : ''));
ok(tableOnly.size === 0,
  'boot.rs table ⊆ graph: the Rust table must not name entries the graph lacks'
  + (tableOnly.size ? '  TABLE-ONLY: ' + show(tableOnly) : ''));

/* MUTATIONS — both directions must be able to fail, or the check is one-sided by accident. */
const dropOne = new Set(tpl); dropOne.delete('__CELL_METERING__');
ok(new Set([...dropOne].filter((p) => !claimed.has(p))).size === 0,
  'MUTATION: removing the failing entry from the template clears the first direction');
const addGhost = new Set(tpl); addGhost.add('__GHOST__');
ok(new Set([...addGhost].filter((p) => !claimed.has(p))).size === 1,
  'MUTATION: a ghost placeholder in the template IS seen (this is the bug that shipped)');
console.log(bad === 0 ? 'OK — the three declarations are bidirectionally aligned'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
