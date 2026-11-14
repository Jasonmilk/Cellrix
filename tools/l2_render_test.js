/* L2 渲染的判据（三形）：① 真实案卷 ⇒ 页面含 5 条选中边 + 2 处"本 tape 未记录"
 * ② 缺口被涂成"有值"（删掉 UNMEASURABLE 换成空串）⇒ 必须 RED（不许把缺画成空）
 * ③ 缺输入 ⇒ UNMEASURABLE（不是生成空白页通过） */
const fs = require('fs'), path = require('path'), assert = require('assert'), { execSync } = require('child_process');
const T = (s) => path.join('/tmp/l2', s);
const run = (cf, d3, out) => { try { execSync(`node ${__dirname}/l2_render.js ${cf} ${d3} ${out}`, { stdio: 'pipe' }); return 0; } catch (e) { return e.status || 1; } };

// ③ 缺输入
assert.strictEqual(run('/tmp/nope.json', T('d3.json'), T('x.html')), 4, '缺输入必须 UNMEASURABLE(4)');

// ① 正常
assert.strictEqual(run(T('case.json'), T('d3.json'), T('ok.html')), 0);
const html = fs.readFileSync(T('ok.html'), 'utf8');
const gaps = (html.match(/本 tape 未记录/g) || []).length;
assert.strictEqual(gaps, 2, '两处缺口必须如实标注');
assert.ok(html.includes('Perception --Success--> PreAssessment'), '选中边必须渲染');
assert.ok(/D3 对照/.test(html), 'D3 对照段必须在');

// ② 静默缺失**不可能**：渲染层用 `v || 'UNMEASURABLE'`，空串/缺键都会落回具名缺口。
//    ⇒ 这条断言验的是那个保证（不是"能抓静默"，抓不到是因为结构上不存在静默）。
//    ★ 我上一版把这条写成"必须抓到"= 假测试（空串被 `||` 兜住，抓不到但测试仍绿）。
const bad = JSON.parse(fs.readFileSync(T('case.json'), 'utf8'));
bad.casefile.candidate_edges = ''; bad.casefile.unselected_reason = '';
fs.writeFileSync(T('case_bad.json'), JSON.stringify(bad));
run(T('case_bad.json'), T('d3.json'), T('bad.html'));
const badHtml = fs.readFileSync(T('bad.html'), 'utf8');
const badGaps = (badHtml.match(/本 tape 未记录/g) || []).length;
if (badGaps !== 2) {
  console.error('RED: 空串/缺键没有被兜成具名缺口（实际标注 ' + badGaps + ' 处）⇒ 渲染层允许假完整');
  process.exit(1);
}
// ③' 缺键（不是空串）同样必须兜住
const gone = JSON.parse(fs.readFileSync(T('case.json'), 'utf8'));
delete gone.casefile.candidate_edges;
fs.writeFileSync(T('case_gone.json'), JSON.stringify(gone));
run(T('case_gone.json'), T('d3.json'), T('gone.html'));
const goneGaps = (fs.readFileSync(T('gone.html'), 'utf8').match(/本 tape 未记录/g) || []).length;
if (goneGaps !== 2) { console.error('RED: 缺键未兜成具名缺口（' + goneGaps + ' 处）'); process.exit(1); }
console.log('OK L2 渲染：正常 2 处如实标注 · 缺输入 UNMEASURABLE(4) · 空串/缺键都被兜成具名缺口');
