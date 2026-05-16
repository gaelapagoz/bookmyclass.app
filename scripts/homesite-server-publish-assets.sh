#!/usr/bin/env bash
#
# Homesite server publish assets
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
#   TARGET_ENV=staging BASE_URL=https://demo.bookmyclass.app bash scripts/homesite-server-publish-assets.sh
#
set -Eeuo pipefail

APP_DIR="${1:-${APP_DIR:-}}"
HOMESITE_PUBLISH_DIR="${2:-${HOMESITE_PUBLISH_DIR:-/var/www/bookmyclass-homesite}}"
BASE_URL="${3:-${BASE_URL:-}}"

if [[ -z "$APP_DIR" ]]; then
  echo "Usage: scripts/homesite-server-publish-assets.sh <app-dir> [homesite-publish-dir] [base-url]" >&2
  exit 64
fi

APP_DIR="${APP_DIR%/}"
HOMESITE_PUBLISH_DIR="${HOMESITE_PUBLISH_DIR%/}"
HOMESITE_SOURCE_DIR="$APP_DIR/homesite"
HOMESITE_IMAGE_SOURCE_DIR="$APP_DIR/public/images/homesite"
HOMESITE_IMAGE_DEST_DIR="$HOMESITE_PUBLISH_DIR/images/homesite"

log_step() {
  echo
  echo "==> $*"
}

print_path_listing() {
  local label="$1"
  local path="$2"

  echo
  echo "-- $label: $path"
  if [[ -e "$path" ]]; then
    ls -la "$path" || true
    find "$path" -maxdepth 2 -type f | sort | head -n 80 || true
  else
    echo "[missing] $path"
  fi
}

print_destination_diagnostics() {
  local label="$1"
  local path="$2"
  local parent

  parent="$(dirname "$path")"
  echo
  echo "-- $label parent: $parent"
  ls -la "$parent" || true
  echo "-- $label path: $path"
  ls -la "$path" || true
  echo "-- $label directory test"
  test -d "$path" && echo "test_d=pass" || echo "test_d=fail"
  test -w "$path" && echo "test_w=pass" || echo "test_w=fail"
  echo "-- $label find"
  find "$path" -maxdepth 3 -print | sort | head -n 120 || true
}

print_failure_diagnostics() {
  local reason="${1:-unknown}"

  echo
  echo "==> homesite asset failure diagnostics: $reason"
  echo "user=$(id -un 2>/dev/null || whoami)"
  echo "uid_gid=$(id 2>/dev/null || true)"
  echo "pwd=$(pwd)"
  echo "app_dir=$APP_DIR"
  echo "homesite_source_dir=$HOMESITE_SOURCE_DIR"
  echo "homesite_image_source_dir=$HOMESITE_IMAGE_SOURCE_DIR"
  echo "homesite_publish_dir=$HOMESITE_PUBLISH_DIR"
  echo "homesite_image_dest_dir=$HOMESITE_IMAGE_DEST_DIR"
  print_path_listing "homesite source" "$HOMESITE_SOURCE_DIR"
  print_path_listing "homesite image source" "$HOMESITE_IMAGE_SOURCE_DIR"
  print_path_listing "homesite destination" "$HOMESITE_PUBLISH_DIR"
  print_path_listing "homesite image destination" "$HOMESITE_IMAGE_DEST_DIR"
}

trap 'exit_code=$?; print_failure_diagnostics "line=$LINENO exit=$exit_code"; exit "$exit_code"' ERR

fail() {
  echo "[FAIL][homesite-assets] $*" >&2
  exit 1
}

log_step "publish homesite assets"
echo "user=$(id -un 2>/dev/null || whoami)"
echo "pwd=$(pwd)"
echo "source_html=$HOMESITE_SOURCE_DIR"
echo "source_images=$HOMESITE_IMAGE_SOURCE_DIR"
echo "destination=$HOMESITE_PUBLISH_DIR"
echo "destination_images=$HOMESITE_IMAGE_DEST_DIR"

[[ -d "$HOMESITE_SOURCE_DIR" ]] || fail "Homesite source directory does not exist: $HOMESITE_SOURCE_DIR"
[[ -d "$HOMESITE_IMAGE_SOURCE_DIR" ]] || fail "Homesite image source directory does not exist: $HOMESITE_IMAGE_SOURCE_DIR"

mapfile -t html_files < <(find "$HOMESITE_SOURCE_DIR" -maxdepth 1 -type f -name '*.html' | sort)
[[ "${#html_files[@]}" -gt 0 ]] || fail "No homesite HTML files found in $HOMESITE_SOURCE_DIR"

