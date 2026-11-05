/* L1 = manifest 索引（薄侧栏）：项目自报即出现；核心代码 0 改动。
 * 只读 *.manifest.json，按 id 排序；坏文件只记录、不拖垮其余（R6 形状）。 */
const fs = require('fs'), path = require('path');
function index(dir) {
  const rows = [], errors = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.manifest.json')) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!m.id) { errors.push(f + ': 缺 id'); continue; }
      rows.push({ id: m.id, source: m.source || null, schema: m.schema || 1, entry: m.entry || null });
    } catch (e) { errors.push(f + ': ' + e.message); }
  }
  return { rows, errors };
}
module.exports = { index };
