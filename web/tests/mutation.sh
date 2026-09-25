#!/usr/bin/env bash
# mutation.sh — run a mutation WITH A PRECONDITION.
#
# Four incidents in this session shared one shape: THE FIXTURE DID NOTHING.
#   touch (only mtime, git still clean) · http.server answering 404 on the probe path
#   · a control that reported success without reading anything · a base path one level off.
# Each time the verdict was about an input that had never changed, and each time it looked
# like a result. A sentinel belongs on the fixture too, so no mutation is judged unless the
# input is first PROVEN to have changed — and afterwards PROVEN to be restored.
#
#   usage: mutation.sh <repo> <mutate-cmd> <assert-cmd> [expect-exit]
set -u
# pipefail: the ASSERT command is usually a pipeline (`node ... | tail -1`), and without
# this the harness reads the LAST command's status instead of the gate's — swallowing a
# non-zero exit is the same family as the fixture that did nothing.
set -o pipefail
REPO="$1"; MUTATE="$2"; ASSERT="$3"; EXPECT="${4:-}"
before=$(git -C "$REPO" status --porcelain | wc -l | tr -d ' ')
eval "$MUTATE"
after=$(git -C "$REPO" status --porcelain | wc -l | tr -d ' ')
if [ "$after" -le "$before" ]; then
  echo "MUTATION VOID: the input did not change ($before -> $after dirty files)."
  echo "  The fixture did nothing, so any verdict would be about an unchanged input."
  exit 9
fi
echo "  [precondition ok] dirty files $before -> $after"
eval "$ASSERT"; got=$?
echo "  [assert exit] $got${EXPECT:+ (expected $EXPECT)}"
if [ -n "$EXPECT" ] && [ "$got" != "$EXPECT" ]; then
  echo "MUTATION FAILED: expected exit $EXPECT, got $got"; exit 1
fi
