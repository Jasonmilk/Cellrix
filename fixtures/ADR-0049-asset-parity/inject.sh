#!/usr/bin/env bash
# fixtures/asset_parity/inject.sh — the counter-example for the asset-parity gate.
#
# THE DEFECT THIS INJECTS IS THE ONE THE GATE NAMES: an asset whose bytes are NOT in the built
# artifact (a stale `include_str!` embed). Appending one byte is enough — content presence is
# exact, so the asset no longer matches what the binary carries.
#
# CONTRACT (phyt-DNA fixtures/README.md):
#   · operates on $F itself — the injection target IS the detection target (no second source);
#   · isolated: the original is backed up first, and the harness restores it;
#   · the injected defect MUST cross the threshold, or the gate is never RED (a fixture that
#     cannot fail is worse than none — the same rule the gate's own mutation check enforces).
set -eu
: "${F:?fixture needs \$F (the asset under test)}"
cp "$F" /tmp/_probe_asset_backup
printf '\n/* injected by fixtures/asset_parity: a byte that is not in the artifact */\n' >> "$F"
