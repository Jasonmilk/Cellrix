/* L2 抉择案卷（同一份 tape 的只读 target，不新增数据源）
 * 四件（据 queue「证轨的光」）：候选边 / 选中边 / SA-Core 支撑读数 / 未选原因
 * 输入：ring.json（GET /v1/agent/events 的落盘）+ session-events jsonl（同一 period）
 * 取不到的**具名 UNMEASURABLE**，不填想象值。 */
const fs = require('fs'), path = require('path');
const ringFile = process.argv[2], evDir = process.argv[3];
const transFile = process.argv[4];   // 可选：anaphase 状态机转移表源码（候选边的真源）
if (!ringFile) { console.error('UNMEASURABLE: 需要 <ring.json> [events-dir]'); process.exit(4); }
const ring = JSON.parse(fs.readFileSync(ringFile, 'utf8'));
const evs = ring.events || [];
const states = evs.filter(e => e.phase === 'state').map(e => JSON.parse(e.detail));
const begin = evs.find(e => e.phase === 'begin');
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
  const f = fs.readdirSync(evDir).filter(x => x.endsWith('.jsonl'))
    .map(x => path.join(evDir, x))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  if (f) {
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse);
    rows = lines.length;
    const te = lines.find(l => l.type === 'turn/end');
    verdict = te && te.data ? JSON.stringify(te.data.verdict) : 'UNMEASURABLE';
  }
}

// ③b 工具段（B1，2026-11-19）：AG-UI 出口已能产 TOOL_CALL_*，但**没有人展示它** ——
//     casefile 里根本没有工具信息，页面于是看不见"这一轮到底调没调工具"。
//     只读当轮 tape 的 tool/call + tool/result，不新增数据源。
let toolCalls = '本轮无工具段（tape 里 0 条 tool/call）';
if (evDir && fs.existsSync(evDir)) {
  const rows = [];
  for (const fn of fs.readdirSync(evDir).filter(x => x.endsWith('.jsonl'))) {
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
  if (rows.length) toolCalls = rows.map(r => 'index=' + r.index + ' · ' + r.tool + ' · ok=' + r.ok + ' · ' + r.ms + 'ms');
}

// ③c 判定行（B1，2026-11-19 第二个"有产出、无消费点"）：
//     tape 里有 `verdict/status`（status/checks/reason，即整轮判定），
//     而 Cellrix 的四个工具里**零命中** ⇒ 页面上看不到 Met/Unmet 与原因。
let verdictStatus = 'UNMEASURABLE（tape 里 0 条 verdict/status）';
if (evDir && fs.existsSync(evDir)) {
  for (const fn of fs.readdirSync(evDir).filter(x => x.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(evDir, fn), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let d; try { d = JSON.parse(line); } catch (_) { continue; }
      if (d.type === 'verdict/status') {
        const v = d.data || {};
        verdictStatus = { status: v.status, checks: v.checks, reason: v.reason };
      }
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
    for (const fn of fs.readdirSync(evDir).filter(x => x.endsWith('.jsonl'))) {
      const line = fs.readFileSync(path.join(evDir, fn), 'utf8').split('\n').find(l => l.trim());
      if (line) { try { const d = JSON.parse(line); if (d.period_id) return d.period_id; if (d.trace_id) return d.trace_id; } catch (_) {} }
    }
  }
  return null;
})();
const ringHitl = (typeof hitl !== 'undefined' && hitl) ? hitl : null;
const ringHitlOwn = ringHitl && (!periodId || !ringHitl.trace_id || ringHitl.trace_id === periodId);
let hitlValue = ringHitlOwn ? ringHitl : null;
let hitlSource = hitlValue ? 'ring' : (ringHitl ? 'tape(ring-stale)' : null);
if (!hitlValue && evDir && fs.existsSync(evDir)) {
  for (const fn of fs.readdirSync(evDir).filter(x => x.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(evDir, fn), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let d; try { d = JSON.parse(line); } catch (_) { continue; }
      const v = d.data || {};
      if (d.type === 'check/status' && v.phase === 'hitl') {
        hitlValue = { allowed_once: v.allowed_once, rejected: v.rejected, cancelled: v.cancelled, unavailable: v.unavailable, kinds: v.kinds };
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

// ④ 未选原因 —— tape 里没有任何字段记录"为什么没走另一条边"
const unselectedReason = 'UNMEASURABLE';

const out = {
  tape: path.basename(ringFile),
  transitions_source: transFile ? path.basename(transFile) : null,
  begin: begin ? JSON.parse(begin.detail) : null,
  end: end ? JSON.parse(end.detail) : null,
  hitl: hitl ? JSON.parse(hitl.detail) : null,
  casefile: {
    selected_edges: selected,
    candidate_edges: candidates,
    candidate_not_taken: unselected === null ? 'UNMEASURABLE' : unselected,
    by_from_recorded: byFrom,
    support_reading: { verdict, session_rows: rows },
    tool_calls: toolCalls,
    verdict_status: verdictStatus,
    hitl: hitlValue,
    unselected_reason: unselectedReason
  }
};
console.log(JSON.stringify(out, null, 1));

// 判据：三件必须非空；第四件缺失必须**具名**（不是静默）
const ok = selected.length > 0 && rows > 0 && verdict !== undefined;
if (!ok) { console.error('RED: 案卷三件取不全 ⇒ 不是"渲染为空"，是读数缺失'); process.exit(1); }
console.error('OK 案卷三件可取 · 未选原因 = ' + unselectedReason + '（具名缺口，不填想象值）');
