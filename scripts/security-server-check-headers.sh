#!/usr/bin/env bash
#
# Security server check headers
#
# Purpose:
# - Operational script for this repository's server/local workflows.
#
# Safety:
# - Read-only checks by default.
#
# Variables:
# - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
#
# Usage:
#   TARGET_ENV=staging BASE_URL=https://demo.bookmyclass.app bash scripts/security-server-check-headers.sh
#
set -euo pipefail

BASE_URL="${BASE_URL:-https://demo.bookmyclass.app}"
TMP_HEADERS_FILE="$(mktemp)"
TMP_LAST_HEADERS_FILE="$(mktemp)"

cleanup() {
  rm -f "$TMP_HEADERS_FILE"
  rm -f "$TMP_LAST_HEADERS_FILE"
}
trap cleanup EXIT

log() {
  echo "[security-server-check-headers] $*"
}

fetch_headers() {
  local url="$1"
  curl -sS -L -D "$TMP_HEADERS_FILE" -o /dev/null "$url"
  extract_last_header_block "$TMP_HEADERS_FILE" > "$TMP_LAST_HEADERS_FILE"
}

extract_last_header_block() {
  local file="$1"
  awk '
    BEGIN { RS="\r\n\r\n|\n\n"; ORS="" }
    { last=$0 }
    END { print last }
  ' "$file"
}

assert_header() {
  local header_name="$1"
  if ! grep -qi "^${header_name}:" "$TMP_LAST_HEADERS_FILE"; then
    echo "[security-server-check-headers][FAIL] Missing required header: ${header_name}" >&2
    echo "--- response headers ---" >&2
    cat "$TMP_HEADERS_FILE" >&2
    exit 1
  fi
}

log "checking response headers for ${BASE_URL}"

fetch_headers "$BASE_URL"
assert_header "Content-Security-Policy"
assert_header "X-Content-Type-Options"
assert_header "Referrer-Policy"
if [[ "$BASE_URL" == https://* ]]; then
  assert_header "Strict-Transport-Security"
fi

assert_common_low_headers() {
  assert_header "X-Content-Type-Options"
  assert_header "Permissions-Policy"
  assert_header "Cross-Origin-Resource-Policy"
  assert_header "Cross-Origin-Opener-Policy"
  if [[ "$BASE_URL" == https://* ]]; then
    assert_header "Strict-Transport-Security"
  fi
}

fetch_headers "${BASE_URL%/}/robots.txt"
assert_common_low_headers

HOME_BODY="$(curl -sS "${BASE_URL%/}")"
STATIC_JS_PATH="$(echo "$HOME_BODY" | grep -Eo '/_next/static/[^"'\'' ]+\.js' | head -n 1 || true)"
STATIC_MEDIA_PATH="$(echo "$HOME_BODY" | grep -Eo '/_next/static/media/[^"'\'' )]+' | head -n 1 || true)"

if [[ -n "$STATIC_JS_PATH" ]]; then
  fetch_headers "${BASE_URL%/}${STATIC_JS_PATH}"
  assert_common_low_headers
  log "checked static JS headers at ${STATIC_JS_PATH}"
else
  echo "[security-server-check-headers][WARN] could not resolve a _next/static/*.js asset from homepage; skipping static JS header assertion" >&2
fi

if [[ -n "$STATIC_MEDIA_PATH" ]]; then
  fetch_headers "${BASE_URL%/}${STATIC_MEDIA_PATH}"
  assert_common_low_headers
  log "checked static media headers at ${STATIC_MEDIA_PATH}"
else
  echo "[security-server-check-headers][WARN] could not resolve a _next/static/media/* asset from homepage; skipping static media header assertion" >&2
fi

log "required headers are present on app + robots/static/static-media surfaces"