mapfile -t image_files < <(find "$HOMESITE_IMAGE_SOURCE_DIR" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' -o -iname '*.gif' -o -iname '*.svg' \) | sort)
[[ "${#image_files[@]}" -gt 0 ]] || fail "No homesite image files found in $HOMESITE_IMAGE_SOURCE_DIR"

mkdir -p "$HOMESITE_PUBLISH_DIR"
mkdir -p "$HOMESITE_IMAGE_DEST_DIR"
[[ -d "$HOMESITE_PUBLISH_DIR" ]] || fail "Homesite destination directory was not created: $HOMESITE_PUBLISH_DIR"
[[ -d "$HOMESITE_IMAGE_DEST_DIR" ]] || fail "Homesite image destination directory was not created: $HOMESITE_IMAGE_DEST_DIR"
[[ -w "$HOMESITE_PUBLISH_DIR" ]] || fail "Homesite destination is not writable: $HOMESITE_PUBLISH_DIR"
[[ -w "$HOMESITE_IMAGE_DEST_DIR" ]] || fail "Homesite image destination is not writable: $HOMESITE_IMAGE_DEST_DIR"

touch "$HOMESITE_PUBLISH_DIR/.homesite-write-check" "$HOMESITE_IMAGE_DEST_DIR/.homesite-write-check"
rm -f "$HOMESITE_PUBLISH_DIR/.homesite-write-check" "$HOMESITE_IMAGE_DEST_DIR/.homesite-write-check"

if command -v rsync >/dev/null 2>&1; then
  log_step "pre-rsync homesite destination diagnostics"
  echo "pwd=$(pwd)"
  echo "whoami=$(id -un 2>/dev/null || whoami)"
  mkdir -pv "$HOMESITE_PUBLISH_DIR" "$HOMESITE_IMAGE_DEST_DIR"
  print_destination_diagnostics "homesite destination" "$HOMESITE_PUBLISH_DIR"
  print_destination_diagnostics "homesite image destination" "$HOMESITE_IMAGE_DEST_DIR"

  [[ -d "$HOMESITE_IMAGE_DEST_DIR" ]] || fail "Homesite image destination directory missing before rsync: $HOMESITE_IMAGE_DEST_DIR"
  [[ -w "$HOMESITE_IMAGE_DEST_DIR" ]] || fail "Homesite image destination directory not writable before rsync: $HOMESITE_IMAGE_DEST_DIR"
  rsync -a --delete --include='*/' --include='*.html' --exclude='*' "$HOMESITE_SOURCE_DIR/" "$HOMESITE_PUBLISH_DIR/"

  # The HTML rsync runs with --delete at the homesite root and can remove
  # image-only destination directories before the image rsync starts.
  mkdir -pv "$HOMESITE_IMAGE_DEST_DIR"
  print_destination_diagnostics "homesite image destination after HTML rsync" "$HOMESITE_IMAGE_DEST_DIR"
  [[ -d "$HOMESITE_IMAGE_DEST_DIR" ]] || fail "Homesite image destination directory missing after HTML rsync: $HOMESITE_IMAGE_DEST_DIR"
  [[ -w "$HOMESITE_IMAGE_DEST_DIR" ]] || fail "Homesite image destination directory not writable after HTML rsync: $HOMESITE_IMAGE_DEST_DIR"
  rsync -a --delete "$HOMESITE_IMAGE_SOURCE_DIR/" "$HOMESITE_IMAGE_DEST_DIR/"
else
  find "$HOMESITE_PUBLISH_DIR" -maxdepth 1 -type f -name '*.html' -delete
  cp -a "$HOMESITE_SOURCE_DIR"/. "$HOMESITE_PUBLISH_DIR/"
  find "$HOMESITE_IMAGE_DEST_DIR" -type f -delete
  cp -a "$HOMESITE_IMAGE_SOURCE_DIR"/. "$HOMESITE_IMAGE_DEST_DIR/"
fi

declare -A deployed_images=()
while IFS= read -r deployed_image; do
  deployed_images["$(basename "$deployed_image")"]=1
done < <(find "$HOMESITE_IMAGE_DEST_DIR" -type f | sort)

missing_refs=0
while IFS= read -r ref; do
  image_name="$(basename "${ref%%\?*}")"
  if [[ -z "${deployed_images[$image_name]:-}" ]]; then
    echo "[missing-image-ref] $ref expected at $HOMESITE_IMAGE_DEST_DIR/$image_name" >&2
    missing_refs=$((missing_refs + 1))
  fi
done < <(grep -RhoE 'src="/images/homesite/[^"]+"' "$HOMESITE_PUBLISH_DIR"/*.html | sed -E 's/^src="\/images\/homesite\///; s/"$//' | sort -u)

if [[ "$missing_refs" -gt 0 ]]; then
  fail "$missing_refs homesite HTML image reference(s) are missing from deployed target"
fi

sample_image="$(find "$HOMESITE_IMAGE_DEST_DIR" -type f | sort | head -n 1)"
[[ -n "$sample_image" ]] || fail "No deployed homesite image files found after copy"
sample_image_name="$(basename "$sample_image")"

log_step "deployed homesite HTML files"
find "$HOMESITE_PUBLISH_DIR" -maxdepth 1 -type f -name '*.html' -printf '%f\n' | sort

log_step "deployed homesite image files"
find "$HOMESITE_IMAGE_DEST_DIR" -type f -printf '%f\n' | sort

if [[ -n "$BASE_URL" ]]; then
  log_step "verify deployed homesite image URL"
  image_url="${BASE_URL%/}/images/homesite/$sample_image_name"
  status="$(curl -sS -L --max-time 20 -o /dev/null -w "%{http_code}" "$image_url" || true)"
  echo "url=$image_url code=${status:-curl_failed}"
  [[ "$status" == "200" ]] || fail "Expected deployed homesite image URL to return 200: $image_url"
else
  echo "[warn] BASE_URL not set; skipped public homesite image curl verification"
fi
