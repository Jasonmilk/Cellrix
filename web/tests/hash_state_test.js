/* The URL hash is the addressable form of the one selection state. These tests
 * exist because the panel must never lose the ability to render: a hash it did not
 * write, or a hand-edited one, has to degrade to an empty state rather than throw. */
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

ok('round-trips view + period', () => {
  const s = { view: 'prove-track', period: 'run-abc123' };
  assert.deepStrictEqual(N.parseHash(N.buildHash(s)), s);
});

ok('omits a missing period instead of emitting an empty one', () => {
  assert.strictEqual(N.buildHash({ view: 'chat' }), '#view=chat');
  assert.deepStrictEqual(N.parseHash('#view=chat'), { view: 'chat', period: null });
});

ok('a fully empty state is absent, not a bare hash', () => {
  assert.strictEqual(N.buildHash({}), '');
  assert.strictEqual(N.buildHash(null), '');
});

ok('tolerates a hash it did not write', () => {
  assert.deepStrictEqual(N.parseHash('#'), { view: null, period: null });
  assert.deepStrictEqual(N.parseHash(''), { view: null, period: null });
  assert.deepStrictEqual(N.parseHash(undefined), { view: null, period: null });
  assert.deepStrictEqual(N.parseHash('#someones-anchor'), { view: null, period: null });
  assert.deepStrictEqual(N.parseHash('#view&period=x'), { view: null, period: 'x' });
  assert.deepStrictEqual(N.parseHash('#unknown=1&view=flows'), { view: 'flows', period: null });
});

ok('order does not matter', () => {
  assert.deepStrictEqual(
    N.parseHash('#period=run-1&view=chat'),
    N.parseHash('#view=chat&period=run-1')
  );
});

ok('percent-encoding survives, and malformed encoding does not throw', () => {
  const s = { view: 'chat', period: 'run-a b&c' };
  assert.deepStrictEqual(N.parseHash(N.buildHash(s)), s);
  assert.deepStrictEqual(N.parseHash('#view=%E0%A4%A'), { view: null, period: null });
});

console.log('RESULT: ' + n + ' passed');
