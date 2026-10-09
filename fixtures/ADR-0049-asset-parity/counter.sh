#!/usr/bin/env bash
# counter.sh — THE NEGATIVE FIXTURE: a CONTENT-PRESERVING change must NOT trip the gate.
#
# WHY THIS FILE EXISTS (human ruling 2026-10-09): a criterion that fires both when the content
# changed AND when it did not is a decoration — V=0 under Ω, 伪证 under G5. `inject.sh` alone only
# proves "the bad thing goes red"; it cannot prove "the good thing stays green". Worse, inject.sh
# appends bytes, which changes content AND mtime — so it would go red under an mtime criterion too
# and could never notice that regression. This fixture changes ONLY the mtime, so a criterion that
# reads the clock is caught here and nowhere else.
#
# Contract: same as inject.sh (§$F is the detection target, nothing is polluted).
set -eu
: "${F:?fixture needs \$F (the asset under test)}"
cp "$F" /tmp/_counter_asset_backup 2>/dev/null || true
# Touch = new mtime, identical bytes. No write to the file.
if touch -t 202001010000 "$F" 2>/dev/null; then :; else touch "$F"; fi
