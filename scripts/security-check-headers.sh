#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://uat.bookmyclass.app}"
TMP_HEADERS_FILE="$(mktemp)"

cleanup() {
  rm -f "$TMP_HEADERS_FILE"
}
trap cleanup EXIT

log() {
  echo "[security-check-headers] $*"
}

fetch_headers() {
  local url="$1"
  curl -sS -I "$url" > "$TMP_HEADERS_FILE"
}

assert_header() {
  local header_name="$1"
  if ! grep -qi "^${header_name}:" "$TMP_HEADERS_FILE"; then
    echo "[security-check-headers][FAIL] Missing required header: ${header_name}" >&2
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

fetch_headers "${BASE_URL%/}/robots.txt"
assert_header "X-Content-Type-Options"
assert_header "Permissions-Policy"
assert_header "Cross-Origin-Resource-Policy"

STATIC_PATH="$(curl -sS "${BASE_URL%/}" | grep -Eo '/_next/static/[^"'\'' ]+' | head -n 1 || true)"
if [[ -n "$STATIC_PATH" ]]; then
  fetch_headers "${BASE_URL%/}${STATIC_PATH}"
  assert_header "X-Content-Type-Options"
  assert_header "Permissions-Policy"
  assert_header "Cross-Origin-Resource-Policy"
  log "checked static asset headers at ${STATIC_PATH}"
else
  echo "[security-check-headers][WARN] could not resolve a _next/static asset from homepage; skipping static asset header assertion" >&2
fi

log "required headers are present on app + controlled static surfaces"
