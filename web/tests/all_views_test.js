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
const JOB = process.argv[3] || "";
const VIEWS = ["cockpit", "prove-track", "chat", "flows"];
const CJK = /[\u4e00-\u9fff]/;
const cjkCount = (s) => (s.match(new RegExp(CJK.source, "g")) || []).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(label, cond, detail) {
  const tail = detail ? "  [" + detail + "]" : "";
  if (cond) { pass++; console.log("  PASS  " + label + tail); }
  else { fail++; console.log("  FAIL  " + label + tail); }
}

(async () => {
  console.log("== all-views real render: " + BASE + " ==");

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
  } else {
    check("sidebar rows available to drive prove-track", false, `${items.length} rows`);
  }

  console.log("-- inspector path --");
  const rows = Array.from(doc.querySelectorAll("#eTbody tr.ev[data-e-ev]"))
    .filter((r) => !r.classList.contains("e-reply"));
  check("event rows rendered", rows.length > 0, rows.length + " rows");
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
      check("a TOOL row exists to exercise the optional field", false, "none");
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
    check("a lane block exists to click", false, "none");
  }

  const tg = doc.querySelector("[data-e-turntoggle]");
  if (tg) {
    const b = ariaExpanded();
    tg.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(400);
    check("in-table turn toggle flips aria-expanded", b !== ariaExpanded(),
      b + " -> " + ariaExpanded());
  } else {
    check("an in-table turn toggle exists", false, "none");
  }

  console.log("");
  console.log("RESULT: " + pass + " passed, " + fail + " failed");
  if (errors.length) console.log("captured errors:\n  " + errors.slice(0, 8).join("\n  "));
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
