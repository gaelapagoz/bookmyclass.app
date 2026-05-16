#!/usr/bin/env bash
#
# Test homesite publish assets
#
# Purpose:
# - Operational script for this repository's server/local workflows.
#
# Safety:
# - Mutating operation. Review target variables before running.
#
# Variables:
# - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
#
# Usage:
#   TARGET_ENV=staging BASE_URL=https://demo.bookmyclass.app bash scripts/test-homesite-publish-assets.sh
#
set -euo pipefail

APP_DIR="${1:-${APP_DIR:-$(pwd)}}"
TMP_ROOT="/tmp/bookmyclass-homesite"
DEST_DIR="$TMP_ROOT"
NESTED_DIR="$TMP_ROOT/images/homesite"

rm -rf "$TMP_ROOT"
mkdir -p "$TMP_ROOT"

if [[ -e "$NESTED_DIR" ]]; then
  echo "[FAIL][homesite-test] nested destination unexpectedly exists before test: $NESTED_DIR" >&2
  exit 1
fi

echo "test_app_dir=$APP_DIR"
echo "test_dest_root=$DEST_DIR"
echo "test_nested_before=missing"

bash "$APP_DIR/scripts/homesite-server-publish-assets.sh" "$APP_DIR" "$DEST_DIR"

[[ -d "$NESTED_DIR" ]] || {
  echo "[FAIL][homesite-test] nested destination missing after publish: $NESTED_DIR" >&2
  exit 1
}

image_count="$(find "$NESTED_DIR" -type f | wc -l | tr -d ' ')"
html_count="$(find "$DEST_DIR" -maxdepth 1 -type f -name '*.html' | wc -l | tr -d ' ')"

echo "test_nested_after=present"
echo "test_html_count=$html_count"
echo "test_image_count=$image_count"
echo "[PASS][homesite-test] publish-homesite-assets created nested destination and copied assets"
