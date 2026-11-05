/* L2 证轨：消费 anaphase bin/agui 产出的标准事件（单源，不重新实现映射）。
 * 严格版：**每条**证轨条目都带 verdict —— 这是计划 2/3.a 的原始形状，先让它自己红。 */
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const SRC = process.argv[2];
if (!SRC) { console.log('UNMEASURABLE: 需要 <session-events.jsonl>'); process.exit(4); }
const BIN = path.join(__dirname, '..', '..', 'anaphase-helix', 'target', 'debug', 'agui');
if (!fs.existsSync(BIN)) { console.log('UNMEASURABLE: 投影器二进制不存在: ' + BIN); process.exit(4); }
const raw = execSync(`${BIN} ${SRC} 2>/dev/null`, { encoding: 'utf8' });
const events = raw.trim().split('\n').filter(Boolean).map(JSON.parse);
const rows = events.map(e => ({ t: e.type, verdict: (e.metadata || {}).verdict }));
/* 收窄（真跑撞出来的，不是偏好）：5 条标准事件里只有 RUN_FINISHED 可能有 verdict；
 * RUN_STARTED / TEXT_MESSAGE_* 在 AG-UI 1.0 里本来就不带。原来"每条都带 verdict"
 * 让 5/5 全红 —— 分母（5）与条目形状不自洽。
 * 新规则：① 条目 = 每条 AG-UI 事件（分母 5）② verdict 只对 RUN_FINISHED 有意义，
 * 且 null 必须表现为 metadata 空对象（不伪造、不补占位）。 */
const fin = rows.length ? rows[rows.length - 1] : null;
const missing = rows.filter(r => r.t !== 'RUN_FINISHED' && r.verdict !== undefined);
console.log('证轨条目 ' + rows.length + ' 条 · 缺 verdict 的 ' + missing.length + ' 条');
if (!fin || fin.t !== 'RUN_FINISHED') {
  console.log('RED 3.a: 末条不是 RUN_FINISHED ⇒ 证轨没有收尾，只有 ' + rows.length + ' 条'); process.exit(1);
}
if (missing.length) {
  console.log('RED 3.a: 条目形状含 verdict，但 ' + missing.length + '/' + rows.length +
              ' 条没有 verdict ⇒ 分母口径与条目形状不自洽');
  console.log(missing.map(m => '   - ' + m.t).join('\n'));
  process.exit(1);
}
console.log('OK 3.a · 分母 ' + rows.length + '（每条 AG-UI 事件）· RUN_FINISHED.verdict = ' + JSON.stringify(fin.verdict));
