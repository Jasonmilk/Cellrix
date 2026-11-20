/* L2 抉择案卷（同一份 tape 的只读 target，不新增数据源）
 * 四件（据 queue「证轨的光」）：候选边 / 选中边 / SA-Core 支撑读数 / 未选原因
 * 输入：ring.json（GET /v1/agent/events 的落盘）+ session-events jsonl（同一 period）
 * 取不到的**具名 UNMEASURABLE**，不填想象值。 */
const fs = require('fs'), path = require('path');
const ringFile = process.argv[2], evDir = process.argv[3];
// B1-n（2026-11-19）：选"当轮"原来只按 **mtime 最新** ⇒ 苏醒 period 只要更晚写就顶掉真轮（已构造复现：
// 把苏醒 tape 的 mtime 改新 ⇒ 选中 000000、rows=6，而用户那轮是 000001）。
// 认轮必须能**由当次 POST 的 job_id/period_id 钉住**：`--expect <id>`（或 EXPECT_PERIOD 环境变量）。
const expIdx = process.argv.indexOf('--expect');
const expect = (expIdx > -1 ? process.argv[expIdx + 1] : process.env.EXPECT_PERIOD) || null;
// ①c B1-g（2026-11-19）：本文件原本对 `evDir` 里**所有** tape 逐行扫 —— `tape_rows` 变成 12 份之和
//     （实测 87）、`tool_calls`/`verdict_status` 会取到**别的 period**、`period_id` 取自"目录里第一份"。
//     与 B1-d 同族：跨轮取数。口径：多份时**以最新 mtime 那份为当轮**，其余不计，
//     并把 `tapes_in_dir` 写出（多份不是错，**静默合并**才是错）。
function listTapes(dir) {
  try {
    const out = fs.readdirSync(dir).filter(x => x.endsWith('.jsonl')).map(f => {
      let t = 0; try { t = fs.statSync(path.join(dir, f)).mtimeMs; } catch (_) {}
      return { f, t };
    });
    out.sort((a, b) => b.t - a.t);
    return out.map(x => x.f);
  } catch (_) { return []; }
}
const tapesInDir = (evDir && fs.existsSync(evDir)) ? listTapes(evDir) : [];
function tapeId(dir, f) {
  try {
    const line = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').find(l => l.trim());
    if (!line) return null;
    const d = JSON.parse(line);
    return { job: d.job_id || null, period: d.period_id || null };
  } catch (_) { return null; }
}
let tapes = [];
let selection = 'mtime-newest(unpinned)';
if (expect) {
  /* B1-s（2026-11-19）：同一个 **job_id** 可以有多个 period（每次重启的"苏醒轮"同 job id 不同 period）。
   * 原来 `.find()` 取第一个匹配 ⇒ **歧义被静默消解**成"钉住了"（selection 写法与唯一命中完全一样）。
   * 现在：把所有命中列出来；>1 就如实标 `ambiguous`，并写明按哪条规则选（mtime 最新）；
   * `--strict-pin` 时歧义 ⇒ rc=4（不猜）。 */
  const hits = tapesInDir.filter(f => {
    const id = tapeId(evDir, f);
    return id && ((id.period && id.period === expect) || (id.job && id.job === expect));
  });
  if (!hits.length) {
    console.error('UNMEASURABLE: --expect ' + expect + ' 在 ' + evDir + ' 里找不到对应 tape（不猜）');
    process.exit(4);
  }
  if (hits.length > 1) {
    const strict = process.argv.includes('--strict-pin');
    const picked = hits[0]; // tapesInDir 已按 mtime 降序
    const detail = 'expect:' + expect + ' (ambiguous n=' + hits.length + ', picked newest mtime: ' + path.basename(picked) + ')';
    if (strict) {
      console.error('UNMEASURABLE: --expect ' + expect + ' 命中 ' + hits.length + ' 份 tape ⇒ 歧义（--strict-pin 不猜）');
      process.exit(4);
    }
    tapes = [picked];
    selection = detail;
  } else {
    tapes = [hits[0]];
    selection = 'expect:' + expect;
  }
} else if (tapesInDir.length) {
  tapes = [tapesInDir[0]];
}
const tapes_in_dir = tapesInDir.length;

