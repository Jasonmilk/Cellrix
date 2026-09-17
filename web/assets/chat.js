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

  /* 失败就地内联（ADR-0044 D5）：贴在对话区末尾，重发用同一段文本。
   *
   * 这里本来是 `Cx.showToast('发送失败: …')`——5 秒后消失，而输入框在发送时已被
   * 清空，于是"重发"这件事没有任何东西托着。`lastFail` 是为了替换而不是堆叠：
   * 连发两次失败只该留一条。 */
  var lastFail = null;
  function clearFail() {
    if (lastFail && lastFail.parentNode) { lastFail.parentNode.removeChild(lastFail); }
    lastFail = null;
  }
  function failRow(state) {
    var box = document.getElementById('chat-msgs');
    if (!box || !window.CxWayout) return;
    clearFail();
    lastFail = window.CxWayout.build(state);
    if (lastFail) { box.appendChild(lastFail); box.scrollTop = box.scrollHeight; }
  }

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
  // cls = optional extra class for the row (e.g. a PASS/FAIL tint on check rows).
  function foldRow(label, text, cls) {
    var b = box();
    var d = document.createElement('div');
    d.className = 'think-row fold' + (cls ? ' ' + cls : '');
    d.innerHTML = '<span class="think-head">' + Cx.esc(label) +
      '</span><span class="think-body"></span>';
    d.querySelector('.think-body').textContent = text || '';
    d.onclick = function () { d.classList.toggle('open'); };
    b.appendChild(d);
    b.scrollTop = b.scrollHeight;
    return d;
  }

  // A tool plan (assistant/attempt) carries raw JSON like
  // {"calls":[{"tool":"weather","args":{"city":"New York"}}]} — the deliverable
  // of that row is the READABLE plan ("weather · city=New York"), with the raw
  // JSON kept for the expanded state. Returns { label, raw }.
  function parsePlan(text) {
    var raw = text || '';
    var calls = [];
    try {
      var obj = JSON.parse(raw.replace(/^[\s\S]*?(\{.*\})[\s\S]*?$/, '$1'));
      if (obj && Array.isArray(obj.calls)) calls = obj.calls;
    } catch (e) { /* not JSON — keep the original text as the label */ }
    if (!calls.length) return { label: raw, raw: raw };
    var parts = calls.map(function (c) {
      var t = c.tool || '?';
      var a = c.args || {};
      var kv = Object.keys(a).map(function (k) { return k + '=' + String(a[k]); }).join(' ');
      return t + (kv ? ' · ' + kv : '');
    });
    return { label: '调用 ' + parts.join(' ｜ '), raw: raw };
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
    clearFail();                       /* 新一轮尝试不该把上一次的失败留在上面 */
    addMsg('user', text, false);
    input.value = '';
    Cx.state.chatBusy = true;
    btn.disabled = true; btn.textContent = '思考中…';
    var done = false;
    var job = Cx.state.nav.period || null;
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
              // A transport fault is the cockpit's business, not Helix's. If the
              // answer already streamed, keep it and finish quietly; only a
              // fault with no content becomes a row — inline, with the retry
              // that the cleared input box no longer provides (ADR-0044 D5).
              if (!bodyEl && !thinkEl) {
                failRow({
                  code: 'send-rejected',
                  detail: String(j.error),
                  action: { run: function () { input.value = text; sendChat(); } }
                });
              }
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
              // Continuation anchor (ADR-0026): this period's job becomes the
              // next resume_from, so consecutive messages stay ONE conversation
              // (threaded in the ProveTrack session list), never fragments.
              //
              // Briefly gated on `job` (2026-09-17) while the chain window was
              // still walking the whole subtree: back then a follow-up really
              // did surface inside the older period it continued. Cellrix:ADR-0021
              // fixed the window itself — it is now the LINEAGE PATH, ancestors
              // only — so chaining is safe again, and gating it was actively
              // harmful: every message became a separate experience and the live
              // store showed it (the newest periods all had resume_from absent).
              // Continuity is the original intent, so it is restored.
              if (j.job_id) Cx.setNav({ period: j.job_id });
              finish(); return;
            }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      /* 出路就在这儿：同一段文本，重发一次。 */
      failRow({
        code: 'send-failed',
        detail: String(e && e.message || e),
        action: { run: function () { input.value = text; sendChat(); } }
      });
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
  Cx.parsePlan = parsePlan;
  Cx.addThinkRow = addThinkRow;

  /* Entering the view focuses its input — the shell does not know this view
   * exists (ADR-0015 D8 follow-through). */
  Cx.onEnter('chat', function () {
    var i = document.getElementById('chat-text');
    if (i) i.focus();
  });
})();
