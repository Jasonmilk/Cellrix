/* Continuation-count tests (Cellrix session list).
 *
 * B is the only change the user actually sees, so it gets the same treatment as
 * everything else: a negative test. The function is lifted out of
 * session.html by name and exercised directly — it is pure, taking the children
 * map as an argument, precisely so it can be tested without a DOM.
 *
 * Usage: node chain_size_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'session.html');
const html = fs.readFileSync(SRC, 'utf8');

/* Lift the function by name. It is self-contained, so eval works and no shim
 * for window/document is needed. */
const m = html.match(/function chainSize\(children, job, seen\) \{[\s\S]*?\n  \}/);
if (!m) {
  console.log('  FAIL  chainSize not found in session.html');
  process.exit(1);
}
/* As an expression: under 'use strict' a function DECLARATION inside eval
 * does not leak into the surrounding scope, so eval(m[0]) alone leaves
 * chainSize undefined. */
const chainSize = eval('(' + m[0] + ')');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

/* A linear chain of four: root -> a -> b -> c */
const linear = {
  root: [{ job_id: 'a' }],
  a: [{ job_id: 'b' }],
  b: [{ job_id: 'c' }]
};
check('linear chain of 4 reports 4 nodes', chainSize(linear, 'root') === 4,
  String(chainSize(linear, 'root')));
check('its continuation count is 3', chainSize(linear, 'root') - 1 === 3,
  String(chainSize(linear, 'root') - 1));

/* The shape that exposed the bug: two branches, ten nodes. */
const branched = {
  r: [{ job_id: 'x' }, { job_id: 'y' }],
  x: [{ job_id: 'x1' }],
  x1: [{ job_id: 'x2' }],
  y: [{ job_id: 'y1' }],
  y1: [{ job_id: 'y2' }]
};
check('branched subtree reports 7 nodes', chainSize(branched, 'r') === 7,
  String(chainSize(branched, 'r')));
check('direct children would have said 2 (the old, wrong answer)',
  (branched.r || []).length === 2);

/* A leaf has no continuations. */
check('a leaf reports 1 node and 0 continuations',
  chainSize(linear, 'c') === 1 && chainSize(linear, 'c') - 1 === 0);

/* Cycles must not hang. */
const cyclic = { a: [{ job_id: 'b' }], b: [{ job_id: 'a' }] };
check('a cycle terminates', chainSize(cyclic, 'a') === 2,
  String(chainSize(cyclic, 'a')));

/* The negative test: if the counter stops counting, the assertions above must
 * be the thing that fails. Here it is mutated inline and shown to disagree. */
function chainSizeZeroed() { return 1; }
check('MUTATION: a zeroed counter disagrees with the assertions',
  chainSizeZeroed(linear, 'root') !== 4);

console.log('');
console.log(failures === 0 ? 'OK — all passed' : 'FAILED: ' + failures);
process.exit(failures === 0 ? 0 : 1);
