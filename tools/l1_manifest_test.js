/* R1：新增一份合法 manifest ⇒ 索引多一行，且 web/src（核心）零改动。
 * R6：坏 manifest ⇒ 记错，其余仍索引。 */
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { index } = require('./l1_manifest.js');
const DIR = process.argv[2] || path.join(__dirname, '..', 'data', 'manifests');
const CORE = path.join(__dirname, '..', 'web', 'src');

function coreHash() {
  const h = crypto.createHash('sha256');
  const walk = d => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f);
    const s = fs.statSync(p); if (s.isDirectory()) walk(p); else h.update(p + ':' + fs.readFileSync(p)); } };
  walk(CORE); return h.digest('hex');
}

const before = index(DIR), h0 = coreHash();
const tmp = path.join(DIR, '__probe__.manifest.json');
fs.writeFileSync(tmp, JSON.stringify({ id: 'probe-project', source: 'local', schema: 1, entry: '/v1/agent/snapshot' }));
const mid = index(DIR), h1 = coreHash();
fs.unlinkSync(tmp);
const bad = path.join(DIR, '__bad__.manifest.json');
fs.writeFileSync(bad, '{ not json');
const afterBad = index(DIR);
fs.unlinkSync(bad);

assert.strictEqual(mid.rows.length, before.rows.length + 1, 'R1: 新增 manifest 必须多一行');
assert.ok(mid.rows.some(r => r.id === 'probe-project'), 'R1: 新项目必须出现');
assert.strictEqual(h1, h0, 'R1: 新增 manifest 不得触碰 web/src（核心 diff 必须为 0）');
assert.strictEqual(afterBad.rows.length, before.rows.length, 'R6: 坏 manifest 不得被索引');
assert.strictEqual(afterBad.errors.length, 1, 'R6: 坏 manifest 必须记错（不拖垮其余）');
console.log('OK R1/R6 · 基线 ' + before.rows.length + ' 行 → 新增后 ' + mid.rows.length +
            ' 行 · web/src 哈希 ' + h0.slice(0, 8) + ' 未变 · 坏文件被记错');
