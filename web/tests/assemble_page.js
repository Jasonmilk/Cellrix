/* assemble_page — THE ASSEMBLY RULE, IN ONE PLACE (ADR-0048 §171).
 *
 * The rule "base.html + boot.json ⇒ the page" lived in FIVE places: boot.rs (the real one) and at
 * least four suites that each read base.html and did their own substituting. Measured: the copies
 * replaced `pieces` but not `derived`, which is exactly why a test page failed with
 * `__REFRESH__ is not defined` — a copy that is 90% right is the most expensive kind.
 *
 * This module is the single JS implementation; `boot_placeholders_test` guards the alignment of
 * the three declarations, and `assemble_page_test` guards THIS module (ressiduals, order, derived).
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const assetPath = (a) => path.join(ROOT, 'web', 'assets', a);

function graph() { return JSON.parse(fs.readFileSync(assetPath('boot.json'), 'utf8')); }

/** Assemble the page exactly as the server does: pieces in graph order, then derived values. */
function assemble(overrides) {
  const g = graph();
  let out = fs.readFileSync(assetPath('base.html'), 'utf8');
  const order = [];
  for (const p of g.pieces) {
    if (!fs.existsSync(assetPath(p.asset))) { continue; }
    let bytes = fs.readFileSync(assetPath(p.asset), 'utf8');
    if (overrides && overrides[p.asset]) { bytes = overrides[p.asset](bytes); }
    order.push(p.asset);
    out = out.split(p.placeholder).join(bytes);
  }
  for (const d of (g.derived || [])) {
    /* DERIVED VALUES ARE NOT FILES: boot.rs computes them from a declaration (`refresh_secs`).
     * A stub keeps the page loadable; the criterion that matters is that NOTHING is left over. */
    out = out.split(d.placeholder).join(String(d.stub !== undefined ? d.stub : 60));
  }
  return { html: out, order, pieces: g.pieces.map((p) => p.asset), derived: (g.derived || []).map((d) => d.placeholder) };
}

/** Placeholders the page still contains after assembly. Empty is the only acceptable answer. */
function residue(html) {
  const found = new Set(); const re = /__[A-Z][A-Z0-9_]*__/g; let m;
  while ((m = re.exec(html))) { found.add(m[0]); }
  return [...found].sort();
}

module.exports = { assemble, residue, graph, ROOT };
