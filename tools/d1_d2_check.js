/* D1（线层）+ D2（语义层）各自的能红判据。
 * D1：同一份 tape 能派生出完整序列（首 RUN_STARTED / 末 RUN_FINISHED / TEXT_MESSAGE_* 齐 / 无 TOOL_CALL_*）
 * D2：每条事件按**钉定版本**的最小 schema 校验必填键；metadata 只许 verdict。
 *     ★ 替换声明：AG-UI 官方参考 SDK 未装 ⇒ D2 的"钉定 SDK"由 **钉定 schema 快照** 替代（具名，不假装等价）。
 * 用法：node tools/d1_d2_check.js <session-events.jsonl> */
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('UNMEASURABLE: 需要 <session-events.jsonl>'); process.exit(4); }
const BIN = path.join(__dirname, '..', '..', 'anaphase-helix', 'target', 'debug', 'agui');
if (!fs.existsSync(BIN)) { console.error('UNMEASURABLE: 投影器缺失 ' + BIN); process.exit(4); }
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'observations', 'agui-1.0-min.schema.json'), 'utf8'));

// 两种输入：① tape（走 bin 投影，端到端）② 已是 AG-UI 事件的文件（--agui，用于喂夹具）
const asAgui = process.argv.includes('--agui');
let raw = '';
if (asAgui) {
  raw = fs.readFileSync(src, 'utf8');
} else {
  try { raw = execSync(`${BIN} ${src} 2>/dev/null`, { encoding: 'utf8' }); }
  catch (e) { console.error('UNMEASURABLE: 投影器执行失败'); process.exit(4); }
}
const events = raw.trim().split('\n').filter(Boolean).map(JSON.parse);
if (!events.length) { console.error('RED D1: 投影为空（读到空不是通过）'); process.exit(1); }

// ---- D1 线层
const types = events.map(e => e.type);
const d1 = [];
if (types[0] !== 'RUN_STARTED') d1.push('首条不是 RUN_STARTED');
if (types[types.length - 1] !== 'RUN_FINISHED') d1.push('末条不是 RUN_FINISHED');
for (const t of ['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END'])
  if (!types.includes(t)) d1.push('缺 ' + t);
// 工具事件的正确性有两个方向，都要判（2026-11-19 修）：
//   反向（原本就有的守卫）：tape 没有工具段 ⇒ 不得出现 TOOL_CALL_*（防伪造）
//   正向（本轮真跑撞出来的）：tape 有 tool/call ⇒ 必须出现 TOOL_CALL_*（防"整段消失"）
const tapeTypes = new Set();
if (!asAgui) {
  for (const line of fs.readFileSync(src, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { tapeTypes.add(JSON.parse(line).type); } catch (_) {}
  }
}
const hasToolInTape = tapeTypes.has('tool/call');
const hasToolInAgui = types.some(t => t.startsWith('TOOL_CALL'));
if (hasToolInTape && !hasToolInAgui) d1.push('缺 TOOL_CALL_*（tape 里有 tool/call，投影把它丢了）');
if (!asAgui && !hasToolInTape && hasToolInAgui) d1.push('出现 TOOL_CALL_*（本轮 tape 无工具段）');

// ---- D2 语义层
const d2 = [];
for (const e of events) {
  const spec = SCHEMA.events[e.type];
  if (!spec) { d2.push('未钉定的事件类型: ' + e.type); continue; }
  for (const k of spec.required) if (!(k in e)) d2.push(e.type + ' 缺必填键 ' + k);
  if (e.metadata !== undefined) {
    const allowed = spec.metadata_keys || [];
    const extra = Object.keys(e.metadata).filter(k => !allowed.includes(k));
    if (extra.length) d2.push(e.type + ' metadata 出现未钉定键: ' + extra.join(','));
  }
}
console.log(JSON.stringify({ d1_fail: d1, d2_fail: d2, events: events.length, types,
  schema_pinned: SCHEMA.pinned }, null, 1));
if (d1.length) { console.error('RED D1: ' + d1.join(' · ')); }
if (d2.length) { console.error('RED D2: ' + d2.join(' · ')); }
if (d1.length || d2.length) process.exit(1);
console.error('OK D1/D2：序列完整 · 全部事件符合钉定 schema ' + SCHEMA.pinned);
