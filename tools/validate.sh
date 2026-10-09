#!/usr/bin/env bash
# validate.sh v2 · 真数据驱动：闸门全部来自 docs/decisions/，引擎零硬编码
set -uo pipefail
# 环境适配（非逻辑改动）：phyt-DNA 模板把 ADR 放在仓库根的 decisions/；Cellrix 放在 docs/decisions/。
# 除路径前缀外，本脚本与 template/tools/validate.sh 一致 —— 只有一处行为补充，见下方"零闸门"。
mode=check; target=""; only_timing=""
case "${1:-}" in
  --probe-all) mode=probe; target="";;
  --probe) mode=probe; target="$2";;
  --timing) only_timing="$2";;
  --override) printf '{"ts":"%s","gate_id":"%s","verdict":"block","override":true,"source":"cli","event_id":"manual","note":"%s"}\n' "$(TZ=CST-8 date +%Y-%m-%dT%H:%M:%S%z)" "$2" "${4:-无理由}" >> ledger/hits-2026.jsonl; echo "override 已留痕"; exit 0;;
  --appeal) printf '{"ts":"%s","gate_id":"%s","verdict":"appeal","override":false,"source":"user-appeal","event_id":"manual","note":"%s"}\n' "$(TZ=CST-8 date +%Y-%m-%dT%H:%M:%S%z)" "$2" "${4:-无理由}" >> ledger/appeals-2026.jsonl; echo "申诉已独立留痕"; exit 0;;
esac

gates(){ for f in docs/decisions/*.md; do [ -e "$f" ] || continue
  grep -q '^hard: true' "$f" || continue
  grep -q '^status: deprecated' "$f" && continue
  basename "$f" .md; done; }
glob_first(){ local id="$1" g p
  while read -r g; do
    g=$(printf '%s' "$g" | sed 's/^ *//;s/ *$//'); [ -n "$g" ] || continue
    re=$(printf '%s' "$g" | sed 's/\./\\./g; s/\*\*/\x01/g; s/\*/[^\/]*/g; s/\x01/.*/g')
    while read -r p; do
      [[ "$p" =~ ^${re}$ ]] && { echo "$p"; return 0; }   # 首个真实存在的匹配
    done < <(git ls-files 2>/dev/null || find . -type f -not -path './.git/*' | sed 's|^\./||')
    echo "$g"; return 0
  done < <(grep '^applies-to:' "docs/decisions/$id.md" | sed 's/.*\[//;s/\]//' | tr -d '"' | tr ',' '\n')
}
check_of(){ awk '/^check: \|/{f=1;next} f&&/^[^ ]/{f=0} f&&NF{print}' "docs/decisions/$1.md" | sed 's/^  //'; }

NG=$(gates | wc -l | tr -d ' ')
if [ "$NG" = 0 ]; then
  echo "  [BLOCK] 零闸门 —— docs/decisions/ 里没有一份带 'hard: true' 的 ADR。" >&2
  echo "          空集合上的'全部通过'是伪证：没有任何断言被执行过。" >&2
  echo "          （模板契约见 phyt-DNA fixtures/README.md 与 docs/decisions/ADR-20261009-*.md）" >&2
  exit 2
fi

# ---- 变异测试的闭环：注入 → 检查 → **记录** → 还原 ------------------------------
# 缺"记录"就不算闭环：一次探针跑完不留痕，等于"我没跑过它也说得通"。
# 承 template/ledger/README.md 的 schema（kind: probe 是模板已定义的类别）。
rec(){ # rec <gate_id> <verdict> <note>
  [ -d ledger ] || return 0
  printf '{"ts":"%s","gate_id":"%s","verdict":"%s","override":false,"source":"probe","event_id":"probe-%s-%s","kind":"probe","note":"%s"}\n' \
    "$(TZ=CST-8 date +%Y-%m-%dT%H:%M:%S%z)" "$1" "$2" "$1" "$(date +%s)-$$-$RANDOM" "$3" >> ledger/hits-2026.jsonl
}
probe_one(){ # probe_one <gate-id> => 0 RED（闸门活着）· 2 腐化/拓扑失配
  local id="$1" F fx out
  F=$(glob_first "$id")
  if [ ! -f "$F" ]; then echo "  [B] 拓扑失配: $F 不存在（applies-to 展开后无可检对象）" >&2
    rec "$id" block "topology-mismatch: $F"; return 2; fi
  fx="fixtures/$id/inject.sh"
  if [ ! -f "$fx" ]; then echo "  [A] 缺 fixture: $fx（无夹具就无法证明闸门能红）" >&2
    rec "$id" block "no-fixture"; return 2; fi
  cp "$F" /tmp/inj.bak
  F="$F" bash "$fx" >/dev/null 2>&1
  out=$(F="$F" bash -c "$(check_of "$id")" 2>/dev/null)
  cp /tmp/inj.bak "$F" 2>/dev/null; rm -f /tmp/inj.bak
  if [ -n "$out" ]; then echo "  心跳 RED — 检出: $out"; rec "$id" pass "probe: $out"; return 0
  else echo "  心跳 NOT RED — 闸门已腐化（夹具没能越过阈值）" >&2
    rec "$id" block "corrupted: fixture did not cross the threshold"; return 2; fi
}

