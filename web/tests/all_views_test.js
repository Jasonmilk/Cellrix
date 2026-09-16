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
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

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

  console.log("-- switch every view through its real toolbar button --");
  for (const v of VIEWS) {
    const btn = doc.getElementById("v-" + v);
    if (!btn) { check(`button #v-${v} exists`, false); continue; }
    const before = errors.length;
    btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(v === "flows" || v === "prove-track" ? 1400 : 800);

    const el = doc.getElementById("view-" + v);
    check(`#view-${v} exists`, el !== null);
    check(`#view-${v} visible after click`, el && el.style.display !== "none",
      'display="' + (el && el.style.display) + '"');
    const others = VIEWS.filter((o) => o !== v)
      .map((o) => doc.getElementById("view-" + o))
      .filter(Boolean);
    check(`all other views hidden while on ${v}`,
      others.every((o) => o.style.display === "none"),
      others.map((o) => o.id + '="' + o.style.display + '"').join(" "));
    check(`#v-${v} marked active`, btn.className.includes("on"), btn.className);
    check(`#view-${v} rendered content`, el && el.textContent.trim().length > 20,
      el ? el.textContent.trim().length + " chars" : "n/a");
    check(`no errors raised by switching to ${v}`, errors.length === before,
      errors.slice(before, before + 2).join(" | "));
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

  console.log("-- prove-track: drive the real period-row path --");
  const items = Array.from(doc.querySelectorAll("#s-side .ses-item"));
  if (items.length && JOB) {
    const KEY = JOB.slice(0, 12); // session.html renders job_id.slice(0, 12)
    const row = items.find((el) => el.textContent.includes(KEY)) || items[0];
    const before = errors.length;
    row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(1800);
    const view = doc.getElementById("view-prove-track");
    check("row click switched to prove-track", view && view.style.display !== "none");
    check("prove-track rendered real content", view && view.textContent.trim().length > 200,
      view ? view.textContent.trim().length + " chars" : "n/a");
    check("no errors from the row click", errors.length === before,
      errors.slice(before).join(" | "));

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
    const shown = () => VIEWS.filter((v) => {
      const el = doc.getElementById("view-" + v);
      return el && el.style.display !== "none";
    });

    check("the shell exposes exactly one selection state", !!NAV(), JSON.stringify(NAV()));

    for (const v of ["chat", "flows", "cockpit"]) {
      const btn = doc.getElementById("v-" + v);
      const before = errors.length;
      const histBefore = window.history.length;
      btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await sleep(800);
      check(`clicking ${v} moves nav.view to ${v} (N-003)`, NAV() && NAV().view === v,
        JSON.stringify(NAV()));
      /* Derived, not counted. The visible set must BE the view we asked for.
       * Expressed as an equality rather than a count against a literal: that
       * shape is exactly what the [ENG] guard (run_all.js) exists to stop, and
       * an equality is stronger anyway — it pins WHICH view, not just how many.
       * The guard flagged the count form on the first run and was right to. */
      check(`after ${v} the visible view is exactly ${v} (N-003)`, shown().join(",") === v,
        shown().join(",") || "none");
      check(`the hash round-trips to the state after ${v} (N-009)`,
        JSON.stringify(parsed()) === JSON.stringify({ view: NAV().view, period: NAV().period }),
        JSON.stringify(window.location.hash) + " vs " + JSON.stringify(NAV()));
      check(`switching view pushed one history entry (N-005)`,
        window.history.length > histBefore, histBefore + " -> " + window.history.length);
      check(`no errors raised by ${v} navigation`, errors.length === before,
        errors.slice(before, before + 2).join(" | "));
    }

    /* The period cache must describe the period in the state, or not exist. */
    check("the trajectory metadata cannot describe a different period (N-003)",
      !window.__proveTrackMeta || window.__proveTrackMeta.job_id === NAV().period,
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
    vc2.on("jsdomError", (e) => errs2.push("jsdomError: " + e.message));
    vc2.on("error", (...a) => errs2.push("console.error: " + a.join(" ")));
    const dom2 = new JSDOM(html, {
      url: BASE + "/#view=flows", runScripts: "dangerously", pretendToBeVisual: true,
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
    /* Derived from the restored page's own nav, so this cannot pass by naming a
     * view list the markup does not have. */
    const views2 = Array.from(doc2.querySelectorAll(".nav [data-view]"))
      .map((b) => b.getAttribute("data-view"));
    const disp2 = (v) => {
      const el = doc2.getElementById("view-" + v);
      return el ? el.style.display : "MISSING";
    };
    check("the hash in the URL is adopted on boot (N-009)",
      nav2 && nav2.view === "flows", JSON.stringify(nav2));
    check("the restored view is the only visible one (N-009)",
      views2.length > 0 && disp2("flows") !== "none" &&
        views2.filter((v) => v !== "flows").every((v) => disp2(v) === "none"),
      views2.map((v) => v + '="' + disp2(v) + '"').join(" "));
    check("adopting the hash at boot did not push a history entry (N-005)",
      dom2.window.history.length === 1, "history.length=" + dom2.window.history.length);
    check("no errors during a hash-carrying boot", errs2.length === 0, errs2.slice(0, 2).join(" | "));
    dom2.window.close();
  }

  console.log("");
  console.log("RESULT: " + pass + " passed, " + fail + " failed"
  + (skipped ? ", " + skipped + " skipped (nothing to exercise)" : ""));
  if (errors.length) console.log("captured errors:\n  " + errors.slice(0, 8).join("\n  "));
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
