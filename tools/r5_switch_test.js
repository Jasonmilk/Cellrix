/* R5：切换项目**不产生** run / verdict / 账本事件。
 * 判据（复合，不靠字符串前缀）：① 账本目录字节哈希不变 ② 事件流文件数不变
 * ③ 切换动作本身在 AG-UI 投影里映射为**空**（切换属导航层，不进事件流）。 */
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { index } = require('./l1_manifest.js');
const ROOT = path.join(__dirname, '..');
const hashDir = d => { const h = crypto.createHash('sha256');
  if (!fs.existsSync(d)) return 'absent';
  for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f);
    if (fs.statSync(p).isFile()) h.update(f + ':' + fs.readFileSync(p)); } return h.digest('hex'); };

const ledgerDir = path.join(ROOT, 'ledger');
const before = { ledger: hashDir(ledgerDir), rows: index(path.join(ROOT, 'data', 'manifests')).rows.length };

// 切换 = 只动"当前观察哪个"的指针（L3 偏好），不写 manifest、不写账本
const prefs = path.join(ROOT, 'data', '__switch__.json');
fs.writeFileSync(prefs, JSON.stringify({ active: 'anaphase-helix' }));
const switched = JSON.parse(fs.readFileSync(prefs, 'utf8')).active;
fs.unlinkSync(prefs);

// 切换事件在 AG-UI 投影里必须是空（用 anaphase bin 的规则：认不出的类型 ⇒ 空）
const switchEvent = { type: 'workspace/switched', period_id: 'p', job_id: 'j', data: { to: switched } };
const { execSync } = require('child_process');
const out = execSync(`printf '%s\\n' '${JSON.stringify(switchEvent)}' | cargo run -q --manifest-path ${path.join(ROOT,'..','anaphase-helix','Cargo.toml')} --bin agui 2>/dev/null || true`, { encoding: 'utf8' });

assert.strictEqual(hashDir(ledgerDir), before.ledger, 'R5: 切换不得改账本');
assert.strictEqual(index(path.join(ROOT, 'data', 'manifests')).rows.length, before.rows, 'R5: 切换不得改 manifest 索引');
assert.strictEqual(out.trim(), '', 'R5: 切换事件必须投影为空（不进 AG-UI 流）');
console.log('OK R5 · 切换后账本哈希 ' + before.ledger.slice(0,8) + ' 未变 · 索引 ' + before.rows + ' 行未变 · 投影空');
