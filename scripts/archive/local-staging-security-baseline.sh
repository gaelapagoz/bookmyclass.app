#!/usr/bin/env bash
set -euo pipefail

echo "[DEPRECATED] scripts/security-server-run-baseline.sh -> scripts/security-server-run-baseline.sh" >&2
exec bash "$(dirname "$0")/security-server-run-baseline.sh" "$@"
