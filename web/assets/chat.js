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

  /* S303 / ADR-0048 §303: AFTER A SUCCESSFUL SEND THE POINTER MUST BECOME THE **NEW PERIOD**.
   *
   * WHY THE OBVIOUS FIX IS WRONG (all three links measured, not inferred):
   *  · the terminal line carries `job_id` and NO `period_id`
   *    — `{"done":true,…,"job_id":"run-843f646b0baa396f",…}`, and `period_id` appears zero times in
   *    `web/src/routes.rs`;
   *  · anaphase resolves `job_id` to a PERIOD (`resolve_one` + `is_period_id`, `main.rs:553`/`:569`) and its
   *    own comment says "Unresolvable or ambiguous yields no parent" ⇒ feeding it a job digest yields
   *    `resume_period = None` ⇒ `parent: null`;
   *  · MEASURED live: two sends in a row produced TWO different job ids — i.e. a brand-new conversation each
   *    time, the silent behaviour the pin was hiding.
   *
   * OWNER RULING (2026-10-04, option A): re-read the period list and locate the new period BY LINEAGE, so no
   * backend contract is touched during the P1 churn. FOUR GUARDRAILS, each visible below:
   *   1. bounded retry 3 × 2s; on timeout the pointer KEEPS ITS OLD VALUE and the miss is RECORDED
   *      (`Cx.state.s303`) — a silent null is exactly what this fix exists to remove;
   *   2. DUAL KEY — `job_id === j.job_id` AND `parent === the anchor that was sent`; several hits are an
   *      ANOMALY, reported, and the highest `-p` serial wins;
   *   3. NO "newest period" fallback anywhere: taking the newest is precisely the regression mutation ③ catches;
   *   4. duplicates are reported, never silently broken as a tie. */
  var S303_ATTEMPTS = 3;
  var S303_DELAY_MS = 2000;
  function periodSerial(pid) {
    var m = String(pid).match(/-p([0-9a-fA-F]+)$/);
    return m ? parseInt(m[1], 16) : -1;
  }
  function noteS303(state) { Cx.state.s303 = state; }
  function advancePointer(j, sentAnchor) {
    var anchor = sentAnchor || null;
    var attempt = 0;
    function tryOnce() {
      attempt++;
      return fetch('/api/sessions?limit=50')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var rows = (d && d.periods) || [];
          var hits = rows.filter(function (p) {
            return p.job_id === j.job_id && (p.parent || null) === anchor;
          });
          if (hits.length > 1) {
            /* GUARDRAIL 4: a duplicate is an anomaly to REPORT, not a tie to break in silence. */
            console.warn('[S303] ' + hits.length + ' periods matched job_id+parent; taking the highest -p serial');
          }
          if (!hits.length) {
            if (attempt <= S303_ATTEMPTS) {
              return new Promise(function (res) { setTimeout(res, S303_DELAY_MS); }).then(tryOnce);
            }
            /* GUARDRAIL 1 + 3: keep the old value, RECORD the miss, never invent a target. */
            noteS303({ resolved: false, reason: 'no period matched job_id+parent',
                       attempts: attempt, job_id: j.job_id, sent_parent: anchor, at: Date.now() });
            return null;
          }
          hits.sort(function (a, b) { return periodSerial(b.period_id) - periodSerial(a.period_id); });
          var target = hits[0].period_id;
          Cx.setNav({ period: target });
          if (typeof Cx.setRef === 'function') { Cx.setRef(target, j.conversation_id || null); }
          noteS303({ resolved: true, period_id: target, matched: hits.length,
                     job_id: j.job_id, sent_parent: anchor, at: Date.now() });
          return target;
        })
        /* GUARDRAIL 1 ALSO COVERS ERRORS (measured need: a rejected re-read was invisible — the pointer stayed
         * null and nothing said why). An exception is a NAMED miss here, never a silent one. */
        .catch(function (err) {
          noteS303({ resolved: false, reason: 're-read failed: ' + (err && err.message ? err.message : String(err)),
                     attempts: attempt, job_id: j.job_id, sent_parent: anchor, at: Date.now() });
          return null;
        });
    }
    return tryOnce();
  }

  function sendChat() {
    var input = document.getElementById('chat-text');
    var text = input.value.trim();
    if (!text) return;
    if (Cx.state.chatBusy) return; // 一轮思考未结，防并发连发
    var btn = document.querySelector('.chat-input .btn');
    clearFail();                       /* 新一轮尝试不该把上一次的失败留在上面 */
    addMsg('user', text, false);
    input.value = ''; growComposer(input);
    Cx.state.chatBusy = true;
    btn.disabled = true; btn.textContent = '思考中…';
    var done = false;
    /* THE CONTINUATION IDENTIFIER IS A JOB, NOT A PERIOD (ADR-0048 §265). Measured: `nav.period` holds
     * the SELECTED PERIOD id (that is what the sidebar sets and what the shell's period notification
     * carries), while the server's `job_id` must be `run-<1..=16 hex>` — a period id
     * (`run-…-p…`) fails that shape, so "click a card, type, send" could NOT continue the
     * conversation at all ("无法对话"). `meta.job_id` was already being passed by both the legacy card
     * click and the tree's click; it simply was not used here. Job for the scope, period for the
     * identity — the same two-facts rule as the lineage fix (§251), on the client side. */
    /* VIEWING IS NOT RESUMING (ADR-0048 §299). `nav.period` is WHAT I AM LOOKING AT — the panel
     * selects a default detail on boot, so falling back to it made EVERY first message continue that
     * period: "打开页面直接打字" could no longer start a conversation (the owner's report). The resume
     * target is only what an explicit CONTINUE action set (`nav.meta.job_id`, written by the sidebar
     * click) or what the ✗ / +新对话 control cleared. No target ⇒ the server starts a NEW conversation. */
    /* THE REF IS THE ONLY SOURCE OF "WHERE THE NEXT MESSAGE ATTACHES" (ADR-0048 §307). It replaces the
     * sticky metadata slot that used to stand in for it: `ref.current` is written by exactly one function
     * (`Cx.setRef`) when a period is chosen, when a conversation is started, or (after a reply lands) when
     * the pointer advances. No target ⇒ the server starts a NEW conversation. */
    var job = (Cx.state.ref && Cx.state.ref.current) || null;
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
              /* The nav key is the period IDENTITY, not the digest: two runs of one
               * input share `job_id`, and the list is keyed by `period_id` (B16).
               * Falls back to the digest for a server that has not sent one yet. */
              /* THE POINTER ADVANCES WHEN THE REPLY LANDS (ADR-0048 §307): one of the four ref
               * operations (new / continue / fork / advance). It is not a guess about intent — the
               * conversation that just answered IS where the next message attaches. */
              /* ONE IDENTIFIER FOR **BOTH** (ADR-0048 §303). MEASURED on the live panel: the terminal line is
               * `{"done":true,…,"job_id":"run-843f646b0baa396f",…,"reply":"…"}` — it carries `job_id` and
               * NO `period_id` (`period_id` appears zero times in `web/src/routes.rs`). The nav had the
               * fallback and the POINTER did not, so the pointer never advanced: every message became a new
               * experience and "continue this conversation" was impossible. Nav and pointer now use the SAME
               * rule, so they cannot disagree about which conversation is current. */
              /* S303 (ADR-0048 §303, owner ruling A): locate the NEW PERIOD by lineage. The response carries
               * only `job_id`, and a job digest is not a lineage anchor (measured: it yields `parent: null`),
               * so the pointer is resolved from the period list with the FOUR GUARDRAILS documented above. */
              advancePointer(j, sentAnchor);
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
  /* COMPOSER KEYS (owner request): the box is a TEXTAREA, so Enter is a NEWLINE and
   * `Cmd/Ctrl+Enter` sends. Esc clears. One modifier, no ambiguity about which gesture sends. */
  document.addEventListener('keydown', function (e) {
    if (!e.target || e.target.id !== 'chat-text') return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChat(); return; }
    if (e.key === 'Escape') { e.target.value = ''; growComposer(e.target); }
  });

  /* AUTO-GROW: the box starts at one line and grows with its content up to the CSS max-height, so a
   * multi-line message stays visible without stealing the conversation's space. */
  function growComposer(el) {
    if (!el) { return; }
    try {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight || 0, 200) + 'px';
    } catch (err) { /* a measured height is cosmetic; never block typing */ }
  }
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'chat-text') { growComposer(e.target); }
  }, true);

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
