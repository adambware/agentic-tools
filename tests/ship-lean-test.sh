#!/usr/bin/env bash
# CI shim: the ship-lean plugin owns its hermetic suite. CI runs every
# tests/*-test.sh, so this delegates to the plugin's own test.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$ROOT/plugins/ship-lean/test/ship-lean-test.sh" "$@"
