/* Real-render smoke test across ALL panel views.
 *
 * Loads the LIVE panel into jsdom, proxies relative fetch() to the real server,
 * then switches views through the real toolbar buttons (inline onclick=showView).
 * Asserts each view renders, that the shell stays intact, and that nothing throws.
 *
 * Usage: node all_views_test.js <panel_base_url> <job_id>
 *
 * Exit code: 0 = no regressions (known bugs are reported separately, see below).
 */
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.argv[2] || "http://127.0.0.1:18932";
const JOB_ARG = process.argv[3] || "";
let JOB = JOB_ARG;
const VIEWS = ["cockpit", "prove-track", "chat", "flows"];
/* N-001：主面只有一个（对话），其余是辅助面——住进右栏侧板，不再是平级视图。 */
const AUX = ["cockpit", "prove-track", "flows"];
const CJK = /[\u4e00-\u9fff]/;
const cjkCount = (s) => (s.match(new RegExp(CJK.source, "g")) || []).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0, skipped = 0;
function check(label, cond, detail) {
  const tail = detail ? "  [" + detail + "]" : "";
  if (cond) { pass++; console.log("  PASS  " + label + tail); }
  else { fail++; console.log("  FAIL  " + label + tail); }
}
/* Counted separately from pass: a green run must not claim coverage it did not
 * have. Used where there is genuinely nothing to exercise — an empty panel is
 * not a product defect. */
function skip(label, why) {
  skipped++;
  console.log("  SKIP  " + label + "  -> " + why);
}

