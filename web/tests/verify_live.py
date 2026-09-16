#!/usr/bin/env python3
"""Live verification of the served Cellrix panel page.

Usage: verify_live.py <served.html> <assets_dir>
Checks that the prove-track assets were burned into the binary at build time
(include_str!) and that the English-only (ADR-0017) text is what the browser gets.
"""
import re
import sys
from pathlib import Path

page_path, assets_dir = sys.argv[1], Path(sys.argv[2])
page = Path(page_path).read_text(encoding="utf-8")
ASSETS = [
    ("prove_track.css", "Cellrix \u00b7 ProveTrack \u2014 style layer (ADR-0016 D1)"),
    ("prove_track.html", "Cellrix \u00b7 ProveTrack \u2014 skeleton layer (ADR-0016 D1)"),
    ("prove_track.data.js", "Cellrix prove-track primitives (ADR-0016 D1/D6)"),
    ("prove_track.render.js", "The trajectory's render tables (Cellrix:ADR-0018 batch 4)"),
    ("prove_track.node.js", "Node-side consumption for the trajectory (Cellrix:ADR-0018 batch 4)"),
    ("prove_track.export.js", "The Markdown projection of the trajectory (ADR-0018: one tape, many targets)"),
    ("prove_track.view.js", "Cellrix ProveTrack view layer (ADR-0016 D1)"),
    ("prove_track.js", "Cellrix ProveTrack control layer (ADR-0016 D1/D3)"),
]
CJK = re.compile(r"[\u4e00-\u9fff]")
ok = fail = 0


def check(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  PASS  {label}" + (f"  [{detail}]" if detail else ""))
    else:
        fail += 1
        print(f"  FAIL  {label}" + (f"  [{detail}]" if detail else ""))


print(f"== served page: {page_path} ({len(page)} bytes) ==")
# A frozen snapshot is a post-JS DOM, so an element whose inline style the app
# set no longer matches its asset and the burn-in check below reads that as a
# broken build. That produced two permanent false failures, which is worse than
# no check: people learn to ignore them. Refuse, and say which file is wanted.
if "OFFLINE SNAPSHOT" in page:
    print("ERROR: this is a frozen post-JS snapshot, not the served page.")
    print("       Burn-in is about what the SERVER returns; the DOM has been")
    print("       mutated since. Use the .raw.html that snapshot.js writes,")
    print("       or: curl -s http://127.0.0.1:18932/ -o page.html")
    raise SystemExit(3)
check("first bytes are <!DOCTYPE html>", page.startswith("<!DOCTYPE html>"),
      page[:15].replace("\n", "\\n"))

print("-- placeholder residue must be zero --")
for ph in ["__TOKENS__", "__COMPONENTS__", "__COCKPIT__", "__CHAT__",
           "__PROVE_TRACK__", "__PROVE_TRACK_CSS__", "__PROVE_TRACK_DATA__",
           "__PROVE_TRACK_RENDER__", "__PROVE_TRACK_NODE__", "__PROVE_TRACK_EXPORT__",
           "__PROVE_TRACK_VIEW__",
           "__PROVE_TRACK_CTRL__", "__SCRIPT__",
           "__SESSION__", "__GLEAM__", "__FLOWS__", "__REFRESH__",
           "__TUCK_CONFIGURED__"]:
    check(f"residue {ph} == 0", page.count(ph) == 0, f"count={page.count(ph)}")

# Each asset is wrapped by a distinct pair of host tags in base.html, so the
# region boundary is looked up explicitly per asset type (a generic fallback
# chain would walk into the next asset and report a false positive).
BOUND = {
    "prove_track.css": ("<style>", "</style>"),
    "prove_track.html": ('<div id="s-main">', "</aside>"),
    "prove_track.data.js": ("<script>", "</script>"),
    "prove_track.render.js": ("<script>", "</script>"),
    "prove_track.node.js": ("<script>", "</script>"),
    "prove_track.export.js": ("<script>", "</script>"),
    "prove_track.view.js": ("<script>", "</script>"),
    "prove_track.js": ("<script>", "</script>"),
}

print("-- asset burn-in: verbatim containment + region CJK == 0 --")
for name, sig in ASSETS:
    text = (assets_dir / name).read_text(encoding="utf-8")
    check(f"{name}: verbatim in page", text in page)
    i = page.find(sig)
    if i < 0:
        check(f"{name}: signature found", False)
        continue
    open_tag, close_tag = BOUND[name]
    start = page.rfind(open_tag, 0, i)
    close = page.find(close_tag, i)
    end = close + len(close_tag) if close >= 0 else -1
    if start < 0 or end <= i:
        check(f"{name}: region located", False, f"start={start} end={end}")
        continue
    region = page[start:end]
    check(f"{name}: region CJK == 0", len(CJK.findall(region)) == 0,
          f"cjk={len(CJK.findall(region))} region={len(region)}B asset={len(text)}B")

print("-- DOM anchors present --")
for a in ['id="view-prove-track"', 'id="eTblVp"', 'id="eLaneInput"', 'id="eInsp"']:
    check(f"anchor {a}", a in page)

print("-- English UI labels present (ADR-0017 D2) --")
for lbl in ["TOKENS", "CACHE HIT", "INPUT TOK", "LLM TIME", "TOOL TIME",
            "Replay", "Collapse all turns", "Expand all calls", "Equal width",
            "OVERVIEW \u00b7 time projection"]:
    check(f"label {lbl!r}", lbl in page)

print("-- old Chinese UI labels must be gone --")
for old in ["LLM \u8017\u65f6", "\u7f13\u5b58\u547d\u4e2d", "\u8f93\u5165 TOK",
            "\u91cd\u653e\u8f68\u8ff9", "\u7b49\u5bbd", "\u5168\u90e8\u6298\u53e0\u8f6e\u6b21",
            "\u5168\u90e8\u5c55\u5f00\u8c03\u7528"]:
    check(f"gone {old!r}", old not in page)

print("-- public interface names unchanged (ADR-0016 D3) --")
for n in ["__proveTrackLoad", "__proveTrackClear", "window.CxProveTrack"]:
    check(f"interface {n}", n in page)

print(f"\nRESULT: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
