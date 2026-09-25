#!/usr/bin/env bash
# mutation.sh — run a mutation with a PRECONDITION and an UNCONDITIONAL RESTORE.
#
# Two ends of one family have both bitten this session:
#   set -e      hard-aborted mid-run  => the restore never ran, tree left mutated;
#   no pipefail => the harness read `tail`'s status and swallowed a non-zero exit.
# The lesson is not "-e or not -e": DETECTION must be hard, RESTORE must be unconditional.
#
# And four incidents shared a second shape: THE FIXTURE DID NOTHING (touch only moves
# mtime; a stub answered 404 on the probe path; a control read nothing; a base path was
# one level off). So no mutation is judged unless the TARGET'S OWN HASH is proven to
# have changed — a count of dirty files is a signal, not the thing.
#
#   usage: mutation.sh <repo> <target> <mutate-cmd> <assert-cmd> [expect-exit] [restore-cmd]
#          mutation.sh --self-test
set -u
set -o pipefail

# The self-test cd's away, so this script's own path must be resolved to an ABSOLUTE
# path FIRST — a relative $0 stops resolving after cd (sixth instance of a wrong base).
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

hash_of() { git -C "$1" hash-object "$2" 2>/dev/null || echo 'none'; }

if [ "${1:-}" = "--self-test" ]; then
  # PERMANENT EMPTY-FIXTURE SENTINEL: a deliberately invalid mutation must be VOID.
  # Without this, a dead precondition guard keeps producing "mutations that ran".
  d=$(mktemp -d); cd "$d"; git init -q .; echo hello > t.txt; git add t.txt
  out=$(MUTATION_SELFTEST=1 bash "$SELF" "$d" t.txt "touch t.txt" "exit 0" "" "" 2>&1); code=$?
  rm -rf "$d"
  if [ "$code" = "9" ] && printf '%s' "$out" | grep -q 'MUTATION VOID'; then
    echo 'OK — the empty-fixture sentinel is armed (a no-op mutation is VOID)'
    exit 0
  fi
  echo "SENTINEL DEAD: a no-op mutation was NOT reported VOID (exit $code) — the"
  echo "precondition guard is broken, so every 'verified' mutation is now suspect."
  exit 1
fi

REPO="$1"; TARGET="$2"; MUTATE="$3"; ASSERT="$4"; EXPECT="${5:-}"; RESTORE="${6:-}"
# UNCONDITIONAL RESTORE — not part of the happy path.
[ -n "$RESTORE" ] && trap 'eval "$RESTORE"' EXIT INT TERM

before=$(hash_of "$REPO" "$TARGET")
eval "$MUTATE"
after=$(hash_of "$REPO" "$TARGET")
if [ "$before" = "$after" ]; then
  echo "MUTATION VOID: $TARGET is byte-identical ($before). The fixture did nothing, so"
  echo "  any verdict would be about an input that never changed."
  exit 9
fi
echo "  [precondition ok] $TARGET $(printf '%.8s' "$before") -> $(printf '%.8s' "$after")"

eval "$ASSERT"; got=$?
echo "  [assert exit] $got${EXPECT:+ (expected $EXPECT)}"
if [ -n "$EXPECT" ] && [ "$got" != "$EXPECT" ]; then
  echo "MUTATION FAILED: expected exit $EXPECT, got $got"; exit 1
fi
