/* ============================================================
  Cellrix 证轨数据层（ADR-0016 D1/D6）— 纯函数，零状态
  Anaphase 事件流 → 轨迹 SESSION
  映射原则：物理事实优先 —— 没有的数据显示 —，不编造。
  跨资产经 window.CxProveTrack 命名空间通信（ADR-0016 D2）。
  ============================================================ */
(function () {
  'use strict';
  var PT = window.CxProveTrack = window.CxProveTrack || {};

  /* ---------- 基础工具 ---------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function jsonOf(d) { try { return JSON.stringify(d, null, 2); } catch (e) { return String(d); } }
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  function firstLine(s, n) { s = String(s || '').split('\n')[0]; return short(s, n || 100); }

  /* ---------- 事件词表（线协议实测） ---------- */
  var STATUS = {
    ok: { t: '成功', c: 'ok' }, fail: { t: '失败', c: 'fail' },
    pending: { t: '待应答', c: 'pending' }, done: { t: '完成', c: 'done' }
  };
  var SCHEMA_NOTE = {
    'turn/start': 'turn/start — 认知周期开始（无负载）',
    'user/message': 'user/message — 人类输入',
    'context/inject': 'context/inject — SA-Core 上下文注入（L1/L3 记忆选择）',
    'assistant/think': 'assistant/think — 模型推理过程（思考，不直接呈现给人类）',
    'assistant/attempt': 'assistant/attempt — 模型行动意图（工具调用计划或直接回答）',
    'tool/call': 'tool/call — 工具调用发出，等待应答',
    'tool/result': 'tool/result — 工具执行结果；outcome 为业务产物（不含协议字段）',
    'check/status': 'check/status — 判据裁决（hard 拦截 / soft 记账）',
    'verdict/status': 'verdict/status — 本周期判决（Met / Unmet）',
    'assistant/reply': 'assistant/reply — 模型最终回答（本周期交付物，闭环链终点）',
    'turn/end': 'turn/end — 认知周期结束（done/success/impasse）'
  };
  var TYPES = {
    'turn/start': { type: 'SYSTEM', track: 'model' },
    'user/message': { type: 'USER', track: 'input' },
    'context/inject': { type: 'CONTEXT', track: 'input' },
    'assistant/think': { type: 'THINK', track: 'model' },
    'assistant/attempt': { type: 'ATTEMPT', track: 'model' },
    'tool/call': { type: 'TOOL', track: 'tool' },
    'tool/result': { type: 'TOOL', track: 'tool' },
    'check/status': { type: 'CHECK', track: 'tool' },
    'verdict/status': { type: 'VERDICT', track: 'tool' },
    'assistant/reply': { type: 'REPLY', track: 'model' },
    'turn/end': { type: 'END', track: 'model' }
  };

  /* ---------- 事件 → 呈现映射 ---------- */
  function summarize(e) {
    var d = e.data || {}, t = e.type;
    if (t === 'turn/start') return '认知周期启动';
    if (t === 'user/message') return short(d.text, 140);
    if (t === 'context/inject') {
      var s = '上下文注入 · SA-Core 选择';
      var tiers = (d.choice && d.choice.tiers) || {};
      var ks = Object.keys(tiers);
      if (ks.length) s += ' ' + ks.map(function (k) { return k + '×' + tiers[k]; }).join(' ');
      s += ' · nodes=' + d.nodes + ' chars=' + d.chars;
      if (d.resume_from) s += ' · resume ' + short(d.resume_from, 24);
      return s;
    }
    if (t === 'assistant/think') return '思考：' + firstLine(d.text, 100);
    if (t === 'assistant/reply') {
      var tag = d.model ? '[' + d.model + '] ' : '';
      return '回答：' + tag + firstLine(d.text, 140) + '（点击展开全文）';
    }
    if (t === 'assistant/attempt') {
      if (d.empty) return '（空回复 — 诚实标记，未编造）';
      var txt = String(d.text || '');
      var calls = null;
      try { var o = JSON.parse(txt); if (o && o.calls) calls = o.calls; } catch (e) {}
      if (calls) return '计划调用：' + calls.map(function (c) { return c.tool; }).join(', ');
      return '回答：' + firstLine(txt, 100);
    }
    if (t === 'tool/call') return (d.tool || 'tool') + ' · #' + d.index + ' · expect=' + esc(d.expect);
    if (t === 'tool/result') return (d.tool || 'tool') + ' · ' + (d.ok ? 'ok' : 'fail') + ' · ' +
      (d.duration_ms != null ? d.duration_ms + 'ms' : '—') +
      (d.outcome_sha ? ' · sha ' + d.outcome_sha : '');
    if (t === 'check/status') return ((d.gate || 'gate') + ' · ' + (d.check || '') +
      ' · ' + (d.passed ? 'PASS' : 'FAIL') + ' · expect=' + (d.expect || '—')).replace(/^gate/,'HARD').replace('HARD · ','HARDrule · ');
    if (t === 'verdict/status') return d.status + (d.reason ? ' · ' + d.reason : '');
    if (t === 'turn/end') {
      var r = 'done=' + d.done + ' · success=' + d.success;
      if (d.verdict) r += ' · verdict=' + d.verdict;
      if (d.impasse) r += ' · impasse';
      return r;
    }
    return t;
  }
  function statusOf(e) {
    var d = e.data || {}, t = e.type;
    if (t === 'tool/call') return 'pending';
    if (t === 'tool/result') return d.ok ? 'ok' : 'fail';
    if (t === 'check/status') return d.passed ? 'ok' : 'fail';
    if (t === 'verdict/status') return d.status === 'Met' ? 'ok' : 'fail';
    return 'done';
  }
  function toolName(e) {
    var d = e.data || {};
    return d.tool || (e.type === 'tool/call' ? 'tool' : null);
  }
  function payloadOf(e) {
    var d = e.data || {}, t = e.type;
    if (t === 'user/message') return jsonOf({ role: 'user', content: d.text });
    if (t === 'assistant/think') return jsonOf({ role: 'assistant', stage: 'think', text: d.text });
    if (t === 'assistant/reply') return jsonOf({ role: 'assistant', stage: 'reply', text: d.text, chars: d.chars, model: d.model });
    if (t === 'assistant/attempt') return jsonOf(d.empty ? { empty: true, text: '' } : { text: d.text });
    return jsonOf(d);
  }
  function resultOf(e) {
    var d = e.data || {}, t = e.type;
    if (t === 'context/inject') {
      var top = (d.choice && d.choice.top) || [];
      if (!top.length) return '（无节点命中）';
      return top.map(function (n) {
        return n.tier + '·' + n.heat + ' ' + short(n.id || '', 12) + ' ' + (n.phase || '');
      }).join('\n');
    }
    if (t === 'tool/call') return '等待工具应答…';
    if (t === 'tool/result') {
      var out = d.outcome;
      try { return JSON.stringify(JSON.parse(out), null, 2); } catch (e) { return out || '—'; }
    }
    if (t === 'check/status') return 'actual=' + (d.actual || '—') + (d.reason ? '\n' + d.reason : '');
    if (t === 'verdict/status') return d.reason || '—';
    if (t === 'user/message' || t === 'turn/end' || t === 'turn/start') return '—';
    if (t === 'assistant/think') return '（思考全文见 Payload）';
    if (t === 'assistant/reply') return d.chars != null ? d.chars + ' 字符' : '（回答全文见 Payload）';
    if (t === 'assistant/attempt') return '（意图与调用见 Payload）';
    return '—';
  }
  function resultIsTerm(e) {
    return e.type === 'tool/result' && /^[#\$>]/.test(String(e.data.outcome || ''));
  }

  /* ---------- 格式化 ---------- */
  function fmtDur(ms) { return ms === 0 ? '—' : (ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(2) + 's'); }
  function fmtTok(n) { return n ? n.toLocaleString('en-US') : '—'; }

  /* ---------- 数据构建：Anaphase 事件流 → SESSION ---------- */
  function buildSession(events, meta) {
    var out = [];
    var id0 = (meta && meta.job_id) || 'run';
    var note = (meta && (meta.name || meta.preview)) || '一段经历';
    var t1 = { kind: 'turn', id: 't1', index: 1, note: short(note, 60) };
    out.push(t1);
    events.forEach(function (e, i) {
      var map = TYPES[e.type];
      if (!map) return;
      var dur = 0;
      if (e.type === 'tool/result') dur = e.data.duration_ms || 0;
      else if (e.type === 'assistant/think' || e.type === 'assistant/attempt') {
        var nxt = events[i + 1];
        if (nxt) dur = Math.max(0, Date.parse(nxt.time) - Date.parse(e.time));
      }
      out.push({
        kind: 'ev', id: id0 + '#' + e.seq, turn: 't1',
        type: map.type, track: map.track,
        dur: dur, tok: null, tool: toolName(e),
        summary: summarize(e), status: statusOf(e),
        payload: payloadOf(e), result: resultOf(e),
        // REPLY full deliverable: kept verbatim so inline expand shows the
        // complete answer, not the truncated summary (no fake expand).
        full: e.type === 'assistant/reply' ? (e.data.text || '') : '',
        schema: SCHEMA_NOTE[e.type] || e.type, seq: e.seq, time: e.time
      });
    });
    return out;
  }

  /* ---------- 卡住判定：连续状态机，只在链尾标一次 ---------- */
  function computeRepeats(session) {
    session.forEach(function (e) { if (e.kind === 'ev') delete e.repeat; });
    var tool = null, streak = [];
    function flush() {
      if (streak.length >= 3) streak[streak.length - 1].repeat = streak.length;
      streak = [];
    }
    session.forEach(function (e) {
      if (e.kind !== 'ev') return;
      if (e.type === 'TOOL' && e.status === 'fail') {
        if (e.tool !== tool) { flush(); tool = e.tool; }
        streak.push(e);
      } else { flush(); tool = null; }
    });
    flush();
  }

  /* ---------- 对外导出（供 view / ctrl 层消费） ---------- */
  PT.$ = $; PT.esc = esc; PT.jsonOf = jsonOf; PT.short = short; PT.firstLine = firstLine;
  PT.STATUS = STATUS; PT.SCHEMA_NOTE = SCHEMA_NOTE; PT.TYPES = TYPES;
  PT.summarize = summarize; PT.statusOf = statusOf; PT.toolName = toolName;
  PT.payloadOf = payloadOf; PT.resultOf = resultOf; PT.resultIsTerm = resultIsTerm;
  PT.fmtDur = fmtDur; PT.fmtTok = fmtTok;
  PT.buildSession = buildSession; PT.computeRepeats = computeRepeats;
})();
