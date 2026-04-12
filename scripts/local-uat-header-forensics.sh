#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://uat.bookmyclass.app}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp}"
RUN_TAG_CHECK="${RUN_TAG_CHECK:-YES}"
ORIGIN_IP="${ORIGIN_IP:-}"
ORIGIN_PORT="${ORIGIN_PORT:-}"
ORIGIN_INSECURE="${ORIGIN_INSECURE:-NO}"
EXTRA_URLS="${EXTRA_URLS:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

log() {
  echo "[uat-header-forensics] $*"
}

fail() {
  echo "[uat-header-forensics][FAIL] $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

require_cmd curl
require_cmd awk
require_cmd sed
require_cmd grep

if [[ "$RUN_TAG_CHECK" == "YES" ]]; then
  cd "$REPO_ROOT"
  current_tag="$(git describe --tags --exact-match 2>/dev/null || true)"
  if [[ -z "$current_tag" ]]; then
    fail "Current commit is not exactly on a tag. UAT verification must run from a git tag."
  fi
fi

base_no_slash="${BASE_URL%/}"
base_host="$(echo "$base_no_slash" | sed -E 's#^https?://([^/:]+).*$#\1#')"
base_scheme="$(echo "$base_no_slash" | sed -E 's#^(https?)://.*$#\1#')"

if [[ -z "$ORIGIN_PORT" ]]; then
  if [[ "$base_scheme" == "https" ]]; then
    ORIGIN_PORT="443"
  else
    ORIGIN_PORT="80"
  fi
fi

timestamp_utc="$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="${EVIDENCE_ROOT%/}/local-uat-header-forensics-${timestamp_utc}"
raw_dir="${run_dir}/raw"
mkdir -p "$raw_dir"

summary_md="${run_dir}/summary.md"
summary_csv="${run_dir}/summary.csv"

track_headers=(
  "Content-Security-Policy"
  "Strict-Transport-Security"
  "X-Content-Type-Options"
  "Permissions-Policy"
  "Cross-Origin-Opener-Policy"
  "Cross-Origin-Embedder-Policy"
  "Cross-Origin-Resource-Policy"
  "Cache-Control"
  "Age"
  "cf-cache-status"
)

url_paths=(
  "/"
  "/learning"
  "/robots.txt"
  "/sitemap.xml"
  "/_next/image?url=%2Fimages%2Fyoga-split-main.jpg&w=1920&q=75"
  "/%2Fimages%2Flogo.png&w=64&q=75"
  "/%2Fimages%2Fyoga-split-main.jpg&w=1920&q=75"
  "/cdn-cgi/l/email-protection"
)

if [[ -n "$EXTRA_URLS" ]]; then
  while IFS= read -r extra; do
    [[ -z "$extra" ]] && continue
    url_paths+=("$extra")
  done <<<"$EXTRA_URLS"
fi

sanitize_name() {
  local value="$1"
  echo "$value" | sed -E 's#[^a-zA-Z0-9]+#_#g' | sed -E 's#_+#_#g' | sed -E 's#^_|_$##g'
}

fetch_body() {
  local url="$1"
  local body_file="$2"
  curl -sS -L "$url" -o "$body_file"
}

fetch_headers_public() {
  local full_url="$1"
  local out_file="$2"
  curl -sS -L -D "$out_file" -o /dev/null "$full_url"
}

fetch_headers_origin() {
  local full_url="$1"
  local out_file="$2"
  local insecure_args=()
  if [[ "$ORIGIN_INSECURE" == "YES" ]]; then
    insecure_args=(-k)
  fi
  curl -sS -L "${insecure_args[@]}" \
    --resolve "${base_host}:${ORIGIN_PORT}:${ORIGIN_IP}" \
    -D "$out_file" \
    -o /dev/null \
    "$full_url"
}

extract_last_block() {
  local file="$1"
  awk '
    BEGIN { RS="\r\n\r\n|\n\n"; ORS="" }
    { last=$0 }
    END { print last }
  ' "$file"
}

header_value() {
  local block="$1"
  local header="$2"
  echo "$block" | awk -v key="$header" '
    BEGIN { IGNORECASE=1 }
    $0 ~ "^" key ":" {
      sub("^[^:]+:[[:space:]]*", "", $0)
      print $0
      exit
    }
  '
}

presence_label() {
  local value="$1"
  if [[ -n "$value" ]]; then
    echo "present"
  else
    echo "missing"
  fi
}

status_code() {
  local block="$1"
  echo "$block" | awk 'NR==1 {print $2}'
}

append_csv_row() {
  local mode="$1"
  local path="$2"
  local status="$3"
  local csp="$4"
  local hsts="$5"
  local xcto="$6"
  local pp="$7"
  local coop="$8"
  local coep="$9"
  local corp="${10}"
  local cache_control="${11}"
  local age="${12}"
  local cf_cache_status="${13}"

  printf '"%s","%s","%s","%s","%s","%s","%s","%s","%s","%s","%s","%s","%s"\n' \
    "$mode" "$path" "$status" "$csp" "$hsts" "$xcto" "$pp" "$coop" "$coep" "$corp" "$cache_control" "$age" "$cf_cache_status" >>"$summary_csv"
}

printf '"mode","path","status","csp","hsts","xcto","permissions_policy","coop","coep","corp","cache_control","age","cf_cache_status"\n' >"$summary_csv"

body_file="${run_dir}/home.body.html"
fetch_body "${base_no_slash}/" "$body_file"

static_js_path="$(grep -Eo '/_next/static/[^"'"'"' ]+\.js' "$body_file" | head -n 1 || true)"
static_media_path="$(grep -Eo '/_next/static/media/[^"'"'"' )]+' "$body_file" | head -n 1 || true)"

if [[ -n "$static_js_path" ]]; then
  url_paths+=("$static_js_path")
fi
if [[ -n "$static_media_path" ]]; then
  url_paths+=("$static_media_path")
fi

unique_paths=()
for path in "${url_paths[@]}"; do
  if [[ " ${unique_paths[*]} " != *" $path "* ]]; then
    unique_paths+=("$path")
  fi
done

{
  echo "# UAT Header Forensics Summary"
  echo
  echo "- Base URL: \`$BASE_URL\`"
  echo "- Generated UTC: \`$timestamp_utc\`"
  if [[ "$RUN_TAG_CHECK" == "YES" ]]; then
    echo "- Git tag check: enabled"
  else
    echo "- Git tag check: disabled"
  fi
  if [[ -n "$ORIGIN_IP" ]]; then
    echo "- Origin compare: enabled (\`$ORIGIN_IP:$ORIGIN_PORT\` via \`--resolve $base_host\`)"
  else
    echo "- Origin compare: disabled (set \`ORIGIN_IP\` to enable)"
  fi
  echo
  echo "## URL Set"
  for path in "${unique_paths[@]}"; do
    echo "- \`$path\`"
  done
  echo
  echo "## Public Path Results"
  echo
  echo "| Path | Status | CSP | HSTS | XCTO | Permissions | COOP | COEP | CORP | Cache-Control | Age | cf-cache-status |"
  echo "|---|---:|---|---|---|---|---|---|---|---|---|---|"
} >"$summary_md"

for path in "${unique_paths[@]}"; do
  clean_name="$(sanitize_name "$path")"
  full_url="${base_no_slash}${path}"
  public_raw="${raw_dir}/public_${clean_name}.headers.txt"
  fetch_headers_public "$full_url" "$public_raw"
  public_block="$(extract_last_block "$public_raw")"

  p_status="$(status_code "$public_block")"
  p_csp="$(header_value "$public_block" "Content-Security-Policy")"
  p_hsts="$(header_value "$public_block" "Strict-Transport-Security")"
  p_xcto="$(header_value "$public_block" "X-Content-Type-Options")"
  p_pp="$(header_value "$public_block" "Permissions-Policy")"
  p_coop="$(header_value "$public_block" "Cross-Origin-Opener-Policy")"
  p_coep="$(header_value "$public_block" "Cross-Origin-Embedder-Policy")"
  p_corp="$(header_value "$public_block" "Cross-Origin-Resource-Policy")"
  p_cache="$(header_value "$public_block" "Cache-Control")"
  p_age="$(header_value "$public_block" "Age")"
  p_cf="$(header_value "$public_block" "cf-cache-status")"

  append_csv_row "public" "$path" "$p_status" "$p_csp" "$p_hsts" "$p_xcto" "$p_pp" "$p_coop" "$p_coep" "$p_corp" "$p_cache" "$p_age" "$p_cf"

  {
    echo "| \`$path\` | $p_status | $(presence_label "$p_csp") | $(presence_label "$p_hsts") | $(presence_label "$p_xcto") | $(presence_label "$p_pp") | $(presence_label "$p_coop") | $(presence_label "$p_coep") | $(presence_label "$p_corp") | ${p_cache:-"-"} | ${p_age:-"-"} | ${p_cf:-"-"} |"
  } >>"$summary_md"

  if [[ -n "$ORIGIN_IP" ]]; then
    origin_raw="${raw_dir}/origin_${clean_name}.headers.txt"
    fetch_headers_origin "$full_url" "$origin_raw"
    origin_block="$(extract_last_block "$origin_raw")"

    o_status="$(status_code "$origin_block")"
    o_csp="$(header_value "$origin_block" "Content-Security-Policy")"
    o_hsts="$(header_value "$origin_block" "Strict-Transport-Security")"
    o_xcto="$(header_value "$origin_block" "X-Content-Type-Options")"
    o_pp="$(header_value "$origin_block" "Permissions-Policy")"
    o_coop="$(header_value "$origin_block" "Cross-Origin-Opener-Policy")"
    o_coep="$(header_value "$origin_block" "Cross-Origin-Embedder-Policy")"
    o_corp="$(header_value "$origin_block" "Cross-Origin-Resource-Policy")"
    o_cache="$(header_value "$origin_block" "Cache-Control")"
    o_age="$(header_value "$origin_block" "Age")"
    o_cf="$(header_value "$origin_block" "cf-cache-status")"

    append_csv_row "origin" "$path" "$o_status" "$o_csp" "$o_hsts" "$o_xcto" "$o_pp" "$o_coop" "$o_coep" "$o_corp" "$o_cache" "$o_age" "$o_cf"
  fi
done

if [[ -n "$ORIGIN_IP" ]]; then
  {
    echo
    echo "## Origin Compare Results"
    echo
    echo "| Path | Status | CSP | HSTS | XCTO | Permissions | COOP | COEP | CORP | Cache-Control | Age | cf-cache-status |"
    echo "|---|---:|---|---|---|---|---|---|---|---|---|---|"
  } >>"$summary_md"

  for path in "${unique_paths[@]}"; do
    clean_name="$(sanitize_name "$path")"
    origin_raw="${raw_dir}/origin_${clean_name}.headers.txt"
    if [[ ! -f "$origin_raw" ]]; then
      continue
    fi
    origin_block="$(extract_last_block "$origin_raw")"

    o_status="$(status_code "$origin_block")"
    o_csp="$(header_value "$origin_block" "Content-Security-Policy")"
    o_hsts="$(header_value "$origin_block" "Strict-Transport-Security")"
    o_xcto="$(header_value "$origin_block" "X-Content-Type-Options")"
    o_pp="$(header_value "$origin_block" "Permissions-Policy")"
    o_coop="$(header_value "$origin_block" "Cross-Origin-Opener-Policy")"
    o_coep="$(header_value "$origin_block" "Cross-Origin-Embedder-Policy")"
    o_corp="$(header_value "$origin_block" "Cross-Origin-Resource-Policy")"
    o_cache="$(header_value "$origin_block" "Cache-Control")"
    o_age="$(header_value "$origin_block" "Age")"
    o_cf="$(header_value "$origin_block" "cf-cache-status")"

    {
      echo "| \`$path\` | $o_status | $(presence_label "$o_csp") | $(presence_label "$o_hsts") | $(presence_label "$o_xcto") | $(presence_label "$o_pp") | $(presence_label "$o_coop") | $(presence_label "$o_coep") | $(presence_label "$o_corp") | ${o_cache:-"-"} | ${o_age:-"-"} | ${o_cf:-"-"} |"
    } >>"$summary_md"
  done

  {
    echo
    echo "## Interpretation Heuristics"
    echo
    echo "- Origin emits header but public is missing: likely edge/proxy/cache behavior."
    echo "- Origin and public both missing on normal app routes: likely app/origin gap."
    echo "- Missing only on malformed scanner URLs (for example \`/%2Fimages...&w=...&q=75\`): likely scanner artifact route class."
    echo "- Missing on \`/cdn-cgi/*\`: Cloudflare-managed residual."
  } >>"$summary_md"
else
  {
    echo
    echo "## Interpretation Heuristics"
    echo
    echo "- Run again with \`ORIGIN_IP\` to classify origin-vs-edge differences."
    echo "- Without origin compare, this report proves public behavior only."
    echo "- Missing on \`/cdn-cgi/*\`: Cloudflare-managed residual."
  } >>"$summary_md"
fi

cat <<EOF >>"$summary_md"

## Artifacts

- Summary markdown: \`$summary_md\`
- Summary CSV: \`$summary_csv\`
- Raw headers directory: \`$raw_dir\`
EOF

log "header forensics complete"
log "run_dir=$run_dir"
log "summary=$summary_md"
log "csv=$summary_csv"