if [ "$mode" = probe ]; then
  if [ -n "$target" ]; then probe_one "$target"; exit $?; fi
  # 无 target = 全部：闭环的默认动作。没有夹具的闸门**具名跳过**，不静默略过。
  rc=0; ran=0; skipped=""
  while read -r g; do [ -n "$g" ] || continue
    if [ -f "fixtures/$g/inject.sh" ]; then ran=$((ran+1)); probe_one "$g" || rc=2
    else skipped="$skipped $g"; fi
  done < <(gates)
  [ -n "$skipped" ] && echo "  [具名跳过] 无夹具的闸门:$skipped" >&2
  echo "  probe-all: 跑了 $ran 个闸门$( [ -n "$skipped" ] && echo "，跳过 $(echo $skipped | wc -w | tr -d ' ')" )"
  exit $rc
fi

input=$(cat)
paths=$(printf '%s' "$input" | grep -o '"paths":\[[^]]*\]' | grep -o '"[^"]*"' | tr -d '"')
[ -z "$paths" ] && { printf '{"verdict":"pass","scanned":0,"hits":0}\n'; exit 0; }
scanned=0; hits=""
while read -r id; do
  [ -n "$id" ] || continue
  if [ -n "$only_timing" ]; then
    t=$(grep '^timing:' "docs/decisions/$id.md" | head -1 | awk '{print $2}')
    [ "${t:-post}" = "$only_timing" ] || continue
  fi
  while read -r gg; do
    gg=$(echo "$gg" | sed 's/^ *//;s/ *$//'); [ -n "$gg" ] || continue
    while read -r p; do
      [ -n "$p" ] || continue
      re=$(printf '%s' "$gg" | sed 's/\./\\./g; s/\*\*/\x01/g; s/\*/[^\/]*/g; s/\x01/.*/g')
      if [[ "$p" =~ ^${re}$ ]]; then
        scanned=$((scanned+1))
        # 引擎级落实 ADR-0007：输入失效 = fail-closed，绝不静默放行
        if [ ! -e "$p" ]; then
          out="[输入失效] $p 不存在 —— 按 fail-closed 处理（静默放行=伪证）"
        else
          out=$(F="$p" bash -c "$(check_of "$id")" 2>&1)
        fi
        [ -n "$out" ] && hits="$hits|$id:$out"
        break
      fi
    done <<< "$paths"
  done < <(grep '^applies-to:' "docs/decisions/$id.md" | sed 's/.*\[//;s/\]//' | tr -d '"' | tr ',' '\n')
done < <(gates)

if [ -z "$hits" ]; then printf '{"verdict":"pass","scanned":%d,"hits":0}\n' "$scanned"; exit 0; fi
printf '{"verdict":"block","scanned":%d,"hits":%d,"rule_id":"%s"}\n' "$scanned" "$(echo "$hits"|tr '|' '\n'|grep -c .)" "$(echo "$hits"|sed 's/^|//'|cut -d: -f1)"
echo "违规: $hits" >&2
exit 2
  [ -n "${INJ_BACKUP:-}" ] && cp "$INJ_BACKUP" "$F" 2>&1
  [ -n "${INJ_BACKUP:-}" ] && cp "$INJ_BACKUP" "$F" 2>&1

[ -n "${INJ_BACKUP:-}" ] && cp "$INJ_BACKUP" "$F" 2>&1




