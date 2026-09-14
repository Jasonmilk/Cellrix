/* Conversation domain — message rows and the streaming send path.
 *
 * Split out of script.html (ADR-0015 D8 follow-through): the shell keeps the
 * frame only (view switch, shared namespace, status line); each view owns its
 * own rendering. Moved verbatim — no behaviour change.
 *
 * Depends on the shell (script.html) having run first: it reads `window.Cx`
 * at IIFE time for esc / toast / shared state.
 */
(function () {
  var Cx = window.Cx;

  function nowTs() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function msgs() { return document.getElementById('chat-msgs'); }

  /* First row of real content retires the empty state (空≠坏: the placeholder
   * is only there while there is genuinely nothing to show). */
  function box() {
    var b = msgs();
    var empty = b.querySelector('.empty');
    if (empty) empty.remove();
    return b;
  }

  /* Sender line of a Helix message. The model tag names the LLM that served
   * the turn — the physical model from the gateway chain (ADR-0036), never
   * the configured declaration. One slot, two sources of the same fact:
   * history replay reads it off the event stream, the live path off the SSE
   * terminal line. Shown only when a caller actually knows it. */
  function helixWho(model) {
    return 'Helix' + (model ? ' · <span class="mdl">' + Cx.esc(model) + '</span>' : '');
  }

  function addMsg(who, text, isErr) {
    var b = box();
    var d = document.createElement('div');
    d.className = 'msg ' + who + (isErr ? ' err' : '');
    d.innerHTML = '<span class="who">' + (who === 'user' ? '你' : 'Helix') +
      '<span class="ts">' + nowTs() + '</span></span>' + Cx.esc(text);
    b.appendChild(d);
    b.scrollTop = b.scrollHeight;
  }

  // Streaming message element: created once per reply, text appended as
  // SSE deltas arrive (typewriter). Returns the element to finalize.
  function addStreamMsg() {
    var b = box();
    var d = document.createElement('div');
    d.className = 'msg helix';
    d.innerHTML = '<span class="who">' + helixWho(null) + '</span><span class="body"></span>';
    b.appendChild(d);
    b.scrollTop = b.scrollHeight;
    return d.querySelector('.body');
  }

  // Reasoning disclosure (ReasoningRow): a collapsible think row above the
  // answer. Streamed while running; click to expand/collapse.
  function addThinkRow() {
    var b = box();
    var d = document.createElement('div');
    d.className = 'think-row';
    d.innerHTML = '<span class="think-head">思考</span><span class="think-body"></span>';
    d.onclick = function () { d.classList.toggle('open'); };
    b.appendChild(d);
    b.scrollTop = b.scrollHeight;
    return d.querySelector('.think-body');
  }

  // Unified collapsible row (水之波光：一种能力，全场景复用 — 过程折叠)：
  // process rows (思考/计划/工具) are one component; click to expand/collapse.
  // label = short tag, text = full payload (truncated to one line when closed).
  function foldRow(label, text) {
    var b = box();
    var d = document.createElement('div');
    d.className = 'think-row fold';
    d.innerHTML = '<span class="think-head">' + Cx.esc(label) +
      '</span><span class="think-body"></span>';
    d.querySelector('.think-body').textContent = text || '';
    d.onclick = function () { d.classList.toggle('open'); };
    b.appendChild(d);
    b.scrollTop = b.scrollHeight;
    return d;
  }

  // The deliverable is the protagonist: the reply is the message body, process
  // is collapsible above it. Full text, never truncated.
  function addReplyMsg(text, model) {
    var b = box();
    var d = document.createElement('div');
    d.className = 'msg helix';
    d.innerHTML = '<span class="who">' + helixWho(model) +
      '<span class="ts">' + nowTs() + '</span></span>' + Cx.esc(text);
    b.appendChild(d);
    b.scrollTop = b.scrollHeight;
    return d;
  }

  function sendChat() {
    var input = document.getElementById('chat-text');
    var text = input.value.trim();
    if (!text) return;
    if (Cx.state.chatBusy) return; // 一轮思考未结，防并发连发
    var btn = document.querySelector('.chat-input .btn');
    addMsg('user', text, false);
    input.value = '';
    Cx.state.chatBusy = true;
    btn.disabled = true; btn.textContent = '思考中…';
    var done = false;
    var job = Cx.state.chatJobId || null;
    function finish() {
      if (done) return;
      done = true;
      Cx.state.chatBusy = false;
      btn.disabled = false; btn.textContent = '发送';
      input.focus();
    }
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ message: text, job_id: job })
    }).then(function (r) {
      if (!r.body || !r.ok) { return r.json().then(function (j) {
        throw new Error((j.error || 'HTTP ' + r.status) + (j.detail ? ' — ' + j.detail : ''));
      }); }
      var reader = r.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      var bodyEl = null;
      var thinkEl = null;
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) { finish(); return; }
          buf += dec.decode(x.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            var evt = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            var line = evt.trim();
            if (line.indexOf('data:') !== 0) continue;
            var payload = line.slice(5).trim();
            if (!payload) continue;
            var j;
            try { j = JSON.parse(payload); } catch (e) { continue; }
            if (j.error) {
              // A transport fault is the cockpit's business, not Helix's.
              // If the answer already streamed, keep it and finish quietly;
              // only a fault with no content gets a toast.
              if (!bodyEl && !thinkEl) Cx.showToast(j.error);
              finish(); return;
            }
            if (j.think) {
              if (!thinkEl) thinkEl = addThinkRow();
              thinkEl.textContent += j.think;
              msgs().scrollTop = msgs().scrollHeight;
            }
            if (j.delta) {
              if (!bodyEl) bodyEl = addStreamMsg();
              bodyEl.textContent += j.delta;
              msgs().scrollTop = msgs().scrollHeight;
            }
            if (j.done) {
              if (!bodyEl) bodyEl = addStreamMsg();
              // reply is the authoritative full text — overwrite the
              // typewriter accumulation so a dropped delta can never leave
              // a truncated answer on screen.
              if (j.reply) bodyEl.textContent = j.reply;
              // Name the LLM that served this turn. The streaming row is
              // built before the model is known (it arrives with the terminal
              // line), so the sender slot is filled in here — the same slot
              // history replay fills from the event stream.
              if (j.model) {
                var who = bodyEl.parentElement && bodyEl.parentElement.querySelector('.who');
                if (who) who.innerHTML = helixWho(j.model);
              }
              // Continuation anchor (ADR-0026): this period's job becomes
              // the next resume_from, so consecutive messages stay ONE
              // conversation (threaded in the ProveTrack session list), never
              // fragments. Cleared only by "+ 新对话".
              if (j.job_id) Cx.state.chatJobId = j.job_id;
              finish(); return;
            }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      Cx.showToast('发送失败: ' + e.message);
    }).finally(function () {
      finish();
    });
  }

  /* Enter sends, Esc clears — owned here because the target is this view's
   * input, not the shell's business. */
  document.addEventListener('keydown', function (e) {
    if (!e.target || e.target.id !== 'chat-text') return;
    if (e.key === 'Enter') sendChat();
    if (e.key === 'Escape') e.target.value = '';
  });

  // Inline `onclick` attributes resolve against the global scope.
  window.sendChat = sendChat;
  Cx.addMsg = addMsg;
  Cx.addReplyMsg = addReplyMsg;
  Cx.foldRow = foldRow;
  Cx.addThinkRow = addThinkRow;

  /* Entering the view focuses its input — the shell does not know this view
   * exists (ADR-0015 D8 follow-through). */
  Cx.onEnter('chat', function () {
    var i = document.getElementById('chat-text');
    if (i) i.focus();
  });
})();
