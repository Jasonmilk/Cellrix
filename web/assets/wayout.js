/* 出路层（ADR-0044）—— 一份状态进，一句话 + 一个动作出。
 *
 * WHY THIS IS ITS OWN ASSET AND NOT A FEW STRINGS IN THE VIEWS.
 *
 * Before this, four views each decided for themselves what to say when they had
 * nothing to show. Measured: twelve sites reported a failure and offered no way
 * out (`ADR-0044` §1.2 lists them) — every one of them the shape
 * "失败: <原始异常>", which is a sentence for a carbon reader and nothing at all
 * in the semantic topology. DNA 原则 3 forbids exactly that. An ACTION, by
 * contrast, has a code, a target and a precondition: it is addressable.
 *
 * The vocabulary lives here and nowhere else. The CAPABILITY does not: a view
 * hands in the function that performs its own retry, and this file never learns
 * which view called it. That is what keeps this a pure projection instead of a
 * god object that has to grow every time a view does (ADR-0044 D2).
 *
 * TOTAL BY CONSTRUCTION. `resolve` never throws, whatever it is handed — the
 * same tolerant-degradation reading as `parseHash` in period_normalize.js, and
 * for the same reason: the panel must still render when something it did not
 * write reaches it. An unrecognised code yields the raw detail plus whatever
 * action the caller supplied, flagged `unclassified`, rather than an exception
 * or a silent blank.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ── 词表 ────────────────────────────────────────────────────────────────
   * One entry per way a surface can fail to have something to show.
   *
   * `kind`  empty   — there is legitimately nothing yet; the exit is how to make some
   *         loading — work is in flight; an exit is optional (waiting is an action)
   *         error   — something broke; an exit is REQUIRED (asserted by the test)
   *         blocked — the user must do something elsewhere first
   *
   * `action.kind` says what sort of move it is, so a caller can style or rank it
   * without re-deriving it from the label:
   *   retry | focus | open | command | switch-view
   *
   * Wording rules: say what happened, then what to do. Never paste a raw
   * exception into `text` — it goes in `detail`, which `render` puts behind a
   * disclosure (ADR-0044 D3).
   */
  var WORDS = {
    /* ── shell: the frame, the status line, the ecosystem board ── */
    'shell-connecting': {
      surface: 'shell', kind: 'loading', text: '正在连接 Anaphase…'
    },
    'no-snapshot': {
      surface: 'shell', kind: 'error',
      text: 'Anaphase 没有给出快照。先确认它在跑，再回来。',
      action: { label: '检查 up 是否在运行', kind: 'command' }
    },
    'snapshot-fetch-failed': {
      surface: 'shell', kind: 'error',
      text: '拉不到 Anaphase 快照——面板上的数字会停在最后一次成功的值。',
      action: { label: '面板每几秒自动重试一次', kind: 'auto' }
    },
    'ecosystem-unavailable': {
      surface: 'shell', kind: 'error',
      text: '生态探测不可用（代理未就绪）。各组件是否在线暂时无法确认。',
      action: { label: '面板每几秒自动重试一次', kind: 'auto' }
    },
    'events-unreadable': {
      surface: 'shell', kind: 'error',
      text: '事件流读不通，合并时发现异常。不猜测——给你原始判据。',
      action: { label: '重试这一段', kind: 'retry' }
    },

    /* ── the period list, shared by the chat and trajectory sidebars ── */
    'sessions-loading': {
      surface: 'sessions', kind: 'loading', text: '经历列表加载中…'
    },
    'sessions-empty': {
      surface: 'sessions', kind: 'empty',
      text: '尚无经历。先和 Helix 说一句话，这里就会有第一条。',
      action: { label: '去对话', kind: 'switch-view' }
    },
    'sessions-unconfigured': {
      surface: 'sessions', kind: 'blocked',
      text: '会话事件流未开启，所以这里永远是空的。',
      action: { label: '配置 session_events_path', kind: 'command' }
    },
    'sessions-fetch-failed': {
      surface: 'sessions', kind: 'error',
      text: '经历列表拉取失败。面板还不知道有哪些经历。',
      action: { label: '重试拉取', kind: 'retry' }
    },

    /* ── the conversation ── */
    'chat-empty': {
      surface: 'chat', kind: 'empty',
      text: '尚未开始的对话。说句话吧——这是给 Helix 的一段新经历。',
      action: { label: '开始输入', kind: 'focus' }
    },
    'chat-thinking': {
      surface: 'chat', kind: 'loading', text: '思考中…'
    },
    'history-loading': {
      surface: 'chat', kind: 'loading', text: '正在加载这段经历的历史…'
    },
    'history-fetch-failed': {
      surface: 'chat', kind: 'error',
      text: '这段经历的历史没载入成功。',
      action: { label: '重新载入', kind: 'retry' }
    },
    'events-all-rejected': {
      surface: 'chat', kind: 'error',
      text: '这段经历的**全部**事件都被拒收了——未知类型或格式不符，所以你看不到内容。',
      action: { label: '查看原始事件', kind: 'open' }
    },
    'send-failed': {
      surface: 'chat', kind: 'error',
      text: '这一句没发出去。你的输入还在，可以直接重发。',
      action: { label: '重发', kind: 'retry' }
    },
    'send-rejected': {
      surface: 'chat', kind: 'error',
      text: '运行时拒收了这一句（见下方原始信息）。',
      action: { label: '重发', kind: 'retry' }
    },
    'rename-failed': {
      surface: 'chat', kind: 'error',
      text: '改名没保存成功。标题仍是原来的。',
      action: { label: '重试改名', kind: 'retry' }
    },

    /* ── the trajectory ── */
    'trajectory-empty': {
      surface: 'prove-track', kind: 'empty',
      text: '从左边选一段经历，它的证轨会在这里展开成一条可审计的链。',
      action: { label: '看最新的一段', kind: 'switch-view' }
    },
    'trajectory-loading': {
      surface: 'prove-track', kind: 'loading', text: '正在取这一段的事件…'
    },
    'trajectory-load-failed': {
      surface: 'prove-track', kind: 'error',
      text: '这段经历的证轨没载入成功。',
      action: { label: '重新载入', kind: 'retry' }
    },
    'trajectory-no-rows': {
      surface: 'prove-track', kind: 'empty',
      text: '这段经历里没有可画成行的东西。',
      action: { label: '换一段经历', kind: 'switch-view' }
    },
    'trajectory-no-match': {
      surface: 'prove-track', kind: 'empty',
      text: '没有行匹配当前的筛选词。',
      action: { label: '清除筛选', kind: 'focus' }
    },

    /* ── the metering desk ── */
    'flows-loading': {
      surface: 'flows', kind: 'loading', text: '加载中…'
    },
    'flows-fetch-failed': {
      surface: 'flows', kind: 'error',
      text: '拉取失败——检定台的数据没到。',
      action: { label: '刷新', kind: 'retry' }
    },
    'flowmodus-unconfigured': {
      surface: 'flows', kind: 'blocked',
      text: 'FlowModus 未配置或不可达，所以路由与供应商池无法显示。',
      action: { label: '用 --flowmodus-url 指定', kind: 'command' }
    },
    'tuck-unconfigured': {
      surface: 'flows', kind: 'blocked',
      text: 'Tuck 未配置或不可达，所以审计统计无法显示。',
      action: { label: '用 --tuck-endpoint 指定', kind: 'command' }
    },
    'providers-empty': {
      surface: 'flows', kind: 'empty',
      text: '供应商池是空的。',
      action: { label: 'flowmodus supplier add', kind: 'command' }
    },
    'calls-empty': {
      surface: 'flows', kind: 'empty',
      text: '还没有推理调用记录。',
      action: { label: '刷新', kind: 'retry' }
    },
    'route-decision-failed': {
      surface: 'flows', kind: 'error',
      text: '路由层报错了——它没能决定这一程走哪条路。',
      action: { label: '重新问一次路由', kind: 'retry' }
    },

    /* ── the audit badge ── */
    'audit-violations': {
      surface: 'cockpit', kind: 'error',
      text: '审计发现违约项。明细在下方原始信息里。',
      action: { label: '打开审计明细', kind: 'open' }
    },
    'audit-unavailable': {
      surface: 'cockpit', kind: 'error',
      text: '审计链暂时读不到。',
      action: { label: '重试审计', kind: 'retry' }
    },
    'ledger-empty': {
      surface: 'cockpit', kind: 'empty',
      text: 'Ledger 为空（Noop 模式下不会有记录）。',
      action: { label: '配置 reasoning 后重来', kind: 'command' }
    }
  };

  var KINDS = { empty: 1, loading: 1, error: 1, blocked: 1 };
  /* `auto` = the exit is TIME, not a click: the panel already retries on its own
   * timer. Rendering that as a button would be packaging "the system is already
   * doing this" as "you must press something" — and it would put a control on a
   * surface whose only job is to report state. It renders as a note instead. */
  var ACTION_KINDS = { retry: 1, focus: 1, open: 1, command: 1, 'switch-view': 1, auto: 1 };

  function entryOf(code) {
    return Object.prototype.hasOwnProperty.call(WORDS, code) ? WORDS[code] : null;
  }

  /* The one entry point. TOTAL: never throws, whatever it is handed.
   *
   * state may be:
   *   a code string                      'send-failed'
   *   { code, detail, action:{run} }      the normal form
   *   anything else / nothing            → an unclassified error, still renderable
   */
  function resolve(state) {
    var s = state;
    if (typeof s === 'string') s = { code: s };
    if (!s || typeof s !== 'object') s = {};

    var code = typeof s.code === 'string' && s.code ? s.code : null;
    var detail = typeof s.detail === 'string' && s.detail ? s.detail : null;
    var handed = s.action && typeof s.action === 'object' ? s.action : null;
    var entry = code ? entryOf(code) : null;

    if (entry) {
      return {
        code: code,
        surface: entry.surface,
        kind: entry.kind,
        text: entry.text,
        /* The caller's run() wins; the vocabulary supplies the label when the
         * caller has none of its own (e.g. pure information states). */
        action: entry.action
          ? { label: (handed && handed.label) || entry.action.label,
              kind: (handed && handed.kind) || entry.action.kind,
              run: handed ? handed.run : null }
          : null,
        detail: detail,
        known: true,
        unclassified: false
      };
    }

    /* Unclassified. Say so plainly, keep the raw detail (ADR-0044 D3:降级而非
     * 丢弃), and still hand back whatever action the caller has — a state with
     * no way out must not be reachable even by accident. */
    return {
      code: code,
      surface: (s.surface && typeof s.surface === 'string') ? s.surface : null,
      kind: 'error',
      text: detail
        ? '出了点问题。原始信息在下面——把它报出来比我猜有用。'
        : '出了点问题，而且没有更细的信息。',
      action: handed
        ? { label: handed.label || '重试', kind: handed.kind || 'retry', run: handed.run || null }
        : null,
      detail: detail,
      known: false,
      unclassified: true
    };
  }

  /* Build the block, with no host. Returns the element (or null with no document).
   *
   * Built with createElement rather than innerHTML: `detail` is untrusted text
   * (it comes from an exception), and the button has to be a real <button> so
   * it is reachable by keyboard — N-018 asks for a reachable focus, and a div
   * with an onclick is not one.
   *
   * `opts.className` keeps each surface's OWN wrapper instead of forcing one on
   * all of them: `.empty` is a wide centred block and `.fl-empty` is a plain
   * centred line, and swapping either for the other is a visual change that has
   * no business riding along inside a refactor. `opts.document` exists so that
   * `render` can hand over its host's document and this never reaches for a
   * global. */
  function build(state, opts) {
    opts = opts || {};
    var doc = opts.document || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.createElement !== 'function') return null;
    var r = resolve(state);

    var box = doc.createElement('div');
    box.className = opts.className || 'empty';
    box.setAttribute('data-wo-kind', r.kind);
    if (r.code) box.setAttribute('data-wo-code', r.code);

    var p = doc.createElement('p');
    p.textContent = r.text;
    box.appendChild(p);
    if (r.action) box.appendChild(actionNode(doc, r));
    if (r.detail) box.appendChild(detailNode(doc, r));

    return box;
  }

  /* The action, as a node.
   *
   * A button is rendered ONLY when there is a capability behind it. Two cases
   * fall back to a note instead:
   *
   *   `auto`          the exit is time, not a click (see ACTION_KINDS).
   *   no `run`        the vocabulary has words for this exit (often a command to
   *                   type, e.g. a flag name) but the surface supplied no
   *                   function. A button here would be a CONTROL THAT DOES
   *                   NOTHING — measured: removing a site's action still left a
   *                   button behind, because the label comes from the
   *                   vocabulary. A note says the same thing without lying.
   */
  function actionNode(doc, r) {
    var honourable = typeof r.action.run === 'function';
    if (r.action.kind === 'auto' || !honourable) {
      var n = doc.createElement('span');
      /* Why it is not a button matters to whoever reads the DOM: `auto` means
       * time is the exit, `note` means the layer has words but no capability. */
      n.setAttribute('data-wo-act', r.action.kind === 'auto' ? 'auto' : 'note');
      n.textContent = '（' + r.action.label + '）';
      return n;
    }
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm';
    b.setAttribute('data-wo-act', r.action.kind);
    b.textContent = r.action.label;
    b.onclick = function () {
      if (typeof r.action.run === 'function') { r.action.run(); }
    };
    return b;
  }

  /* Collapsed: the raw message is for the person debugging, not the person
   * reading. Kept, not shown by default (ADR-0044 D3). */
  function detailNode(doc, r) {
    var d = doc.createElement('details');
    var sum = doc.createElement('summary');
    sum.textContent = '原始信息';
    var pre = doc.createElement('pre');
    pre.textContent = r.detail;
    d.appendChild(sum);
    d.appendChild(pre);
    return d;
  }

  /* The same content with NO wrapper element, for surfaces whose own layout is
   * already the box: the status line, the ecosystem board, the trajectory's
   * empty area. Putting a `.empty` block inside a one-line status bar would be
   * the exit layer deciding a surface's styling, which is the surface's own
   * business — and would have meant new CSS for every such surface. */
  function buildInline(state, opts) {
    opts = opts || {};
    var doc = opts.document || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.createElement !== 'function') return null;
    var r = resolve(state);

    var frag = doc.createElement('span');
    frag.setAttribute('data-wo-kind', r.kind);
    if (r.code) frag.setAttribute('data-wo-code', r.code);

    var t = doc.createElement('span');
    t.textContent = r.text;
    frag.appendChild(t);
    /* A separator only when something follows, so a bare sentence has no
     * trailing space to get underlined by a hover style. */
    if (r.action) {
      frag.appendChild(doc.createTextNode(' '));
      frag.appendChild(actionNode(doc, r));
    }
    if (r.detail) {
      frag.appendChild(doc.createTextNode(' '));
      frag.appendChild(detailNode(doc, r));
    }
    return frag;
  }

  /* Clear `el` and put the block in it. Returns the block (or null when there is
   * nowhere to render — a caller with no host gets null, never an exception). */
  function put(el, node) {
    if (!el || !el.ownerDocument || !node) return null;
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(node);
    return node;
  }

  function render(el, state, opts) {
    if (!el || !el.ownerDocument) return null;
    var o = {}, k;
    if (opts) { for (k in opts) { if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k]; } }
    o.document = el.ownerDocument;
    return put(el, build(state, o));
  }

  function renderInline(el, state, opts) {
    if (!el || !el.ownerDocument) return null;
    var o = {}, k;
    if (opts) { for (k in opts) { if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k]; } }
    o.document = el.ownerDocument;
    return put(el, buildInline(state, o));
  }

  window.CxWayout = {
    VERSION: VERSION,
    resolve: resolve,
    build: build,
    buildInline: buildInline,
    render: render,
    renderInline: renderInline,
    has: function (code) { return !!entryOf(code); },
    codes: function () { return Object.keys(WORDS); },
    /* Exposed for the test to audit the vocabulary itself rather than trust it. */
    KINDS: KINDS,
    ACTION_KINDS: ACTION_KINDS
  };
})();
