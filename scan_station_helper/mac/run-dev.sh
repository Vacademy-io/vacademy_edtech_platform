#!/bin/bash
# Runs the built helper in the foreground in dev mode (logs to this terminal; Ctrl-C to stop).
# Dev mode: requests without an Origin header (curl) are allowed, and unknown website origins are
# refused WITHOUT the "Allow this website?" alert. Add VACADEMY_SCAN_HELPER_PROMPT=1 to test the alert.
# Add VACADEMY_SCAN_HELPER_NO_UI=1 for no menu-bar item (e.g. over SSH, no GUI session).
#   ./run-dev.sh
#   curl -s http://127.0.0.1:47811/v1/status
set -euo pipefail
cd "$(dirname "$0")"
BIN="build/Vacademy Scan Helper.app/Contents/MacOS/VacademyScanHelper"
[ -x "$BIN" ] || ARCHS="$(uname -m)" ./build.sh
export VACADEMY_SCAN_HELPER_DEV=1
exec "$BIN" "$@"
