/* 出路层的词表 —— 「哪一类状态该说什么」（ADR-0044）。
 *
 * 与解析/渲染分开，用的是本仓已有的那一刀：prove_track 的 data / render / node /
 * view 就是按「数据与表现不在一个资产里」切的。理由是职责，不是行数——这张表会随
 * 界面长大，而解析器不会；把两者绑在一起，两者都会因为对方而越线。
 *
 * 它只装数据，没有一个函数。解析与渲染在 wayout.js，对外接口仍是 window.CxWayout。
 */
(function () {
  'use strict';

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

  window.CxWayoutWords = { WORDS: WORDS, KINDS: KINDS, ACTION_KINDS: ACTION_KINDS };
})();
