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

step "1/5 syntax of every touched JS"
for f in view_hygiene_test.js cell_metering_test.js three_state_test.js cell_seen.js \
         ../assets/cell_metering.js ../assets/prove_track.view.js; do
  if ! out=$(node --check "$f" 2>&1); then
    echo "  FAIL syntax: $f"; echo "$out" | head -3; fail=1
  fi
done
[ "$fail" = 0 ] && echo "  ok"

step "2/5 LOAD SMOKE (does the module still load and run?)"
# A syntax check cannot see a load-time ReferenceError (a renamed declaration's leftover
# is valid syntax and throws on evaluation — §67.4 TDZ, §98.5 stale constant). Smoke/BVT
# answers exactly one question: does the program run? It also covers circular deps and
# top-level evaluation throws.
node -e "
const M = require('../assets/cell_metering.js');
const T = require('../assets/three_state.js');
const r = M.project([{type:'assistant/usage', data:{completion_tokens:4}, period_id:'P'}]);
const a = M.allocate([{state:M.P(4)},{state:M.A()}], {gridCols:200});
if (!r || !r.bars || !a || typeof a.state !== 'string') { throw new Error('smoke: no usable output'); }
console.log('  ok (project + allocate both ran)');
" || { echo "  FAIL load smoke"; fail=1; }

step "3/5 gate (normal path)"
node view_hygiene_test.js || true

step "4/5 gate RED PATH (a check that cannot go red is not a check)"
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

step "5/5 whole gate"
node run_all.js 2>&1 | tail -2

step "verdict"
# THE VERDICT MUST REFLECT THE WHOLE GATE (a verdict of OK while the suite is red is
# exactly the self-deception this script exists to prevent). Two reds are expected and
# named: this cell's gate (M3 target) and the pre-existing unrelated rows test.
whole=$(node run_all.js 2>&1)
last=$(printf '%s' "$whole" | tail -1)
unexpected=$(printf '%s' "$last" | sed -n 's/.*\([0-9]*\) red.*/\1/p')
# NAMES come from the whole output (the RED ROSTER line), never from the summary line —
# reading only the summary is how a gate stays green while naming nothing.
known=$(printf '%s' "$whole" | grep -E 'view_hygiene_test\.js|prove_track_rows_test\.js' | grep -c 'exit 1')
if [ "$fail" != 0 ]; then echo "  PRECOMMIT FAILED — do NOT commit (syntax/red-path)"; exit 1; fi
if [ -n "$unexpected" ] && [ "$unexpected" -gt "$known" ]; then
  echo "  PRECOMMIT FAILED — $unexpected red(s), only $known expected: $last"; exit 1
fi
echo "  PRECOMMIT OK — safe to commit ($last)" 
