#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://uat.bookmyclass.app}"
TMP_HEADERS_FILE="$(mktemp)"

cleanup() {
  rm -f "$TMP_HEADERS_FILE"
}
trap cleanup EXIT

echo "[security-check-headers] checking response headers for $BASE_URL"
curl -sS -I "$BASE_URL" > "$TMP_HEADERS_FILE"

assert_header() {
  local header_name="$1"
  if ! grep -qi "^${header_name}:" "$TMP_HEADERS_FILE"; then
    echo "[security-check-headers][FAIL] Missing required header: ${header_name}" >&2
    echo "--- response headers ---" >&2
    cat "$TMP_HEADERS_FILE" >&2
    exit 1
  fi
}

assert_header "Content-Security-Policy"
assert_header "X-Content-Type-Options"
assert_header "Referrer-Policy"

echo "[security-check-headers] required headers are present"
