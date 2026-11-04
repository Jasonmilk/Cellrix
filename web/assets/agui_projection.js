/* L2 消费点：AG-UI 1.0 additive 投影的**真消费者**（不是 stdout 打印）。
 * 对齐 anaphase `src/agui.rs` 的规则：只映射真实骨架里有的行；
 * metadata 只挂 verdict；没有工具段就不造 TOOL_CALL_*（同一把尺子，两边各写一遍
 * 是刻意的：跨仓引用不可行，但形状必须逐条对齐，测试里逐项对照）。
 *
 * additive：删掉本文件，web 其余部分不受影响。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.AguiProjection = factory(); }
})(this, function () {
  function project(ev) {
    var ty = ev && ev.type || '';
    var thread = ev && ev.period_id || '';
    var run = ev && ev.job_id || '';
    var d = (ev && ev.data) || {};
    switch (ty) {
      case 'turn/start':
        return [{ type: 'RUN_STARTED', threadId: thread, runId: run }];
      case 'assistant/reply':
        var text = d.text || '';
        return [
          { type: 'TEXT_MESSAGE_START', threadId: thread, runId: run, messageId: run, role: 'assistant' },
          { type: 'TEXT_MESSAGE_CONTENT', threadId: thread, runId: run, messageId: run, delta: text },
          { type: 'TEXT_MESSAGE_END', threadId: thread, runId: run, messageId: run }
        ];
      case 'turn/end':
        return [{ type: 'RUN_FINISHED', threadId: thread, runId: run,
                  metadata: { verdict: (d.verdict === undefined ? null : d.verdict) } }];
      default:
        return [];   /* 认不出 ⇒ 空投影，不静默造事件 */
    }
  }
  function projectAll(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) out = out.concat(project(rows[i]));
    return out;
  }
  return { project: project, projectAll: projectAll };
});
