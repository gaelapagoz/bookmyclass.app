#!/usr/bin/env bash
set -euo pipefail

# Staging wrapper: keep compatibility by delegating to existing UAT script.
exec bash "$(dirname "$0")/local-uat-security-baseline.sh" "$@"