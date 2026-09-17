/* The URL hash is the addressable form of the one selection state. These tests
 * exist because the panel must never lose the ability to render: a hash it did not
 * write, or a hand-edited one, has to degrade to an empty state rather than throw.
 *
 * The state has three keys since N-001 landed: `view` (the one main surface),
 * `period` (which experience), and `panel` (which auxiliary surface is open beside
 * it). `panel` was added as pure addition — an unknown key is still ignored and a
 * malformed hash still yields an empty state. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* `period_normalize.js` is a browser script (it reads `window.CxEventFamily` when it
 * loads), so it cannot be `require`d — it is evaluated against a `window` shim, the
 * same way the other view-layer tests do it. `event_family.js` must come first. */
const A = path.join(__dirname, '..', 'assets');
global.window = {};
eval(fs.readFileSync(path.join(A, 'event_family.js'), 'utf8'));
eval(fs.readFileSync(path.join(A, 'period_normalize.js'), 'utf8'));
const N = global.window.CxNormalize;

let n = 0;
function ok(name, fn) { fn(); n++; console.log('  PASS  ' + name); }
const EMPTY = { view: null, period: null, panel: null };

ok('round-trips view + period + panel', () => {
  const s = { view: 'chat', period: 'run-abc123', panel: 'prove-track' };
  assert.deepStrictEqual(N.parseHash(N.buildHash(s)), s);
});

ok('omits a missing period instead of emitting an empty one', () => {
  assert.strictEqual(N.buildHash({ view: 'chat' }), '#view=chat');
  assert.deepStrictEqual(N.parseHash('#view=chat'), { view: 'chat', period: null, panel: null });
});

ok('a fully empty state is absent, not a bare hash', () => {
  assert.strictEqual(N.buildHash({}), '');
  assert.strictEqual(N.buildHash(null), '');
});

ok('tolerates a hash it did not write', () => {
  assert.deepStrictEqual(N.parseHash('#'), EMPTY);
  assert.deepStrictEqual(N.parseHash(''), EMPTY);
  assert.deepStrictEqual(N.parseHash(undefined), EMPTY);
  assert.deepStrictEqual(N.parseHash('#someones-anchor'), EMPTY);
  assert.deepStrictEqual(N.parseHash('#view&period=x'), { view: null, period: 'x', panel: null });
  assert.deepStrictEqual(N.parseHash('#unknown=1&view=chat'), { view: 'chat', period: null, panel: null });
});

ok('order does not matter', () => {
  assert.deepStrictEqual(
    N.parseHash('#period=run-1&view=chat'),
    N.parseHash('#view=chat&period=run-1')
  );
});

ok('percent-encoding survives, and malformed encoding does not throw', () => {
  const s = { view: 'chat', period: 'run-a b&c', panel: 'prove-track' };
  assert.deepStrictEqual(N.parseHash(N.buildHash(s)), s);
  assert.deepStrictEqual(N.parseHash('#view=%E0%A4%A'), EMPTY);
});

/* ── the panel key: a pure addition ────────────────────────────────────────
 * It has to round-trip like the others, and its absence must be absent rather
 * than an empty `panel=` pair — otherwise every URL would carry a key the panel
 * never wrote. */
ok('panel round-trips on its own, and is omitted when unset', () => {
  assert.strictEqual(N.buildHash({ panel: 'flows' }), '#panel=flows');
  assert.deepStrictEqual(N.parseHash('#panel=flows'), { view: null, period: null, panel: 'flows' });
  assert.strictEqual(N.buildHash({ panel: null }), '');
});

ok('an unknown key is still ignored rather than guessed at', () => {
  assert.deepStrictEqual(N.parseHash('#drawer=flows'), EMPTY);
  assert.deepStrictEqual(N.parseHash('#panel='), EMPTY);
});

console.log('RESULT: ' + n + ' passed');
