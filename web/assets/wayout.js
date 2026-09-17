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

  /* 词表在 wayout.words.js（数据与表现分开）。缺了它就说不出话——但**不抛**：
   * 抛会把整页带下去，而本层的设计就是「任何输入都不炸」。取不到时一切走
   * unclassified 分支，仍渲染得出原始信息，并由测试断言「词表非空」。 */
  var W = window.CxWayoutWords || {};
  var WORDS = W.WORDS || {};
  var KINDS = W.KINDS || {};
  var ACTION_KINDS = W.ACTION_KINDS || {};

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