(async () => {
  console.log("== all-views real render: " + BASE + " ==");

  /* With no job_id, ask the running panel for its newest period — the same
   * thing a person would do, and the difference between a check that can run
   * unattended and one that cannot. */
  if (!JOB) {
    try {
      const s = await (await fetch(BASE + "/api/sessions")).json();
      const p = (s.periods || [])[0];
      if (p && p.job_id) {
        JOB = p.job_id;
        console.log("job_id not given — using the newest period: " + JOB);
      } else {
        console.log("job_id not given and this panel has no period");
      }
    } catch (e) {
      console.log("job_id not given; could not list periods: " + e.message);
    }
  }

  const errors = [];
  /* Counted so a click can be asked "did you re-fetch the list?". Only the plain
   * list read counts: loadWindow asks with ?limit=, and that one is legitimately
   * per-period. */
  let sessionFetches = 0;
  /* jsdom reports the page's own story and its own limitations through the same
   * channel. `Not implemented: …` is jsdom saying IT lacks a browser API — the
   * page cannot fix it and neither can this test. Counting those as script
   * errors made three assertions permanently red while telling us nothing about
   * the page, which is the "always red is a ritual" failure.
   *
   * They are not dropped silently: the count is reported, because a document
   * claiming "no errors" while filtering a whole class of events has to say how
   * many it filtered — otherwise "no errors" and "errors I cannot see" read the
   * same. Define once, use at every capture site, so the three virtual consoles
   * cannot drift apart in what they consider an error. */
  let jsdomGaps = 0;
  const isJsdomGap = (m) => /Not implemented:/.test(m);
  const noteError = (list, msg) => { if (isJsdomGap(msg)) { jsdomGaps++; } else { list.push(msg); } };
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => noteError(errors, "jsdomError: " + e.message));
  vc.on("error", (...a) => noteError(errors, "console.error: " + a.join(" ")));

  const html = await (await fetch(BASE + "/")).text();
  const dom = new JSDOM(html, {
    url: BASE + "/", runScripts: "dangerously", pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // jsdom ships neither fetch nor matchMedia; supply both so the page runs
      // its real code path instead of dying in the theme bootstrap.
      window.fetch = (input, init) => {
        const url = typeof input === "string" && input.startsWith("/")
          ? BASE + input : input;
        if (/\/api\/sessions$/.test(String(url))) sessionFetches++;
        /* The metering desk is asserted on its EMPTY state below — "the slots come
         * from the exit layer". Left to the live server, that assertion depends on
         * this workspace happening to have no flows: measured against a configured
         * FlowModus, `/api/flows` returns real suppliers and tiers, every slot is
         * filled with content, no exit-layer block is built, and the check reads 0
         * while nothing about the page is wrong. A test whose precondition is
         * "the environment is empty" is red or vacuous depending on the machine.
         *
         * So the empty desk is supplied here, deterministically, with the same
         * `{flows: null}` shape the panel's own error-free empty path expects
         * (`renderFlows(null)` → `flowmodus-unconfigured`, `renderStats(null)` →
         * `tuck-unconfigured`, empty pools → `providers-empty`). Everything else
         * in this suite still runs against the live panel. */
        if (/\/api\/flows$/.test(String(url))) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ flows: null, stats: null }),
          });
        }
        return fetch(url, init);
      };
      window.matchMedia = (q) => ({
        matches: false, media: q, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
      });
      window.addEventListener("error", (e) =>
        errors.push("window.error: " + (e.error ? e.error.stack : e.message)));
      window.addEventListener("unhandledrejection", (e) =>
        errors.push("unhandledrejection: " + e.reason));
    },
  });
  const { window } = dom;
  const doc = window.document;

  await sleep(2000);
  console.log("-- boot --");
  check("no script errors during boot", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log("-- shell is intentionally Chinese and must be untouched (ADR-0017 D1) --");
  for (const label of ["\u9a7e\u9a76\u8231 Cockpit", "\u8bc1\u8f68 ProveTrack",
                       "\u5bf9\u8bdd Chat", "\u68c0\u5b9a\u53f0 Flows"]) {
    check(`shell button label ${JSON.stringify(label)}`,
      html.includes(label) || doc.body.textContent.includes(label));
  }
  check("shell footer still present", doc.querySelector(".foot") !== null);
  check("shell CJK > 0 (i.e. not accidentally anglicised)",
    cjkCount(doc.body.textContent) > 0, `cjk=${cjkCount(doc.body.textContent)}`);

  /* N-001（钻石）：**存在唯一主视图**，其余是辅助、不得与主平级。
   * 可检查的那一半是结构：辅助面住在侧板里，主面不在。改之前四个 `#view-*` 是
   * 四个并列的兄弟，各自一个等权按钮。 */
  console.log("-- N-001: one main surface, the rest are panels --");
  {
    check("the main surface is the conversation (N-001)",
      !!doc.querySelector("#uxMainBody #view-chat"), "chat lives in the main body");
    check("no auxiliary surface is a peer of the main one (N-001)",
      AUX.every((v) => { const el = doc.getElementById("view-" + v); return !!el && !!el.closest("#uxPanel"); }),
      AUX.map((v) => { const el = doc.getElementById("view-" + v);
        return v + "=" + (!el ? "missing" : (el.closest("#uxPanel") ? "panel" : "PEER")); }).join(" "));
    check("auxiliaries have toggles; none of them has a main-view button (N-001)",
      AUX.every((v) => !!doc.getElementById("p-" + v)) && !AUX.some((v) => !!doc.getElementById("v-" + v)),
      AUX.map((v) => "p-" + v).join(","));

    for (const v of AUX) {
      const btn = doc.getElementById("p-" + v);
      if (!btn) continue;
      const before = errors.length;
      const histBefore = window.history.length;
      btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await sleep(v === "flows" || v === "prove-track" ? 1400 : 800);
      const el = doc.getElementById("view-" + v);
      check(`opening ${v} shows its panel`, !!el && !el.hasAttribute("hidden"),
        el ? "hidden=" + el.hasAttribute("hidden") : "missing");
      check(`opening ${v} does not replace the main surface (N-001)`,
        !!doc.querySelector("#uxMainBody #view-chat"), "chat still in the main body");
      check(`the hash names the open panel after ${v} (N-009)`,
        window.CxNormalize.parseHash(window.location.hash).panel === v,
        window.location.hash);
      check(`opening ${v} pushed a history entry (N-005)`,
        window.history.length > histBefore, histBefore + " -> " + window.history.length);
      check(`${v} rendered content`, !!el && el.textContent.trim().length > 20,
        el ? el.textContent.trim().length + " chars" : "n/a");
      check(`no errors raised by opening ${v}`, errors.length === before,
        errors.slice(before, before + 2).join(" | "));
      btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));   /* 收起 */
      await sleep(400);
      check(`closing ${v} hides its panel`, !!el && el.hasAttribute("hidden"),
        el ? "hidden=" + el.hasAttribute("hidden") : "missing");
    }
  }

  /* ---- the trajectory opened ON ITS OWN ---------------------------------
   *
   * The criterion: opening the trajectory without going through the
   * conversation shows the WHOLE chain, not one period. The expected number is
   * recomputed by this test from the API — the app's own count would agree with
   * itself, which is the shape of every false green this project has found.
   */
  console.log("-- prove-track: opened on its own, with no period chosen --");
  {
    /* N-001：'自己打开' 现在就是打开证轨**侧板**（不再是切到一个平级的视图）。 */
    const ptBtn = doc.getElementById("p-prove-track");
    if (ptBtn) { ptBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await sleep(1800); }
    /* The chain logic, run here rather than asked for: the same public
     * functions the panel uses, on the same API, in this process. */
    let expect = null;
    try {
      const prevWindow = global.window;
      global.window = {};
      for (const f of ["event_family.js", "period_normalize.js", "node_shape.js",
                       "assembly.js", "prove_track.data.js", "prove_track.render.js",
                       "prove_track.node.js"]) {
        const src = require("fs").readFileSync(require("path").join(__dirname, "..", "assets", f), "utf8");
        (0, eval)(src);
      }
      const EFX = global.window.CxEventFamily, NORMX = global.window.CxNormalize;
      const RX = global.window.CxProveTrack.render;
      const list = ((await (await fetch(BASE + "/api/sessions?limit=500")).json()).periods) || [];
      const start = list[0] && list[0].job_id;
      const ids = start ? NORMX.chainJobIds(list, start) : [];
      const byJob = {};
      for (const id of ids) {
        const j = await (await fetch(BASE + "/api/events?job_id=" + encodeURIComponent(id))).json();
        byJob[id] = (j && j.events) || [];
      }
      const merged = NORMX.mergeChain(byJob, ids);
      const drawn = merged.events.filter((e) => {
        const k = EFX.KIND_OF[e.type];
        return !!k && !!RX.SUMMARY[k];
      }).length;
      expect = { periods: ids.length, drawn: drawn, rows: drawn + ids.length,
                 metering: merged.events.filter((e) => EFX.KIND_OF[e.type] === "metering").length };
      global.window = prevWindow;
    } catch (e) {
      check("the expected chain could be recomputed independently", false, e.message);
    }

    /* The rows arrive when the tape publishes; wait rather than assume. */
    const rowsNow = () => doc.querySelectorAll("#eTbody tr.ev[data-e-ev]").length;
    const headsNow = () => doc.querySelectorAll("#eTbody [data-e-turntoggle]").length;
    for (let i = 0; i < 20 && !rowsNow(); i++) { await sleep(250); }

    if (!expect || !expect.periods) {
      skip("the trajectory opened on its own", "this panel has no period to chain");
    } else {
      console.log("     expected: " + expect.rows + " rows (" + expect.drawn +
        " drawn + " + expect.periods + " turn headers), " + expect.metering + " metering events not drawn");
      check("opening the trajectory alone shows the whole chain",
        rowsNow() + headsNow() === expect.rows,
        rowsNow() + " rows + " + headsNow() + " headers vs " + expect.rows);
      check("every period of the chain has a turn header",
        headsNow() === expect.periods,
        headsNow() + " vs " + expect.periods);

      const headText = Array.from(doc.querySelectorAll("#eTbody [data-e-turntoggle]"))
        .map((b) => b.textContent).join(" | ");
      check("a turn header names the period it came from",
        headText.includes(expect.periods > 1 ? expect.periods.toString() : "") &&
          /run-[0-9a-f]{8,}/.test(headText),
        headText.slice(0, 100));

      const chips = Array.from(doc.querySelectorAll("#eTbody span.e-ty")).map((s) => s.textContent);
      check("metering is not drawn as a row", !chips.includes("USAGE"),
        JSON.stringify(Array.from(new Set(chips))));

      /* 导出的可追溯性: every row can be traced back to a line of a file. */
      const ids2 = Array.from(doc.querySelectorAll("#eTbody tr.ev[data-e-ev]"))
        .map((r) => r.getAttribute("data-e-ev"));
      check("every row is traceable to a source file and line",
        ids2.length > 0 && ids2.every((v) => /^run-[0-9a-f]+#\d+$/.test(v)),
        JSON.stringify(ids2.slice(0, 2)));
    }
  }

  /* ---- `hidden` 必须真的藏起来 -------------------------------------------
   *
   * 这一条是真 Chrome 抓出来的：证书打开时 `#eTblVp` 带着 `hidden` 仍在渲染
   * ——`display:flex` 是作者样式，静静压过浏览器默认的 `[hidden]{display:none}`
   * ——于是表格继续占着 424px，把证书挤成 66px 加一条内部滚动条。那是把"结论 +
   * 悬空引用一眼可读"的视图变成只能看见三行。
   *
   * jsdom 没有布局，但它算得出 `display`，这足以区分"藏了"和"还在占位"。
   * 三个判据必须一起成立，否则任何一条都能空转：切换真的发生了（两个元素的
   * display 互换）、带 `hidden` 的元素是 none、不带 `hidden` 的元素不是 none。 */
  {
    /* 先选一个真实 period：`renderCertificate(null)` 走的是空态分支，那样这条断言
     * 测的就只是空盒子，而不是证书真正占的那块地方。 */
    const first = doc.querySelector("#s-side .ses-item");
    if (first) { first.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await sleep(1200); }
    const tgl = doc.getElementById("eCertBtn");
    const shown = (id) => window.getComputedStyle(doc.getElementById(id)).display;
    const tblOn = () => doc.getElementById("eTblVp").hasAttribute("hidden");
    const tglOn = () => tgl.getAttribute("aria-pressed") === "true";
    /* 按钮是 toggle，所以从当前真实状态出发，不预设它在哪一边。 */
    if (tblOn()) { tgl.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await sleep(300); }
    const wasPressed = tglOn();
    tgl.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(300);
    const tblCert = { has: tblOn(), disp: shown("eTblVp") };
    const certCert = { has: doc.getElementById("eCert").hasAttribute("hidden"), disp: shown("eCert") };
    check("opening the certificate really trades one pane for the other",
      tblCert.has && tblCert.disp === "none" && !certCert.has && certCert.disp !== "none",
      "table hidden=" + tblCert.has + " display=" + tblCert.disp +
      " | cert hidden=" + certCert.has + " display=" + certCert.disp);
    check("a pane carrying `hidden` is hidden, not merely covered",
      tblCert.has && tblCert.disp === "none",
      "table display=" + tblCert.disp + " (作者 display 压过 [hidden] 时这里会是 flex)");
    check("and the toggle says which projection is on",
      tglOn() !== wasPressed && tglOn(),
      "aria-pressed " + wasPressed + " -> " + tglOn());
    tgl.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(300);
    check("and switching back restores the timeline with both panes named correctly",
      !tblOn() && shown("eTblVp") !== "none" && doc.getElementById("eCert").hasAttribute("hidden") &&
        shown("eCert") === "none",
      "table display=" + shown("eTblVp") + " cert display=" + shown("eCert"));
  }

  /* ---- 热区尺寸取自令牌，而不是各处各自的常数 -----------------------------
   *
   * P-010 的下界来自 8–10mm 指尖：`constraints.md` 写"热区最小尺寸 ≥ 44px"，令牌集
   * 里就是 `--hit-min:44px`。此前证轨的按钮与搜索框各自写着 36px，而同一份样式表下方
   * 的粗指针媒体查询又给 44px——同一个控件因触达方式不同而两种尺寸，且桌面那档更小。
   * 这条断言钉住"按令牌取"，而不是钉住某个数字：令牌改了，这里跟着改，不会有人偷偷
   * 把 36 写回来。 */
  {
    const btn = doc.querySelector("#view-prove-track .e-btn");
    const inp = doc.querySelector("#view-prove-track .e-search input");
    const minH = (el) => (el ? window.getComputedStyle(el).minHeight : "");
    const oneOf = (v) => v === "44px" || v === "var(--hit-min)";
    check("the toolbar's hit targets are sized by the design token, not by a local constant",
      !!btn && !!inp && oneOf(minH(btn)) && oneOf(minH(inp)),
      "button=" + minH(btn) + " input=" + minH(inp) +
      "（期望 44px 或 var(--hit-min)；写死 36px 时这里会报出来）");
  }

  console.log("-- prove-track: drive the real period-row path --");
  const items = Array.from(doc.querySelectorAll("#s-side .ses-item"));
  if (items.length && JOB) {
    const KEY = JOB.slice(0, 12); // session.html renders job_id.slice(0, 12)
    const row = items.find((el) => el.textContent.includes(KEY)) || items[0];
    const before = errors.length;

    /* N-001 + N-015：点一张卡只剩一个答案（载进对话）。证轨侧板若开着，它**跟着
     * period 走**——那是 shell 的 period 通知在做的事，不是第二个点卡入口。
     * （P3a 那个显式模式开关已被 N-001 取代：辅助面有自己的开关，留着模式开关就是
     * 同一件事的第二个入口。） */
    check("the sidebar has no second entry for opening the trajectory (N-015)",
      !Array.from(doc.querySelectorAll("#s-side button")).some((b) => b.getAttribute("data-panel")),
      "no data-panel control inside the list");
    row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(1800);
    const view = doc.getElementById("view-prove-track");
    check("the open 证轨 panel follows the row click", view && !view.hasAttribute("hidden"));
    check("prove-track rendered real content", view && view.textContent.trim().length > 200,
      view ? view.textContent.trim().length + " chars" : "n/a");
    /* 容器真的亮着，不只是"DOM 里有字"。
     *
     * 这条是被真 Chrome 抓出来的：切到证轨视图时 #eTbody 已有 7 行，而 #eTraj
     * 是 display:none、宽 0 高 0——界面看上去一片空。**textContent 看不见这件事**：
     * display:none 的子元素照样有文字，所以上面那条"rendered real content"一直
     * 是绿的。style.display 在 jsdom 里是可测的，所以这一条补得住那道缝。 */
    check("the trajectory container is shown, not merely populated",
      doc.getElementById("eTraj").style.display !== "none",
      'display=' + JSON.stringify(doc.getElementById("eTraj").style.display) +
      " rows=" + doc.querySelectorAll("#eTbody tr.ev[data-e-ev]").length);
    check("no errors from the row click", errors.length === before,
      errors.slice(before).join(" | "));

    /* 选择变化不得重建你正在选择的那个集合（人报的 bug）。
     *
     * Measured before the fix: clicking one card issued TWO more
     * `/api/sessions` calls and replaced the sidebar's innerHTML wholesale — in a
     * real browser that resets the list's scroll and throws the card you just
     * clicked out of view ("不知道点了哪张卡了"). The cause was the shell
     * re-running the view's ENTER hook on every period change, so the fetch that
     * belongs to "entering a view" fired on every click.
     *
     * jsdom has no layout, so it cannot see the scroll reset itself. It CAN see
     * the cause — the extra fetch and the rebuilt nodes — which is why this
     * asserts those and not a scrollTop. */
    const nodesBefore = Array.from(doc.querySelectorAll("#s-side .ses-item"));
    const stamped = nodesBefore[nodesBefore.length - 1];
    if (stamped) stamped.setAttribute("data-observed", "1");
    const fetchBefore = sessionFetches;
    const row2 = nodesBefore.find((el) => el.textContent.includes(KEY)) || nodesBefore[0];
    if (row2) row2.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(700);
    check("clicking a card does not re-fetch the period list",
      sessionFetches === fetchBefore, "+" + (sessionFetches - fetchBefore) + " /api/sessions");
    const survivor = Array.from(doc.querySelectorAll("#s-side .ses-item"))
      .find((el) => el.getAttribute("data-observed") === "1");
    check("clicking a card does not rebuild the list rows",
      !!survivor, survivor ? "the marked row survived" : "the rows were replaced");
    const selNow = Array.from(doc.querySelectorAll("#s-side .ses-item"))
      .filter((el) => el.className.split(" ").indexOf("sel") >= 0);
    check("the highlight still lands on exactly one row", selNow.length === 1,
      selNow.length + " marked");
    check("the selection is discernible without colour (N-019)",
      selNow.length === 1 && selNow[0].getAttribute("aria-current") === "true",
      selNow.length ? String(selNow[0].getAttribute("aria-current")) : "none");

    /* N-004 is a DIAMOND: the current period must be visibly marked. It was
     * violated in the trajectory sidebar before P3a — the old expression made
     * `sel` false whenever that container rendered, so the row you had just
     * chosen carried no marker at all. P3b then removed the duplication itself:
     * there is ONE list now, so this asserts the mark AND that no second copy
     * exists — "marked in one of the two lists" is exactly the state that
     * shipped, and it cannot ship again if there is only one list. */
    const marked = (host) => Array.from(doc.querySelectorAll(host + " .ses-item"))
      .filter((el) => el.className.split(" ").indexOf("sel") >= 0).length;
    check("the chosen period is marked in the sidebar (N-004)",
      marked("#s-side") === 1, marked("#s-side") + " marked");
    check("the period list exists exactly once in the document (N-015)",
      doc.querySelectorAll(".ses-side").length === 1,
      doc.querySelectorAll(".ses-side").length + " list container(s)");

    // Chrome-only scope: conversation payloads legitimately carry CJK.
    const chromeText = [
      doc.getElementById("eStats"), doc.querySelector("#eTblVp thead"),
      doc.getElementById("eOvNote"), ...Array.from(doc.querySelectorAll(".e-trk-nm")),
    ].map((e) => (e ? e.textContent : "")).join(" | ");
    check("prove-track chrome CJK == 0", cjkCount(chromeText) === 0,
      `cjk=${cjkCount(chromeText)}`);
    for (const l of ["TOKENS", "CACHE HIT", "INPUT TOK", "LLM TIME", "TOOL TIME"]) {
      check(`chrome shows ${l}`, chromeText.includes(l));
    }
  } else if (!JOB) {
    // K12 (2026-09-15): the recorded "4 failures" were this. Rewording the
    // message did not close anything — an unattended run stayed red. With no
    // period in the panel there is nothing to drive, so this is a skip.
    skip("sidebar rows available to drive prove-track", "no period in this panel");
  } else {
    check("sidebar rows available to drive prove-track", false, `${items.length} rows`);
  }

  console.log("-- inspector path --");
  const rows = Array.from(doc.querySelectorAll("#eTbody tr.ev[data-e-ev]"))
    .filter((r) => !r.classList.contains("e-reply"));
  if (JOB) {
    check("event rows rendered", rows.length > 0, rows.length + " rows");
  } else {
    skip("event rows rendered", "no period in this panel");
  }
  const insp = doc.getElementById("eInsp");
  const inspOn = () => insp.classList.contains("on");
  const dtText = () =>
    Array.from(insp.querySelectorAll("dt")).map((d) => d.textContent).join(" | ");
  const closeInsp = () => {
    const x = doc.getElementById("eInspX");
    if (x) x.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  };
  const ariaExpanded = () => {
    const t = doc.querySelector("[data-e-turntoggle]");
    return t ? t.getAttribute("aria-expanded") : null;
  };

  if (rows.length) {
    // Regression net for the dataset-key defect (markup carries data-e-ev, so
    // the control layer must read dataset.eEv — `dataset.ev` is undefined).
    const before = errors.length;
    rows[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(400);
    check("click event row opens the inspector", inspOn(), "on=" + inspOn());
    // Derived, not hardcoded: every field label must be ASCII letters/spaces,
    // so any non-English (or unexpected) label fails without pinning a vocabulary.
    const labels = Array.from(insp.querySelectorAll("dt")).map((d) => d.textContent);
    check("every inspector field label is ASCII-only",
      labels.length > 0 && labels.every((l) => /^[A-Za-z][A-Za-z ]*$/.test(l)),
      labels.join(" | "));
    check("inspector shows the core field labels",
      ["Type", "Status", "Turn", "Duration", "Share", "Tokens"]
        .every((l) => labels.includes(l)), labels.join(" | "));
    check("inspector field labels CJK == 0", cjkCount(dtText()) === 0);
    check("no errors from the row click", errors.length === before,
      errors.slice(before).join(" | "));
    closeInsp();
    await sleep(300);
    check("inspector closes via #eInspX", !inspOn());

    // Optional branch: a TOOL row must additionally surface the Tool field.
    // Re-query: closing the inspector restores focus and may re-render the table,
    // which would leave a previously captured row detached (clicks on detached
    // nodes never bubble to the document-level delegate).
    const toolRow = Array.from(doc.querySelectorAll("#eTbody tr.ev[data-e-ev]"))
      .find((r) => /^TOOL/.test(r.textContent.trim()));
    if (toolRow) {
      toolRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await sleep(400);
      const tl = Array.from(insp.querySelectorAll("dt")).map((d) => d.textContent);
      check("TOOL row surfaces the optional Tool field", tl.includes("Tool"), tl.join(" | "));
      closeInsp();
      await sleep(300);
    } else {
      // Same class as K12: the panel is fine, this period simply has no tool
    // call to exercise. A red run for absent data trains people to ignore red.
    skip("a TOOL row exists to exercise the optional field",
      JOB ? "this period has no TOOL row" : "no period in this panel");
    }
  }

  const blk = doc.querySelector("#view-prove-track .e-blk[data-e-ev]");
  if (blk) {
    blk.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(400);
    check("click lane block opens the inspector", inspOn(), "on=" + inspOn());
    closeInsp();
    await sleep(300);
  } else {
    skip("a lane block exists to click", JOB ? "no lane block rendered" : "no period in this panel");
  }

  const tg = doc.querySelector("[data-e-turntoggle]");
  if (tg) {
    const b = ariaExpanded();
    tg.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(400);
    check("in-table turn toggle flips aria-expanded", b !== ariaExpanded(),
      b + " -> " + ariaExpanded());
  } else {
    skip("an in-table turn toggle exists", JOB ? "no turn toggle rendered" : "no period in this panel");
  }

  /* ---- N2: the address bar IS the selection state (ADR-0022) -------------
   *
   * N-003 one current view + period; N-009 the hash expresses it and round-trips;
   * N-005 Back still works; N-010 a hash the panel did not write still renders.
   * None of the four is visible in the source, so all four are driven here.
   */
  console.log("-- navigation state is the address bar (N-003 / N-005 / N-009 / N-010) --");
  {
    const NAV = () => window.Cx && window.Cx.state && window.Cx.state.nav;
    const parsed = () => window.CxNormalize.parseHash(window.location.hash);
    /* N-001 之后辅助面用 `hidden` 属性控制（它们不再靠内联 display 藏）。 */
    const shown = () => VIEWS.filter((v) => {
      const el = doc.getElementById("view-" + v);
      return el && !el.hasAttribute("hidden") && el.style.display !== "none";
    });

    check("the shell exposes exactly one selection state", !!NAV(), JSON.stringify(NAV()));

    /* 前面的段落把证轨侧板留在了开着的位置；先收起，下面的步骤才是绝对断言。 */
    {
      const x = doc.getElementById("uxPanelX");
      if (x && NAV().panel) { x.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await sleep(400); }
    }

    /* N-001 之后位置状态有三种变化：period（同一面内换一段）、panel（开/收辅助面）、
     * view（回到主面并收起辅助面）。三种都走同一个写者，也都要在 hash 里往返一致。 */
    const roundTrips = () =>
      JSON.stringify(parsed()) ===
      JSON.stringify({ view: NAV().view, period: NAV().period, panel: NAV().panel });
    const steps = [
      ["opening the 证轨 panel", "p-prove-track", (n) => n.panel === "prove-track"],
      ["closing it again", "p-prove-track", (n) => n.panel === null],
      ["opening the 驾驶舱 panel", "p-cockpit", (n) => n.panel === "cockpit"],
      ["returning to the main surface", "v-chat", (n) => n.panel === null && n.view === "chat"]
    ];
    for (const [label, id, expect] of steps) {
      const btn = doc.getElementById(id);
      const before = errors.length;
      const histBefore = window.history.length;
      if (!btn) { check(`a control for ${label}`, false); continue; }
      btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await sleep(700);
      check(`${label} lands in the one state (N-003)`, !!NAV() && expect(NAV()), JSON.stringify(NAV()));
      check(`the hash round-trips after ${label} (N-009)`, roundTrips(),
        JSON.stringify(window.location.hash) + " vs " + JSON.stringify(NAV()));
      check(`${label} pushed one history entry (N-005)`,
        window.history.length > histBefore, histBefore + " -> " + window.history.length);
      check(`no errors while ${label}`, errors.length === before,
        errors.slice(before, before + 2).join(" | "));
    }
    /* 主面永远是对话：没有任何一步把它换掉（N-001）。 */
    check("the main surface is still the conversation after all of that (N-001)",
      !!doc.querySelector("#uxMainBody #view-chat") && NAV().view === "chat", JSON.stringify(NAV()));
    void shown;

    /* The period cache must describe the period in the state, or not exist.
     *
     * Compares `period_id`, not `job_id`. `NAV().period` is the period id
     * (`session_list.js` sets `period: p.period_id`), while the meta object
     * carries BOTH ids because the export names its download after the job. The
     * first version compared `meta.job_id` against `NAV().period`, which is a job
     * against a period: the two disagree by construction, so the assertion could
     * never pass — a criterion pointed at the wrong field, which is the same
     * shape this project has now recorded seven times. Measured red with the real
     * values: `{"job_id":"run-fcc5d8141bd5a90c","period_id":"run-fcc5d8141bd5a90c-p006ab0c50700000e"}
     * vs period=run-fcc5d8141bd5a90c-p006ab0c50700000e`.
     *
     * The intent — the cached metadata must not describe a DIFFERENT period — is
     * kept exactly; only the field it reads is corrected. */
    check("the trajectory metadata cannot describe a different period (N-003)",
      !window.__proveTrackMeta || window.__proveTrackMeta.period_id === NAV().period,
      JSON.stringify(window.__proveTrackMeta) + " vs period=" + NAV().period);

    /* N-010: a hash the panel did not write. The malformed percent-encoding has
     * to sit in a VALUE — `#view=%C3%28` — not in a key-less fragment. Measured:
     * with the malformed bytes in a fragment that has no `=`, the parser skips
     * the pair before it ever decodes it, so the check passed even against a
     * parser mutated to rethrow. A test that cannot fail is not coverage. */
    const before10 = errors.length;
    window.location.hash = "#view=%C3%28";
    await sleep(700);
    check("a malformed hash raises no script errors (N-010)", errors.length === before10,
      errors.slice(before10, before10 + 2).join(" | "));
    check("a malformed hash still renders exactly one view (N-010)",
      shown().length === 1 && doc.body.textContent.trim().length > 0,
      shown().join(",") || "none");
    check("a malformed hash leaves an empty state, not a stale one (N-010)",
      NAV() && NAV().period === null && !!NAV().view, JSON.stringify(NAV()));
  }

  /* ---- the hint travels with the trajectory it explains -------------------
   *
   * Measured before this: `#eHint` carried TWO `style` attributes. The HTML
   * parser keeps the first and drops the second, so `display:none` was lost and
   * the EMPTY state invited the reader to "click any row" when there was no
   * table at all — a lie in the one place a confused user looks. The markup is
   * fixed and the three sites that show/hide the trajectory now move both
   * through one helper; this checks both halves of that.
   */
  console.log("-- the hint and the trajectory it explains move together --");
  {
    const tag = (html.match(/<p[^>]*id="eHint"[^>]*>/) || [""])[0];
    const styles = (tag.match(/style=/g) || []).length;
    check("the hint's markup carries one style attribute, not two",
      styles === 1, styles + " in: " + tag.slice(0, 90));
    const traj = doc.getElementById("eTraj");
    const hint = doc.getElementById("eHint");
    const vis = (el) => !!el && el.style.display !== "none";
    const beforeHint = errors.length;
    check("with a period loaded, the hint is visible",
      vis(traj) && vis(hint),
      "traj=" + (traj && traj.style.display) + " hint=" + (hint && hint.style.display));
    window.__proveTrackClear();
    await sleep(200);
    check("clearing the trajectory hides the hint too",
      !vis(traj) && !vis(hint),
      "traj=" + (traj && traj.style.display) + " hint=" + (hint && hint.style.display));
    check("no errors from clearing the trajectory", errors.length === beforeHint,
      errors.slice(beforeHint, beforeHint + 2).join(" | "));
  }

  /* ---- P1b: the empty/loading slots come from the exit layer --------------
   *
   * Before P1b the metering desk wrote its own sentence into each slot and
   * offered nothing to do about it. Now every one of those slots is produced by
   * `CxWayout`, carries `data-wo-kind`, and — if it reports a problem — carries
   * a way out (N-011). Checked on the live page rather than the source, because
   * "the code calls the resolver" and "the pixel shows a way out" are different
   * claims and only the second one is the constraint.
   */
  console.log("-- the exit layer is what fills the empty slots (ADR-0044 P1b) --");
  {
    const desk = doc.getElementById("view-flows");
    /* `div` + hasAttribute rather than an attribute selector: the DOM-contract
     * scanner reads querySelector strings and would file `[data-wo-kind]` as a
     * name the page declares somewhere, which it does not. */
    const blocks = Array.from(desk.querySelectorAll("div"))
      .filter((el) => el.hasAttribute("data-wo-kind"));
    check("the desk's empty slots are produced by the exit layer", blocks.length > 0,
      blocks.length + " block(s)");
    const dead = blocks.filter((b) => {
      const k = b.getAttribute("data-wo-kind");
      /* An exit is either a control or a note. Both count: "用 --tuck-endpoint
       * 指定" tells you exactly what to do, and it is what the exit layer
       * renders when it has the words but no capability to run. A BUTTON there
       * would be a control that does nothing. */
      const hasExit = !!b.querySelector("button") ||
        Array.from(b.querySelectorAll("span")).some((s) => s.getAttribute("data-wo-act"));
      return (k === "error" || k === "blocked") && !hasExit;
    });
    check("no problem slot on the desk is a dead end (N-011)", dead.length === 0,
      dead.map((b) => b.getAttribute("data-wo-code")).join(", "));
    check("every exit-layer block carries the code it resolved",
      blocks.every((b) => !!b.getAttribute("data-wo-code")),
      blocks.map((b) => b.getAttribute("data-wo-code")).join(", "));
    console.log("        slots: " +
      blocks.map((b) => b.getAttribute("data-wo-kind") + "/" + b.getAttribute("data-wo-code")).join(" · "));
  }

  /* ---- P1c: a dead backend still offers a way out (N-011) ----------------
   *
   * Every fetch fails. Before P1c the panel reported each failure as a sentence
   * and stopped there; the raw exception WAS the message. Now each failure
   * carries an exit, and the sentence never contains the raw text — which is
   * kept, but behind a disclosure (ADR-0044 D3). This is what makes N-011
   * falsifiable instead of aspirational: "no failure state is a dead end" is
   * checked against a page that is failing in every direction at once.
   */
  console.log("-- a dead backend still offers a way out (ADR-0044 P1c) --");
  {
    const errs3 = [];
    const vc3 = new VirtualConsole();
    vc3.on("jsdomError", (e) => noteError(errs3, "jsdomError: " + e.message));
    vc3.on("error", (...a) => noteError(errs3, "console.error: " + a.join(" ")));
    const dom3 = new JSDOM(html, {
      url: BASE + "/", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc3,
      beforeParse(w) {
        w.fetch = () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:50061"));
        w.matchMedia = (q) => ({
          matches: false, media: q, onchange: null,
          addListener() {}, removeListener() {},
          addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
        });
        w.addEventListener("error", (e) => errs3.push("window.error: " + e.message));
      },
    });
    await sleep(2000);
    const doc3 = dom3.window.document;
    const marks = Array.from(doc3.querySelectorAll("span,div"))
      .filter((el) => el.getAttribute && el.getAttribute("data-wo-kind") === "error");
    check("a dead backend still produces exit-layer states", marks.length > 0,
      marks.length + " state(s)");
    const dead = marks.filter((m) => !m.querySelector("button") &&
      !Array.from(m.querySelectorAll("span")).some((s) => s.getAttribute("data-wo-act")));
    check("no failure state on a dead backend is a dead end (N-011)", dead.length === 0,
      dead.map((m) => m.getAttribute("data-wo-code")).join(", "));
    /* Tighter than "has some exit": the period list's retry is a function the
     * panel is holding right there, so this surface must offer a real control.
     * A note saying "（重试拉取）" would be words without a way to act on them —
     * which is what a missing site capability degrades to, and why this asserts
     * the button rather than mere non-emptiness. */
    const listFail = marks.find((m) => m.getAttribute("data-wo-code") === "sessions-fetch-failed");
    check("the period-list failure offers a real retry, not just words (N-011)",
      !!listFail && !!listFail.querySelector("button"),
      listFail ? listFail.textContent.trim().slice(0, 60) : "no state");
    const sentences = marks.map((m) => {
      const s = m.querySelector("p") || m.querySelector("span");
      return s ? s.textContent : "";
    });
    check("no sentence pastes the raw exception (D3)",
      sentences.every((s) => s.indexOf("ECONNREFUSED") < 0),
      (sentences[0] || "").slice(0, 70));
    check("the raw exception is kept, not dropped (D3)",
      doc3.body.textContent.indexOf("ECONNREFUSED") >= 0);
    console.log("        states: " +
      marks.map((m) => m.getAttribute("data-wo-kind") + "/" + m.getAttribute("data-wo-code")).join(" · "));

    /* P1c-2: a failed send offers the retry that the cleared input cannot.
     * The input is emptied when a message is sent, so without this row the
     * message is still on screen but there is nothing left to act on — which is
     * what the 5-second toast used to paper over. */
    const input3 = doc3.getElementById("chat-text");
    const msgs3 = doc3.getElementById("chat-msgs");
    input3.value = "这句话发不出去";
    dom3.window.sendChat();
    await sleep(700);
    const fail3 = () => Array.from(msgs3.querySelectorAll("div"))
      .filter((el) => el.getAttribute("data-wo-code") === "send-failed");
    const first3 = fail3();
    check("a failed send renders its way out in the conversation (N-011)",
      first3.length === 1, first3.length + " row(s)");
    check("that way out is a real control, not just words",
      first3.length === 1 && !!first3[0].querySelector("button"));
    if (first3.length) {
      const retry3 = first3[0].querySelector("button");
      /* Guarded: with the capability removed there is no button, and calling
       * dispatchEvent on null would abort the whole suite — a crash hides every
       * later assertion, which is worse than one clean red. */
      if (retry3) {
        retry3.dispatchEvent(new dom3.window.MouseEvent("click", { bubbles: true }));
        await sleep(700);
      }
    }
    check("retrying replaces the failure row instead of stacking it",
      fail3().length === 1, fail3().length + " row(s) after the retry");
    dom3.window.close();
  }

  /* ---- N-009 the other way: a hash in the URL at boot --------------------
   *
   * The boot path is the one that has to wait for DOMContentLoaded, because the
   * view assets register their enter hooks while the page parses. Nothing else
   * in this file boots the page, so this checks that a restored view is also the
   * one on screen — and that normalising the address bar did not mint a history
   * entry of its own.
   */
  console.log("-- a hash in the URL is restored on boot (N-009) --");
  {
    const errs2 = [];
    const vc2 = new VirtualConsole();
    vc2.on("jsdomError", (e) => noteError(errs2, "jsdomError: " + e.message));
    vc2.on("error", (...a) => noteError(errs2, "console.error: " + a.join(" ")));
    const dom2 = new JSDOM(html, {
      /* N-001 之后，"深链到某个辅助面"的写法是 view=chat&panel=…：主面永远是对话，
         辅助面是它旁边打开的面板。 */
      url: BASE + "/#view=chat&panel=flows", runScripts: "dangerously", pretendToBeVisual: true,
      virtualConsole: vc2,
      beforeParse(w) {
        w.fetch = (input, init) => {
          const url = typeof input === "string" && input.startsWith("/") ? BASE + input : input;
          return fetch(url, init);
        };
        w.matchMedia = (q) => ({
          matches: false, media: q, onchange: null,
          addListener() {}, removeListener() {},
          addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
        });
        w.addEventListener("error", (e) => errs2.push("window.error: " + e.message));
        w.addEventListener("unhandledrejection", (e) => errs2.push("unhandledrejection: " + e.reason));
      },
    });
    await sleep(2000);
    const doc2 = dom2.window.document;
    const nav2 = dom2.window.Cx && dom2.window.Cx.state.nav;
    /* 辅助面板与主面都从恢复后的页面自己身上取，而不是在这里写死名字。 */
    const panels2 = Array.from(doc2.querySelectorAll("[data-panel]"))
      .map((b) => b.getAttribute("data-panel"));
    const hidden2 = (v) => {
      const el = doc2.getElementById("view-" + v);
      return el ? el.hasAttribute("hidden") : "MISSING";
    };
    check("the hash in the URL is adopted on boot (N-009)",
      nav2 && nav2.view === "chat" && nav2.panel === "flows", JSON.stringify(nav2));
    check("the named panel is open and the main surface is untouched (N-009 / N-001)",
      panels2.indexOf("flows") >= 0 && hidden2("flows") === false &&
        hidden2("chat") === false &&
        panels2.filter((p) => p !== "flows").every((p) => hidden2(p) === true),
      panels2.map((p) => p + " hidden=" + hidden2(p)).join(" ") + " chat hidden=" + hidden2("chat"));
    check("adopting the hash at boot did not push a history entry (N-005)",
      dom2.window.history.length === 1, "history.length=" + dom2.window.history.length);
    check("no errors during a hash-carrying boot", errs2.length === 0, errs2.slice(0, 2).join(" | "));
    dom2.window.close();
  }

  console.log("");
  console.log("RESULT: " + pass + " passed, " + fail + " failed"
  + (skipped ? ", " + skipped + " skipped (nothing to exercise)" : ""));
  if (jsdomGaps) console.log("jsdom gaps (environment, not the page): " + jsdomGaps +
    " — asserted as NOT page errors; see the note where jsdomGaps is defined");
  if (errors.length) console.log("captured errors:\n  " + errors.slice(0, 8).join("\n  "));
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
