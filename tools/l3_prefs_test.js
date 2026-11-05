/* R3：写偏好 ⇒ 读回；删文件 ⇒ 回默认；manifest 与账本文本不变。 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const { DEFAULTS, load, save } = require('./l3_prefs.js');
const tmp = path.join(__dirname, '..', 'data', '__prefs_probe__.json');
const mf = path.join(__dirname, '..', 'data', 'manifests');
const h = () => fs.readdirSync(mf).sort().map(f => f + ':' + fs.readFileSync(path.join(mf, f), 'utf8')).join('|');

const before = h();
save(tmp, { sidebarWidth: 420, expanded: { 'anaphase-helix': true }, recent: ['anaphase-helix'] });
const back = load(tmp);
assert.strictEqual(back.sidebarWidth, 420, 'R3: 偏好要能读回');
assert.strictEqual(h(), before, 'R3: 写偏好不得改 manifest');
fs.unlinkSync(tmp);
const dflt = load(tmp);
assert.strictEqual(dflt.sidebarWidth, DEFAULTS.sidebarWidth, 'R3: 删偏好 ⇒ 回默认');
assert.deepStrictEqual(dflt.recent, [], 'R3: 删偏好 ⇒ recent 清空');
assert.strictEqual(h(), before, 'R3: 删偏好不得改 manifest');
console.log('OK R3 · 写读回 420 → 删后回默认 ' + DEFAULTS.sidebarWidth + ' · manifest 未变');
