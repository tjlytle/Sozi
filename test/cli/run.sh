#!/usr/bin/env bash
# Run the CLI tests. They spawn Electron, which needs a display.
# The tests assume a current build: run `npx gulp` first.
set -euo pipefail
cd "$(dirname "$0")/../.."

if command -v xvfb-run >/dev/null 2>&1; then
    exec xvfb-run -a node --test "test/cli/*.test.js"
fi

# Fallback for a desktop session without xvfb-run.
export DISPLAY="${DISPLAY:-:1}"
export XAUTHORITY="${XAUTHORITY:-/run/user/1000/gdm/Xauthority}"
exec node --test "test/cli/*.test.js"