const transFile = process.argv[4];   // 可选：anaphase 状态机转移表源码（候选边的真源）
if (!ringFile) { console.error('UNMEASURABLE: 需要 <ring.json> [events-dir]'); process.exit(4); }
const ring = JSON.parse(fs.readFileSync(ringFile, 'utf8'));
const evs = ring.events || [];
const states = evs.filter(e => e.phase === 'state').map(e => JSON.parse(e.detail));
const beginRing = evs.find(e => e.phase === 'begin');
const endRing = evs.find(e => e.phase === 'end');
const end = evs.find(e => e.phase === 'end');
const hitl = evs.find(e => e.phase === 'hitl');

// ① 选中边 = 实际发生的迁移序列（tape 里有的）
const selected = states.map(s => `${s.from} --${s.condition}--> ${s.to}`);

// ② 候选边 = **状态机转移表**（源码为真源，可复现、可哈希），不是猜 tape。
//    tape 只记被选中的那条；兄弟边由程序定义决定，读程序即可，也不需要给事件加字段。
const byFrom = {};
for (const s of states) (byFrom[s.from] = byFrom[s.from] || []).push(s.condition);

let candidates = 'UNMEASURABLE（未提供状态机转移表）', transHash = null, unselected = null;
if (transFile && fs.existsSync(transFile)) {
  const src = fs.readFileSync(transFile, 'utf8');
  transHash = require('crypto').createHash('sha256').update(src).digest('hex').slice(0, 16);
  const re = /transitions\.insert\(\(HelixState::(\w+), TransitionCondition::(\w+)\),\s*HelixState::(\w+)\)/g;
  const table = {};
  let m;
  while ((m = re.exec(src))) (table[m[1]] = table[m[1]] || []).push({ cond: m[2], to: m[3] });
  // 每条被选中的边，列出同 from 下的其他候选（未选）
  unselected = states.map(st => {
    const all = table[st.from] || [];
    return {
      from: st.from,
      candidates: all.map(c => c.cond),
      selected: st.condition,
      not_taken: all.filter(c => c.cond !== st.condition).map(c => c.cond)
    };
  });
  candidates = '来自状态机转移表（' + Object.keys(table).length + ' 个状态 · ' + transHash + '）';
}

// ③ 支撑读数 = 该步的 condition + 该周期的 verdict（session 流 turn/end）
let verdict = 'UNMEASURABLE', rows = 0;
if (evDir && fs.existsSync(evDir)) {
  const f = tapes
    .map(x => path.join(evDir, x))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  if (f) {
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse);
    rows = lines.length;
    const te = lines.find(l => l.type === 'turn/end');
    /* B2-zd（2026-11-20）：`turn/end.verdict = null` 时原来写成**字符串 "null"**，
     * 页面于是渲染成字面 `<dd>null</dd>` —— 空值冒充值（第三态）。改为如实 UNMEASURABLE。 */
    if (te && te.data && te.data.verdict !== null && te.data.verdict !== undefined) {
      verdict = JSON.stringify(te.data.verdict);
    } else {
      verdict = 'UNMEASURABLE（tape 里 turn/end.verdict 为 null）';
    }
  }
}

