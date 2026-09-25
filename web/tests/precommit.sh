#!/bin/sh
# precommit.sh — THE ORDER, MECHANISED (ADR-0048 §84.2).
# Three blind failures in one round (one of them misread EMPTY OUTPUT as success) all
# traced to a hand-run order. This script IS the order: syntax -> gate -> RED PATH ->
# whole gate. Run it before every commit; if any step fails, the commit does not happen.
set -u
cd "$(dirname "$0")"
export NODE_PATH="${NODE_PATH:-/Users/jason/Developer/Jasonmilk/.test-node/node_modules}"

fail=0
step() { printf '\n== %s\n' "$1"; }

step "1/4 syntax of every touched JS"
for f in view_hygiene_test.js cell_metering_test.js three_state_test.js cell_seen.js \
         ../assets/cell_metering.js ../assets/prove_track.view.js; do
  if ! out=$(node --check "$f" 2>&1); then
    echo "  FAIL syntax: $f"; echo "$out" | head -3; fail=1
  fi
done
[ "$fail" = 0 ] && echo "  ok"

step "2/4 gate (normal path)"
node view_hygiene_test.js || true

step "3/4 gate RED PATH (a check that cannot go red is not a check)"
tmp=$(mktemp /tmp/viewred.XXXXXX.js)
cp ../assets/prove_track.view.js "$tmp"
python3 - "$tmp" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
a='  function cellBarAt(i) {'
assert s.count(a)==1, 'probe anchor missing'
s=s.replace(a, '  var CACHE_X = null;\n  CACHE_X = window.CxCellMetering.project(S.session);\n'+a, 1)
open(p,'w').write(s)
PY
if VIEW_TARGET="$tmp" node view_hygiene_test.js >/tmp/red.out 2>&1; then
  echo "  FAIL: the DERIVED-STORE probe did NOT go red — the gate is blind"; fail=1
else
  grep -q 'FAIL DERIVED-STORE' /tmp/red.out && echo "  ok (red, as it must be)" || { echo "  FAIL: wrong reason for red"; fail=1; }
fi
rm -f "$tmp"

step "4/4 whole gate"
node run_all.js 2>&1 | tail -2

step "verdict"
if [ "$fail" = 0 ]; then echo "  PRECOMMIT OK — safe to commit"; else echo "  PRECOMMIT FAILED — do NOT commit"; exit 1; fi
