#!/usr/bin/env bash
set -euo pipefail

echo "[DEPRECATED] scripts/performance-server-run-smoke.sh -> scripts/performance-server-run-smoke.sh" >&2
exec bash "$(dirname "$0")/performance-server-run-smoke.sh" "$@"
