/* Build a self-contained offline snapshot of the live Cellrix panel.
 *
 * Loads the LIVE page into jsdom, records every API response the page consumes,
 * drives the real prove-track render path, then serialises the rendered DOM into
 * a single standalone HTML file with the recorded responses stubbed back in.
 * The result opens with zero setup (no Anaphase / Tuck / panel needed) and the
 * inspector still opens on click.
 *
 * Usage: node snapshot.js <panel_base_url> <job_id> <out_html>
 */
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");

const BASE = process.argv[2] || "http://127.0.0.1:18932";
const JOB = process.argv[3] || "";
const OUT = process.argv[4] || "snapshot.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("== building offline snapshot from " + BASE + " ==");
  const captured = {};
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));

  const html = await (await fetch(BASE + "/")).text();
  const dom = new JSDOM(html, {
    url: BASE + "/", runScripts: "dangerously", pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = async (input, init) => {
        const url = typeof input === "string" && input.startsWith("/") ? BASE + input : input;
        const res = await fetch(url, init);
        try {
          const body = await res.clone().text();
          captured[String(input)] = body;
          captured[new URL(url).pathname + new URL(url).search] = body;
        } catch (_) { /* binary or already consumed — skip */ }
        return res;
      };
      window.matchMedia = (q) => ({
        matches: false, media: q, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
      });
      window.addEventListener("error", (e) =>
        errors.push("window.error: " + (e.error ? e.error.message : e.message)));
    },
  });
  const { window } = dom;
  const doc = window.document;

  await sleep(2200);
  console.log("  recorded " + Object.keys(captured).length + " response keys during boot");

  // Drive the real path so the snapshot is not an empty shell.
  const items = Array.from(doc.querySelectorAll("#s-side .ses-item"));
  const row = (JOB && items.find((el) => el.textContent.includes(JOB.slice(0, 12)))) || items[0];
  if (row) {
    row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(2000);
    console.log("  drove period row -> prove-track");
  }
  // Open the inspector once, so the reader can see it immediately.
  const evRow = Array.from(doc.querySelectorAll("#eTbody tr.ev[data-e-ev]"))
    .find((r) => !r.classList.contains("e-reply"));
  if (evRow) {
    evRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(500);
    console.log("  opened the inspector for the first event row");
  }

  const view = doc.getElementById("view-prove-track");
  const rowsN = doc.querySelectorAll("#eTbody tr").length;
  console.log("  prove-track: " + (view ? view.textContent.trim().length : 0) +
    " chars, " + rowsN + " table rows");

  // Serialise, then stub fetch so the page works with no backend at all.
  // Escape `</` so a captured body containing `</script>` cannot close the tag
  // early (data-dependent: fine today, breaks on some future conversation).
  const serialised = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  const capturedJson = JSON.stringify(captured).replace(/<\//g, "<\\/");
  const stub =
    "<script>(function(){\n" +
    "  var CAPTURED = " + capturedJson + ";\n" +
    "  function bodyFor(u){\n" +
    "    if (CAPTURED[u] !== undefined) return CAPTURED[u];\n" +
    "    var p; try { p = new URL(u, location.href).pathname + new URL(u, location.href).search; } catch(e){ p = u; }\n" +
    "    if (CAPTURED[p] !== undefined) return CAPTURED[p];\n" +
    "    for (var k in CAPTURED) { if (p.indexOf(k.split('?')[0]) === 0) return CAPTURED[k]; }\n" +
    "    return null;\n" +
    "  }\n" +
    "  window.fetch = function(input, init){\n" +
    "    var u = String(input);\n" +
    "    var b = bodyFor(u);\n" +
    "    if (b === null) b = '{}';\n" +
    "    return Promise.resolve({\n" +
    "      ok: true, status: 200, body: null,\n" +
    "      text: function(){ return Promise.resolve(b); },\n" +
    "      json: function(){ try { return Promise.resolve(JSON.parse(b)); }\n" +
    "                        catch(e){ return Promise.reject(e); } }\n" +
    "    });\n" +
    "  };\n" +
    "  window.__SNAPSHOT__ = true;\n" +
    "})();<\/script>\n";

  const banner =
    '<div style="position:fixed;left:0;right:0;bottom:0;z-index:99999;' +
    'background:#111;color:#ddd;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'padding:6px 12px;border-top:2px solid #6cf">' +
    'OFFLINE SNAPSHOT &mdash; real rendered output, captured from the live panel. ' +
    'Responses are frozen; clicking an event row opens the inspector.' +
    '</div>\n';

  // Serialising the DOM alone is NOT enough: the view layer keeps its session in
  // module state (S.session), which a fresh page context starts empty — so the
  // pre-rendered rows would render but every click would hit `if (!ev) return`.
  // Re-drive the real load path on boot so state and DOM agree.
  const boot =
    "<script>(function(){\n" +
    "  var KEY = " + JSON.stringify(JOB ? JOB.slice(0, 12) : "") + ";\n" +
    "  function boot(){\n" +
    "    var items = document.querySelectorAll('#s-side .ses-item');\n" +
    "    if (!items.length) { setTimeout(boot, 200); return; }\n" +
    "    var target = null;\n" +
    "    for (var i = 0; i < items.length; i++) {\n" +
    "      if (KEY && items[i].textContent.indexOf(KEY) >= 0) { target = items[i]; break; }\n" +
    "    }\n" +
    "    target = target || items[0];\n" +
    "    if (target) target.click();\n" +
    "  }\n" +
    "  if (document.readyState === 'complete') setTimeout(boot, 150);\n" +
    "  else window.addEventListener('load', function(){ setTimeout(boot, 150); });\n" +
    "})();<\/script>\n";

  const withStub = serialised.replace(/<head([^>]*)>/i, (m, attrs) => "<head" + attrs + ">\n" + stub)
    + banner + boot;
  fs.writeFileSync(OUT, withStub, "utf8");
  /* Also keep the page EXACTLY as served, before any script ran. The frozen
   * file above is a post-JS DOM (serialised after a period was driven), so it
   * is not the artifact to check burn-in against — an element whose inline
   * style the app set differs from the asset, and verify_live reads that as a
   * broken burn-in. Two outputs, two questions, no ambiguity about which is
   * which. */
  fs.writeFileSync(OUT.replace(/\.html$/, '') + ".raw.html", html, "utf8");
  console.log("  captured keys: " + Object.keys(captured).join(", "));
  console.log("  wrote " + OUT + " (" + withStub.length + " chars)");
  if (errors.length) console.log("  captured errors: " + errors.slice(0, 3).join(" | "));
  dom.window.close();
})().catch((e) => { console.error("SNAPSHOT ERROR:", e); process.exit(1); });
