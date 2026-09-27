/* open_turns_test — A DERIVED VALUE MUST BE READ AS DERIVED (ADR-0048 §202).
 *
 * Measured: `openTurns` was written only inside consume() (`S.turnIds.forEach(id => openTurns[id] = true)`),
 * never cleared in reset() — so residues pointed at ids that no longer existed — and every read used
 * `!!openTurns[id]`, i.e. it read a STORED value where the semantics are "default open, closed only
 * when explicitly said so". Rule ⑰: a stored derived value is a second truth.
 */
const fs = require('fs'), path = require('path');
const PT = fs.readFileSync(path.join(__dirname, '..', 'assets', 'prove_track.js'), 'utf8');
const VIEW = fs.readFileSync(path.join(__dirname, '..', 'assets', 'prove_track.view.js'), 'utf8');
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

ok(/S\.openTurns = \{\};/.test(PT), 'reset() CLEARS openTurns (no residue pointing at dead ids)');
ok(/S\.openTurns\[id\] !== false/.test(PT), 'reads treat it as DEFAULT OPEN (`!== false`), not as a stored boolean');
ok(/S\.openTurns\[id\] = !\(S\.openTurns\[id\] !== false\)/.test(PT),
  'and the toggle writes an EXPLICIT state (default-open ⇒ close, otherwise ⇒ open)');
ok(/S\.openTurns\[it\.id\] !== false/.test(VIEW) && /S\.openTurns\[it\.turn\] === false/.test(VIEW),
  'the view has no `!!` read left: both sites read default-open');
ok(VIEW.indexOf('!!S.openTurns[') < 0 && PT.indexOf('return S.openTurns[id];') < 0,
  'MUTATION: no stored-boolean read survives (reverting one ⇒ this check fails)');
console.log(bad === 0 ? 'OK — openTurns is derived, cleared, and read as default-open'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
