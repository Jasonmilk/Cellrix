/* 入口②的反向检查：①真实案卷 ⇒ 每个 UNMEASURABLE 都有可见「本 tape 未记录」且样式区别于有值
 * ②把缺口改成"有值" ⇒ 页面必须变化（标注消失）——证明页面不会把缺涂成有值
 * ③缺输入 ⇒ UNMEASURABLE(4) */
const fs = require('fs'), assert = require('assert'), { execSync } = require('child_process');
const CF = 'docs/observations/l2-casefile-2026-11-05.json';
const D3 = 'docs/observations/l2-d3-compare-2026-11-05.json';
const run = (cf, out) => { try { execSync(`node tools/l2_render.js ${cf} ${D3} ${out}`, { stdio: 'pipe' }); return 0; } catch (e) { return e.status || 1; } };
const countGap = f => (fs.readFileSync(f, 'utf8').match(/本 tape 未记录/g) || []).length;

assert.strictEqual(run('/tmp/nope.json', '/tmp/x.html'), 4, '缺输入必须 UNMEASURABLE(4)');

const base = JSON.parse(fs.readFileSync(CF, 'utf8'));
const gapsInCase = Object.values(base.casefile).filter(v => typeof v === 'string' && v.startsWith('UNMEASURABLE')).length;
assert.strictEqual(run(CF, '/tmp/ok.html'), 0);
const n = countGap('/tmp/ok.html');
assert.ok(n >= gapsInCase, '每个 UNMEASURABLE 都应有可见标注（案卷 ' + gapsInCase + ' 项，页面 ' + n + ' 处）');
assert.ok(/class="gap"/.test(fs.readFileSync('/tmp/ok.html', 'utf8')), '缺口必须有区别于有值的样式');

// 反向：把缺口填成有值 ⇒ 标注必须消失（页面变化）
const filled = JSON.parse(JSON.stringify(base));
filled.casefile.unselected_reason = '园丁裁定：该边未选是因为 X（示例）';
fs.writeFileSync('/tmp/filled.json', JSON.stringify(filled));
assert.strictEqual(run('/tmp/filled.json', '/tmp/filled.html'), 0);
const n2 = countGap('/tmp/filled.html');
assert.ok(n2 < n, '把缺口填成有值后标注应减少（前 ' + n + ' 后 ' + n2 + '）');
assert.notStrictEqual(fs.readFileSync('/tmp/ok.html', 'utf8'), fs.readFileSync('/tmp/filled.html', 'utf8'), '有值/无值页面必须不同');
console.log('OK 入口②：缺口 ' + n + ' 处可见且样式独立 · 填值后降到 ' + n2 + ' · 页面有差异 · 缺输入 rc=4');
