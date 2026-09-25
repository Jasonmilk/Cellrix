/* mutation_harness_test — puts the fixture sentinel INSIDE the default gate.
 *
 * The empty-fixture sentinel (a no-op mutation must be reported MUTATION VOID) existed
 * only in `mutation.sh --self-test`. That means a DEAD precondition guard would go
 * unnoticed by every ordinary run: the harness would keep producing "mutations that
 * ran", and nothing would say otherwise. A control that is not in the default gate is
 * not a control — it is a note to self.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const SELF = path.join(__dirname, 'mutation.sh');
try {
  const out = execFileSync('bash', [SELF, '--self-test'], { encoding: 'utf8' });
  process.stdout.write(out.trim() + '\n');
  process.exit(0);
} catch (e) {
  const msg = String((e.stdout || '') + (e.stderr || '')).trim();
  console.log('FAIL — the empty-fixture sentinel is dead, so every mutation this session'
    + ' reported as "verified" is now suspect: ' + msg);
  process.exit(1);
}