// ③b 工具段（B1，2026-11-19）：AG-UI 出口已能产 TOOL_CALL_*，但**没有人展示它** ——
//     casefile 里根本没有工具信息，页面于是看不见"这一轮到底调没调工具"。
//     只读当轮 tape 的 tool/call + tool/result，不新增数据源。
let toolCalls = '本轮无工具段（tape 里 0 条 tool/call）';
if (evDir && fs.existsSync(evDir)) {
  const rows = [];
  for (const fn of tapes) {
    for (const line of fs.readFileSync(path.join(evDir, fn), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let d; try { d = JSON.parse(line); } catch (_) { continue; }
      if (d.type === 'tool/call') rows.push({ index: (d.data||{}).index, tool: (d.data||{}).tool, ok: null, ms: null });
      if (d.type === 'tool/result') {
        const r = rows.find(x => x.index === (d.data||{}).index);
        if (r) { r.ok = (d.data||{}).ok; r.ms = (d.data||{}).duration_ms; }
      }
    }
  }
  // B1-zh：缺失的读数不得渲染成假值 —— 原先 duration_ms 缺席时拼出 `undefinedms`、
  //        ok 缺席时拼出 `ok=null`，读起来都像真值。缺项一律写 UNMEASURABLE（与 D1/D2 口径一致）。
  const unm = v => (v === null || v === undefined) ? 'UNMEASURABLE' : v;
  if (rows.length) toolCalls = rows.map(r => 'index=' + r.index + ' · ' + r.tool + ' · ok=' + unm(r.ok)
    + ' · ' + (r.ms === null || r.ms === undefined ? 'UNMEASURABLE' : r.ms + 'ms'));
}

// ③c 判定行（B1，2026-11-19 第二个"有产出、无消费点"）：
//     tape 里有 `verdict/status`（status/checks/reason，即整轮判定），
//     而 Cellrix 的四个工具里**零命中** ⇒ 页面上看不到 Met/Unmet 与原因。
let verdictStatus = 'UNMEASURABLE（tape 里 0 条 verdict/status）';
let verdictRows = null;
if (evDir && fs.existsSync(evDir)) {
  for (const fn of tapes) {
    for (const line of fs.readFileSync(path.join(evDir, fn), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let d; try { d = JSON.parse(line); } catch (_) { continue; }
      if (d.type === 'verdict/status') {
        /* B1-v（2026-11-19）：与 B1-u 同族 —— 多条 verdict 时边扫边覆盖 ⇒ 静默取最后一条
         * （构造实测：真实 Met 之后追加 Unmet，casefile 只显示 Unmet，且无提示）。 */
        const v = d.data || {};
        if (!verdictRows) verdictRows = [];
        verdictRows.push({ status: v.status, checks: v.checks, reason: v.reason });
        verdictStatus = verdictRows[verdictRows.length - 1];
      }
    }
  }
}

// ①b B1-f（2026-11-19）：`begin`/`end` 原来只从 **ring** 取，且输出里**没有 period_id**
//     ⇒ 两个不同 period 的 casefile 可能**字节完全相同**（实测 fb4a4092… 两份一样），
//     页面于是无法归属到任何一轮（违反 I1：身份是 period_id）。
//     落盘 tape 才是这一轮的事实 ⇒ 先读 tape 的 user/message 与 turn/end，ring 只作兜底并标源。
let tapeBegin = null, tapeEnd = null, tapeRows = 0;
let beginRows = null, endRows = null;
if (evDir && fs.existsSync(evDir)) {
  for (const fn of tapes) {
    for (const line of fs.readFileSync(path.join(evDir, fn), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let d; try { d = JSON.parse(line); } catch (_) { continue; }
      tapeRows++;
      const v = d.data || {};
      /* B1-y（2026-11-19）：与 B1-u/v 同族 —— `begin` 取**第一条** user/message、`end` 取**最后一条** turn/end，
       * 两者都在多来源时**静默选一个**（构造实测：追加第二条 turn/end ⇒ end 变成构造的 success=false/impasse=true，
       * 无任何提示）。现在：各收全，>1 就标 ambiguous 并列出。 */
      if (d.type === 'user/message') { if (!beginRows) beginRows = []; beginRows.push({ input: v.text }); tapeBegin = beginRows[0]; }
      if (d.type === 'turn/end') { if (!endRows) endRows = []; endRows.push({ done: v.done, success: v.success, impasse: v.impasse, reason: v.reason }); tapeEnd = endRows[endRows.length - 1]; }
    }
  }
}

// ③d HITL 读数的源（B1，2026-11-19 第三个）：页面原来**只认 ring**（内存环）——
//     ring 为空/被 dropped 时，页面就丢了 HITL 四态，而 **tape（落盘）里明明有**。
//     落盘是持久事实，ring 是易失投影 ⇒ ring 缺就回落 tape，并如实标源。
// B1-d（2026-11-19 第四个）：ring 是**跨 period 的全局环**，`find(phase==='hitl')` 取到的可能是
// **别轮**的事件（实测 trace_id=run-8bba24c5… 而本轮 period_id=run-ec4a82…）。
// 身份是 period_id（I1）⇒ 只接受 trace_id === 本 period 的 ring 事件；否则回落 tape 并标 ring-stale。
const periodId = (function () {
  if (evDir && fs.existsSync(evDir)) {
    for (const fn of tapes) {
      const line = fs.readFileSync(path.join(evDir, fn), 'utf8').split('\n').find(l => l.trim());
      if (line) { try { const d = JSON.parse(line); if (d.period_id) return d.period_id; if (d.trace_id) return d.trace_id; } catch (_) {} }
    }
  }
  return null;
})();
const ringHitl = (typeof hitl !== 'undefined' && hitl) ? hitl : null;
const ringHitlOwn = ringHitl && (!periodId || !ringHitl.trace_id || ringHitl.trace_id === periodId);
let hitlValue = ringHitlOwn ? ringHitl : null;
let hitlTapeRows = null;
let hitlSource = hitlValue ? 'ring' : (ringHitl ? 'tape(ring-stale)' : null);
if (!hitlValue && evDir && fs.existsSync(evDir)) {
  for (const fn of tapes) {
    for (const line of fs.readFileSync(path.join(evDir, fn), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let d; try { d = JSON.parse(line); } catch (_) { continue; }
      const v = d.data || {};
      if (d.type === 'check/status' && v.phase === 'hitl') {
        /* B1-u（2026-11-19）：同一 period 里若有多条 hitl 行，原来**边扫边覆盖** ⇒ 静默取最后一条
         * （构造两行实测：真实 1 与构造 7 同时存在，casefile 只显示 7，无任何提示）。
         * 现在：全部收起来；>1 就如实标 ambiguous 并把每个元组列出来，让读者自己看到歧义。 */
        if (!hitlTapeRows) hitlTapeRows = [];
        hitlTapeRows.push({ allowed_once: v.allowed_once, rejected: v.rejected, cancelled: v.cancelled, unavailable: v.unavailable, kinds: v.kinds });
        hitlValue = hitlTapeRows[hitlTapeRows.length - 1];
        if (!hitlSource) hitlSource = 'tape';
      }
    }
  }
}
if (hitlValue && hitlValue.detail && typeof hitlValue.detail === 'string') {
  try { hitlValue = Object.assign({}, hitlValue, JSON.parse(hitlValue.detail), { ringDetailParsed: true }); } catch (_) {}
}
if (!hitlValue && hitlSource) hitlSource = 'UNMEASURABLE·ring-stale 且 tape 无本 period hitl 行';
if (!hitlValue) hitlValue = { _source: hitlSource || 'UNMEASURABLE·ring 与 tape 均无 hitl 行' };
if (hitlValue) hitlValue = Object.assign({}, hitlValue, { _source: hitlSource || hitlValue._source });
if (hitlTapeRows && hitlTapeRows.length > 1) {
  hitlValue = Object.assign({}, hitlValue, { _source: (hitlSource || 'tape') + '(ambiguous n=' + hitlTapeRows.length + ')', _rows: hitlTapeRows });
}

// ④ 未选原因 —— tape 里没有任何字段记录"为什么没走另一条边"
const unselectedReason = 'UNMEASURABLE';

/* B1-za（2026-11-20）：tape 缺 begin/end 时原来**无条件**回落 ring —— 即使 ring 里那条属于**别的 period**
 * （ring_mismatch 已把它标出来，但 end 仍被采用，读者只看 end 会读到别轮的 success/impasse）。
 * 与 B1-d/B1-h 同族：身份是 period_id。修法：**已知 mismatch 就不采用**，如实 UNMEASURABLE。
 * 口径：只有 ring 事件的 trace_id 与本 period 相同（或该事件无 trace_id）才允许回落。 */
function ringEventOwn(ev) {
  if (!ev) return false;
  const t = ev.trace_id || '';
  return !t || !periodId || t === periodId;
}
function ringFallbackBegin() {
  if (!beginRing) return null;
  if (!ringEventOwn(beginRing)) return { _source: 'ring(stale: 不采用，属于 ' + (beginRing.trace_id || '?') + ')' };
  return JSON.parse(beginRing.detail);
}
function ringFallbackEnd() {
  if (!endRing) return null;
  if (!ringEventOwn(endRing)) return { _source: 'ring(stale: 不采用，属于 ' + (endRing.trace_id || '?') + ')' };
  return JSON.parse(endRing.detail);
}

const out = {
  /* B1-q（2026-11-19）：这个字段名叫 `tape`，装的却是 **ring.json 的文件名** ——
   * 页面头部于是把 ring 当成 tape 展示。而 A 轮（5cfd94a）已证明 ring 只含苏醒 period，
   * 所以"看起来在读 tape、其实在读 ring"会让读者把苏醒轮的数据当成当轮。
   * 修：`tape` 保留但**改为真实 tape 名**；另列 `ring_file`（旧含义）与 `tape_file`（同 tape）。 */
  tape: (tapes[0] ? path.basename(tapes[0]) : 'UNMEASURABLE'),
  tape_file: (tapes[0] ? path.basename(tapes[0]) : 'UNMEASURABLE'),
  ring_file: path.basename(ringFile),
  transitions_source: transFile ? path.basename(transFile) : null,
  begin: (beginRows && beginRows.length > 1) ? { _ambiguous_n: beginRows.length, _rows: beginRows }
         : (tapeBegin || ringFallbackBegin()),
  end: end ? JSON.parse(end.detail) : null,
  hitl: hitl ? JSON.parse(hitl.detail) : null,
  end: (endRows && endRows.length > 1) ? { _ambiguous_n: endRows.length, _rows: endRows }
       : (tapeEnd || ringFallbackEnd()),
  period_id: (typeof periodId !== 'undefined' ? periodId : null),
  tape_rows: tapeRows,
  tapes_in_dir: tapes_in_dir,
  selection: selection,
  /* B1-h（2026-11-19）：页面里两套口径不同源 —— tape 定 period_id，ring 只作兜底。
   * 若 ring 里的事件属于**别的** period，必须显式写出，不能静默混用。 */
  ring_period_ids: Array.from(new Set((evs || []).map(e => e.trace_id).filter(Boolean))),
  ring_mismatch: (function () {
    const ids = Array.from(new Set((evs || []).map(e => e.trace_id).filter(Boolean)));
    if (!ids.length || !periodId) return null;
    if (ids.indexOf(periodId) !== -1) return null;
    return ids;
  })(),
  _source: { begin: tapeBegin ? 'tape' : 'ring', end: tapeEnd ? 'tape' : 'ring' },
  casefile: {
    selected_edges: selected,
    candidate_edges: candidates,
    candidate_not_taken: unselected === null ? 'UNMEASURABLE' : unselected,
    by_from_recorded: byFrom,
    support_reading: { verdict, session_rows: rows },
    tool_calls: toolCalls,
    verdict_status: (verdictRows && verdictRows.length > 1)
    ? { _ambiguous_n: verdictRows.length, _rows: verdictRows }
    : verdictStatus,
    hitl: hitlValue,
    unselected_reason: unselectedReason
  }
};
console.log(JSON.stringify(out, null, 1));

// 判据：三件必须非空；第四件缺失必须**具名**（不是静默）
const ok = selected.length > 0 && rows > 0 && verdict !== undefined;
if (!ok) { console.error('RED: 案卷三件取不全 ⇒ 不是"渲染为空"，是读数缺失'); process.exit(1); }
console.error('OK 案卷三件可取 · 未选原因 = ' + unselectedReason + '（具名缺口，不填想象值）');
