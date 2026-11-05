/* L3 = 可删本地偏好（栏宽/展开/最近项目）：独立位置、独立回滚；删掉即回默认，
 * 且**不写回 manifest 或账本**。R3 判据：删 L3 ⇒ 回默认布局 + 真源对象未变。 */
const fs = require('fs'), path = require('path');
const DEFAULTS = { sidebarWidth: 280, expanded: {}, recent: [] };
function load(file) {
  try { return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (e) { return Object.assign({}, DEFAULTS); }   /* 缺失/坏 ⇒ 默认，不报错不阻断 */
}
function save(file, prefs) { fs.writeFileSync(file, JSON.stringify(prefs)); }
module.exports = { DEFAULTS, load, save };
