# Web asset verification harness

The panel's frontend is not built. `web/assets/*` is assembled at **compile
time**: `web/src/main.rs` reads `base.html`, substitutes each `__PLACEHOLDER__`
with the asset's bytes via `include_str!`, and serves the result. A static diff
plus `cargo test` therefore proves nothing about what a browser actually
receives — the asset is burnt into the binary, and the binary may be older than
the asset.

This directory holds the checks that close that gap. They are co-located with
the artifact they verify on purpose: every script here reads `../assets/*` or
the assembled page served by a running panel.

## Layout

| Script | Proves | Needs the stack |
|---|---|---|
| `verify_live.py <served page> <assets-dir>` | The served page is the current assets, byte for byte: first byte is `<!DOCTYPE html>`, zero placeholder residue, tags balanced, anchor counts, load order strictly increasing, and each asset appears **verbatim** inside its section. **Takes the raw page, not the frozen snapshot** — a frozen file is a post-JS DOM, and an inline style the app set reads as a broken build. It refuses one rather than reporting two permanent failures | no |
| `coupling_audit.py <snapshot> <assets-dir>` | Derived coupling invariants: every `dataset.X` **read** is supplied by some `data-*` attribute or a runtime assignment; placeholder scan is non-vacuous (`checked >= 16`) | no |
| `layout_test.js [panel_url] [cdp_url]` | The transcript's form follows its content: the expanded process row holds its text, and nothing is painted over it. Measures **geometry in a real browser** (jsdom has none) — the only layer that can see this defect: every CSS and DOM check passed while 272px of text sat in a 36px box with the next row on top | yes + Chrome on :9222 |
| `all_views_test.js <base_url> <job_id>` | Real render through a real user path (click a session → switch view → pick a period), then asserts the inspector opens, the turn collapses, and inspector field names are ASCII-only | yes |
| `chat_model_test.js <base_url>` | The live chat names the LLM that served the turn. The SSE transport is stubbed, so this asserts **our** contract, not a vendor's availability. Tests both directions: value present → shown, absent → honestly omitted | yes |
| `render_test.js <base_url>` | Full-view render smoke test | yes |
| `pt_replay.js [events.jsonl]` | The trajectory's Node layer against real event files: the metering aggregate cross-checked against the raw file's own fields, malformed rows refused, and the panes (tool outcome, criterion verdict, gate label) rendered. Picks its fixture by what each block needs | no |
| `snapshot.js <base_url> [job] [out.html]` | Freezes a live page plus its API responses into one self-contained HTML file, **and** writes `<out>.raw.html` — the page exactly as served, which is what `verify_live.py` wants | yes |
| `snapshot_selftest.js <file>` | The snapshot is actually self-contained | no |
| `probe_bug.js` | Minimal reproduction of a reported defect | no |
| `start-panel.sh [port]` / `--stop` | Brings the six-component stack up in dependency order and stops it by PID | — |
| `ab_verify.sh` / `--check` | The binary is newer than every burnt-in asset, and runs the e2e only if it is — a stale binary's result is a result about different code | yes (`--check`: no) |

## Running

```bash
# Non-live checks — no services needed.
python3 web/tests/verify_live.py <served page> web/assets   # e.g. snapshot.html.raw.html

# Live checks — bring the stack up first, then point at it.
./web/tests/start-panel.sh          # tuck -> tentacle -> mind -> flowmodus -> anaphase -> panel
node web/tests/all_views_test.js http://127.0.0.1:18932 <job_id>
./web/tests/start-panel.sh --stop
```

`node` must see `jsdom`. Install it into a managed workspace and point
`NODE_PATH` at it — never `npm install -g`:

```bash
NODE_PATH=/path/to/node/workspace/node_modules node web/tests/render_test.js http://127.0.0.1:18932
```

`jsdom` needs two shims or the page dies during bootstrap: `window.fetch`
(proxy relative paths to the live server) and `window.matchMedia` (the theme
bootstrap in `base.html`).

### The geometry guard needs a browser, and it is only as good as the browser being up

`run_all.js` runs `layout_test.js` whenever a browser answers on `:9222`, and only
then prints it as "needs input". It was previously listed as needing input
**unconditionally**, so the one check that can see layout sat idle while the
panel looked fine — and it was hiding a real defect (the trajectory's container
was `display:none` with seven rows already in it; `textContent` cannot see that,
and jsdom has no layout).

Start one like this before running the net:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=old --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --remote-debugging-port=9222 --user-data-dir=/tmp/cellrix-chrome about:blank &
```

`--headless=new` dies here with `GPU process isn't usable`; the sandboxed profile
also needs `--no-sandbox` (its own sandbox cannot initialise). Override the
endpoint with `CELLRIX_CDP` / the panel with `CELLRIX_PANEL`.

## Method

- **A/B, always.** If the binary's mtime is older than the asset's, it still
  carries the old asset: run the check against it first and expect **failure**.
  That is what proves the check is not vacuous. Then rebuild and run again.
- **Walk the real user path.** Drive the DOM the way a person does — click the
  session in the sidebar, switch the view, pick the period. Calling an internal
  loader directly bypasses the visibility guards and produces false reds.
- **CJK assertions only in the chrome scope.** Event payloads legitimately
  contain the user's own Chinese text; asserting "no CJK" over a whole view
  fails on the data, not on the bug.
- **Stub the transport when a vendor is in the path.** A check whose reliability
  depends on a third party's uptime and a paid key is not a regression net.
- **Never stop services with `pkill -f`.** It matches the whole command line and
  will kill unrelated processes. `start-panel.sh --stop` kills by PID file.

## What is deliberately not here

Runtime output stays outside the repository: the stack's logs go to
`<workspace>/.workbuddy-ai/tools/prove-track-verify/logs/`, and generated
snapshots are not committed. Only the harness itself belongs in the repo.
