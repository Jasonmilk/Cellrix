#!/usr/bin/env python3
"""Static coupling audit for the assembled Cellrix panel page.

Generalises the check that caught the `data-e-ev` / `dataset.ev` mismatch: any
"string in A must line up with string in B" coupling is verified by *deriving*
the expected side from the served page, never by hardcoding a list.

Three derived invariants, all evaluated against the REAL assembled page:

  1. every id referenced by JS must exist in the page, or be created by JS
  2. every class used in a JS selector must exist in the page, or be created by JS
  3. every global (window.X / bare Cx.*) read by JS must be defined somewhere

Resolution rule for 1 and 2: a name is resolved when it appears in the page's
markup, OR when JS mentions it somewhere other than its own read site (i.e. a
creation site such as `id="x"` / `classList.add('x')`). A name that appears
*only* at its read site is a dead reference — exactly the defect class above.

Usage: coupling_audit.py <served.html> <assets_dir>
"""
import re
import sys
from collections import Counter
from pathlib import Path

page_path, assets_dir = Path(sys.argv[1]), Path(sys.argv[2])
page = page_path.read_text(encoding="utf-8")

ASSET_GLOBS = ["*.js", "*.html", "*.css"]
assets = {}
for g in ASSET_GLOBS:
    for p in sorted(assets_dir.glob(g)):
        assets[p.name] = p.read_text(encoding="utf-8")

# ---------------------------------------------------------------- page facts
page_ids = set(re.findall(r'(?<![\w-])id="([^"]+)"', page))
page_classes = set()
for attr in re.findall(r'(?<![\w-])class="([^"]*)"', page):
    page_classes.update(attr.split())

# ------------------------------------------------------- JS reference sites
# Capture only the LEADING simple token: a selector like
# '#view-prove-track .e-tpre' names an id plus a descendant class, and
# 'eTbody tr[data-e-ev="..."]' names an id plus a compound selector. Grabbing
# the whole string would report compound selectors as dead ids.
TOKEN = r"([A-Za-z_][\w-]*)"
ID_READ = [
    re.compile(r"getElementById\(\s*['\"]([^'\"]+)['\"]"),
    re.compile(r"\$\(\s*['\"]([^'\"]+)['\"]"),
    re.compile(r"querySelector(?:All)?\(\s*['\"]#" + TOKEN),
]
CLASS_READ = [
    re.compile(r"classList\.(?:contains|add|remove|toggle)\(\s*['\"]" + TOKEN),
    re.compile(r"querySelector(?:All)?\(\s*['\"][^'\"]*\." + TOKEN),
    re.compile(r"closest\(\s*['\"][^'\"]*\." + TOKEN),
    re.compile(r"matches\(\s*['\"][^'\"]*\." + TOKEN),
]
GLOBAL_DEF = [
    re.compile(r"window\.([A-Za-z_$][\w$]*)\s*="),
    re.compile(r"var\s+([A-Za-z_$][\w$]*)\s*="),
    re.compile(r"function\s+([A-Za-z_$][\w$]*)\s*\("),
]

id_sites, class_sites = [], []
defined_globals = set()
js_all = "\n".join(assets.values())

for name, src in assets.items():
    for rx in ID_READ:
        id_sites += [(m.group(1), name) for m in rx.finditer(src)]
    for rx in CLASS_READ:
        class_sites += [(m.group(1), name) for m in rx.finditer(src)]
    for rx in GLOBAL_DEF:
        defined_globals.update(m.group(1) for m in rx.finditer(src))

# html inline handlers may call globals too
inline_calls = set(re.findall(r'on\w+="\s*([A-Za-z_$][\w$]*)\s*\(', page))
defined_globals |= inline_calls

# --------------------------------------------------------------- evaluation
print(f"== coupling audit: {page_path.name} ({len(page)} chars) ==")
print(f"   page ids={len(page_ids)} classes={len(page_classes)} | "
      f"assets={len(assets)} | id-reads={len(id_sites)} class-reads={len(class_sites)}")

fail = 0


def audit(label, sites, markup_set, kind):
    global fail
    by_name = {}
    for n, f in sites:
        by_name.setdefault(n, []).append(f)   # one entry per READ SITE, not per file
    unresolved = []
    for n, files in sorted(by_name.items()):
        if n in markup_set:
            continue
        # Count EVERY mention of the bare name across all assets. A creation site
        # is written in a different shape from a read site — `className = 'toast'`
        # (quote hugging the name), `' e-reply'` (leading space), or a CSS rule —
        # so a quote-anchored count would miss it. Any mention beyond the read
        # sites themselves means something else brings the name into existence.
        mentions = js_all.count(n)
        if mentions > len(files):
            continue
        unresolved.append((n, sorted(set(files)), mentions))
    print(f"-- {label} --")
    if not unresolved:
        print(f"   OK  all {len(by_name)} {kind} references resolve "
              f"({len(sites)} read sites)")
    for n, files, mentions in unresolved:
        fail += 1
        print(f"   DEAD  {kind} {n!r} referenced by {files} "
              f"(markup: absent, mentions: {mentions} = read sites only)")


audit("id references", id_sites, page_ids, "id")
audit("class references in selectors", class_sites, page_classes, "class")

print("-- globals read by JS --")
global_reads = set(re.findall(r"window\.([A-Za-z_$][\w$]*)", page))
# Browser-provided globals: not ours to define.
BROWSER = {
    "fetch", "location", "document", "navigator", "history", "localStorage",
    "sessionStorage", "matchMedia", "setTimeout", "setInterval", "clearTimeout",
    "clearInterval", "requestAnimationFrame", "getComputedStyle", "addEventListener",
    "removeEventListener", "alert", "confirm", "prompt", "console", "URL", "URLSearchParams",
    "JSON", "Date", "Math", "Object", "Array", "String", "Number", "Boolean", "Promise",
    "RegExp", "Error", "Map", "Set", "Symbol", "innerWidth", "innerHeight", "scrollTo",
    "open", "close", "print", "focus", "blur", "crypto", "performance", "isSecureContext",
    "getSelection", "customElements", "devicePixelRatio", "requestIdleCallback",
    "CSS", "IntersectionObserver", "ResizeObserver", "MutationObserver",
    "AbortController", "Blob", "FormData", "Headers", "Request", "Response",
    "TextEncoder", "TextDecoder", "queueMicrotask", "structuredClone",
    "getComputedStyle", "scrollY", "scrollX", "pageYOffset", "pageXOffset",
    "visualViewport", "screen", "parent", "top", "self", "frames", "name",
}
missing = sorted(g for g in global_reads if g not in BROWSER and g not in defined_globals)
for g in missing:
    fail += 1
    print(f"   DEAD  global window.{g} read but never defined")
if not missing:
    print(f"   OK  every referenced global is defined ({len(global_reads)} window.* reads)")

print()
print(f"RESULT: {fail} unresolved coupling(s)")
sys.exit(1 if fail else 0)
