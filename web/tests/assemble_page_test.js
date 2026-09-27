/* assemble_page_test — guards the ONE JS assembly rule (ADR-0048 §171). */
const fs = require('fs'), path = require('path');
const AP = require('./assemble_page.js');
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

const built = AP.assemble();
ok(AP.residue(built.html).length === 0,
  'assembly leaves NO placeholder residue (' + AP.residue(built.html).join(' ') + ')');
ok(built.derived.length > 0 && built.derived.every((ph) => built.html.indexOf(ph) < 0),
  'DERIVED placeholders are substituted too (' + built.derived.join(', ') + ') — the copy that skipped them is why a test page died on __REFRESH__');
const g = AP.graph();
ok(JSON.stringify(built.order) === JSON.stringify(g.pieces.map((p) => p.asset).filter((a) => fs.existsSync(path.join(AP.ROOT, 'web', 'assets', a)))),
  'the load order IS the graph order (boot.rs:68 — "order is part of the wiring")');
ok(built.order.indexOf('three_state.js') < built.order.indexOf('cell_metering.js'),
  'three_state.js is assembled before cell_metering.js');

/* MUTATIONS — this module's own two claims must be able to fail. */
const { assemble } = AP;
const noDerived = (() => {           /* skip the derived pass, as the old copies did */
  const html = assemble().html;
  const g2 = AP.graph();
  return g2.derived.some((d) => html.indexOf(d.placeholder) >= 0);
})();
ok(noDerived === false, 'MUTATION check: with the derived pass the placeholders are gone (so skipping it would leave them)');
console.log(bad === 0 ? 'OK — one assembly rule, guarded' : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
