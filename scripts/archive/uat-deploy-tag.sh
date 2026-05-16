#!/usr/bin/env bash
set -euo pipefail
echo "[DEPRECATED] scripts/deploy-server-tag.sh -> scripts/deploy-server-tag.sh" >&2
TARGET_ENV="${TARGET_ENV:-uat}" \
SSH_HOST="${SSH_HOST:-bookmyclass-uat}" \
RELEASE_TAG="${RELEASE_TAG:-${TARGET_TAG:-${1:-}}}" \
BASE_URL="${BASE_URL:-${APP_BASE_URL:-${UAT_BASE_URL:-https://demo.bookmyclass.app}}}" \
APP_DIR="${APP_DIR:-/var/www/bookmyclass}" \
APP_NAME="${APP_NAME:-bookmyclass-app-uat}" \
CONFIRM_TARGET="${CONFIRM_TARGET:-}" \
bash "$(dirname "$0")/deploy-server-tag.sh"
