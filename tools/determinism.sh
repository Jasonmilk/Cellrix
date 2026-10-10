#!/usr/bin/env bash
# determinism.sh — THE MULTIMETER'S TIMING AXIS (phyt-DNA BACKFLOW P11, 2026-10-09).
#
# WHY: the nastiest false red is not a wrong criterion — it is a criterion that answers differently
# to the SAME command. Measured 2026-10-09 (Cellrix), environment IDENTICAL (cdp=up panel=up) across
# 8 runs: proven 53..79, red 2..10, held 1..31 — 6 distinct fingerprints for 8 runs. So the numbers
# this suite prints are not measurements; and adding the environment field (P6) was necessary but
# NOT sufficient — equal environments still disagree.
#
# ★ DEFAULT IS FREE: the fingerprint is already written to the ledger on every run, so comparing runs
# costs nothing. The first design re-ran the whole suite (≈7 min each) and was unusable — the answer
# was in the ledger all along.
#
#   exit 0  deterministic — every recorded run under the SAME env agreed; the verdict may be reported
#   exit 2  FLAKY — same env, different fingerprints ⇒ neither red nor green; NOT evidence
#   exit 3  could not measure (fewer than 2 comparable runs)
#
# Usage: bash tools/determinism.sh [N]        # compare the last N runs (default 8)
#        bash tools/determinism.sh --rerun N  # produce N fresh runs first (SLOW, ≈7 min each)
set -uo pipefail
LED="ledger/hits-2026.jsonl"
[ -f "$LED" ] || { echo "NEEDS-INPUT: 缺账本 $LED" >&2; exit 3; }
N=8
if [ "${1:-}" = "--rerun" ]; then
  N="${2:-2}"; i=1
  while [ "$i" -le "$N" ]; do echo "  run $i/$N (慢) ..."; node web/tests/run_all.js >/dev/null 2>&1 || true; i=$((i + 1)); done
  N=8
else
  N="${1:-$N}"
fi
python3 - "$LED" "$N" <<'PY'
import json, sys, collections
led, n = sys.argv[1], int(sys.argv[2])
rows = [json.loads(l) for l in open(led, encoding='utf-8') if l.strip() and '"fingerprint"' in l][-n:]
if len(rows) < 2:
    print("  [无法测量] 可比的运行少于 2 条（先跑一次 node web/tests/run_all.js）"); sys.exit(3)
# 只比较【环境相同】的运行 —— 不同的环境本来就不可比（P6）
groups = collections.defaultdict(list)
for r in rows:
    e = r.get('env') or {}
    groups[(e.get('cdp'), e.get('panel'), e.get('jsdom'))].append(r)
worst = 0
for env, rs in groups.items():
    if len(rs) < 2:
        continue
    fps = {r.get('fingerprint') for r in rs}
    counts = [(r['counts']['proven'], r['counts']['red'], r['counts']['held']) for r in rs]
    tag = 'same' if len(fps) == 1 else 'FLAKY'
    print(f"  env cdp={env[0]} panel={env[1]} jsdom={env[2]}: {len(rs)} 次运行 · 唯一指纹 {len(fps)} ⇒ {tag}")
    if len(fps) > 1:
        pr = sorted(c[0] for c in counts); rr = sorted(c[1] for c in counts); hr = sorted(c[2] for c in counts)
        print(f"     proven {pr[0]}..{pr[-1]}   red {rr[0]}..{rr[-1]}   held {hr[0]}..{hr[-1]}")
        worst = 2
if worst == 0:
    print("  确定 — 同环境下所有运行指纹一致，裁决可报告（exit 0）"); sys.exit(0)
print("  [FLAKY] 同环境下指纹不一致 ⇒ 该裁决【既不是红也不是绿】，不得作为证据", file=sys.stderr)
sys.exit(2)
PY
