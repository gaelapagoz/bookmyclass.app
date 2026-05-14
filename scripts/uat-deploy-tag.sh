#!/usr/bin/env bash
set -euo pipefail

TARGET_TAG="${1:-${TARGET_TAG:-}}"
REMOTE_HOST="${REMOTE_HOST:-bookmyclass-uat}"
REMOTE_USER="${REMOTE_USER:-deploy}"
APP_DIR="${APP_DIR:-/var/www/bookmyclass}"
APP_NAME="${APP_NAME:-bookmyclass-app-uat}"
HOMESITE_PUBLISH_DIR="${HOMESITE_PUBLISH_DIR:-/var/www/bookmyclass-homesite}"
BASE_URL="${APP_BASE_URL:-${UAT_BASE_URL:-${BASE_URL:-https://demo.bookmyclass.app}}}"
HOMESITE_BASE_URL="${HOMESITE_BASE_URL:-https://bookmyclass.app}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp}"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-20}"
HEALTH_DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-5}"
EXPECTED_SHA="${EXPECTED_SHA:-}"

if [[ -z "$TARGET_TAG" ]]; then
  echo "Usage: TARGET_TAG=vX.Y.Z bash scripts/uat-deploy-tag.sh" >&2
  echo "   or: bash scripts/uat-deploy-tag.sh vX.Y.Z" >&2
  exit 1
fi

if [[ ! "$TARGET_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-].*)?$ ]]; then
  echo "TARGET_TAG must match vX.Y.Z (or prerelease/build suffix)." >&2
  exit 1
fi

timestamp_utc="$(date -u +%Y%m%dT%H%M%SZ)"
evidence_dir="${EVIDENCE_ROOT%/}/manual-cd-${timestamp_utc}-${TARGET_TAG}"
mkdir -p "$evidence_dir"

ssh_target="deploy-target"
remote_run_id="uat-deploy-${timestamp_utc}-${TARGET_TAG//[^A-Za-z0-9_.-]/_}"
remote_dir="/tmp/${remote_run_id}"
remote_script="${remote_dir}/deploy.sh"
remote_start="${remote_dir}/start.sh"
remote_log="${remote_dir}/deploy.log"
remote_status="${remote_dir}/exit-code"

echo "Deploying tag $TARGET_TAG to UAT alias $ssh_target (user=${REMOTE_USER} host=${REMOTE_HOST})"
echo "remote_run_id=$remote_run_id"

ssh "$ssh_target" "mkdir -p '$remote_dir'"

ssh "$ssh_target" "cat > '$remote_script'" <<'REMOTE_SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_TAG="$1"
APP_DIR="$2"
APP_NAME="$3"
HOMESITE_PUBLISH_DIR="$4"
BASE_URL="$5"
LOCAL_HEALTH_URL="$6"
HEALTH_ATTEMPTS="$7"
HEALTH_DELAY_SECONDS="$8"
EXPECTED_SHA="${9:-}"
HOMESITE_BASE_URL="${10:-https://bookmyclass.app}"

log_step() {
  echo
  echo "==> $*"
}

run_optional() {
  local description="$1"
  shift
  log_step "$description"
  "$@" || echo "[warn] optional command failed: $description"
}

curl_probe() {
  local url="$1"
  local body_file status total
  body_file="$(mktemp)"
  status="$(curl -sS -L --max-time 20 -o "$body_file" -w "%{http_code}" "$url" || true)"
  total="$(wc -c <"$body_file" | tr -d ' ')"
  echo "url=$url code=${status:-curl_failed} body_bytes=$total"
  if [[ -s "$body_file" ]]; then
    head -c 500 "$body_file"
    echo
  fi
  rm -f "$body_file"
  [[ "$status" == "200" ]]
}

print_failure_diagnostics() {
  local reason="${1:-unknown}"
  echo
  echo "==> failure diagnostics: $reason"
  run_optional "pm2 status" pm2 status
  run_optional "pm2 logs $APP_NAME --lines 120 --nostream" pm2 logs "$APP_NAME" --lines 120 --nostream
  run_optional "curl -i $LOCAL_HEALTH_URL" curl -i --max-time 20 "$LOCAL_HEALTH_URL"
  run_optional "curl -i ${BASE_URL%/}/api/health" curl -i -L --max-time 30 "${BASE_URL%/}/api/health"
  if command -v systemctl >/dev/null 2>&1; then
    run_optional "nginx service status" systemctl status nginx --no-pager
  fi
  if [[ -r /var/log/nginx/error.log ]]; then
    run_optional "nginx error log tail" tail -n 120 /var/log/nginx/error.log
  fi
  if [[ -r /var/log/nginx/access.log ]]; then
    run_optional "nginx access log tail" tail -n 80 /var/log/nginx/access.log
  fi
}

trap 'exit_code=$?; print_failure_diagnostics "unexpected failure at line $LINENO exit=$exit_code"; exit "$exit_code"' ERR

log_step "runtime versions"
node --version
npm --version

log_step "checkout exact tag"
cd "$APP_DIR"
git fetch --all --tags
git checkout --detach "$TARGET_TAG"
actual_head="$(git rev-parse HEAD)"
echo "remote_head=$actual_head"
git log -1 --oneline
git describe --tags --exact-match
if [[ -n "$EXPECTED_SHA" && "$actual_head" != "$EXPECTED_SHA" ]]; then
  echo "[FAIL][tag-sha-mismatch] expected_sha=$EXPECTED_SHA actual_head=$actual_head" >&2
  exit 4
fi

bash "$APP_DIR/scripts/publish-homesite-assets.sh" "$APP_DIR" "$HOMESITE_PUBLISH_DIR" "$HOMESITE_BASE_URL"

log_step "pre-build PM2 evidence"
pm2 status
pm2 describe "$APP_NAME" || echo "[warn] pm2 describe $APP_NAME failed"
if [[ "$APP_NAME" != "bookmyclass-app" ]]; then
  pm2 describe bookmyclass-app || echo "[warn] pm2 describe bookmyclass-app failed or is not present on UAT"
fi

log_step "install dependencies"
npm ci --include=dev

log_step "apply database migrations"
npx prisma migrate deploy

log_step "generate Prisma client"
npx prisma generate

log_step "build application"
npm run build

log_step "restart PM2 after successful build"
pm2 restart "$APP_NAME" --update-env

log_step "verify media runtime"
npm run verify:media-runtime

log_step "post-restart PM2 evidence"
pm2 status
pm2 describe "$APP_NAME" || echo "[warn] pm2 describe $APP_NAME failed"
if [[ "$APP_NAME" != "bookmyclass-app" ]]; then
  pm2 describe bookmyclass-app || echo "[warn] pm2 describe bookmyclass-app failed or is not present on UAT"
fi

log_step "verify local app health"
local_ok=0
for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
  echo "local_health_attempt=${attempt}/${HEALTH_ATTEMPTS}"
  if curl_probe "$LOCAL_HEALTH_URL"; then
    echo "local_health=pass"
    local_ok=1
    break
  fi
  sleep "$HEALTH_DELAY_SECONDS"
done

if [[ "$local_ok" -ne 1 ]]; then
  echo "[FAIL][app-db-pm2] local health never passed after deploy" >&2
  print_failure_diagnostics "local health failed"
  exit 2
fi

log_step "verify public UAT health after local health"
public_ok=0
public_url="${BASE_URL%/}/api/health"
for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
  echo "public_health_attempt=${attempt}/${HEALTH_ATTEMPTS}"
  if curl_probe "$public_url"; then
    echo "public_health=pass"
    public_ok=1
    break
  fi
  sleep "$HEALTH_DELAY_SECONDS"
done

if [[ "$public_ok" -ne 1 ]]; then
  echo "[FAIL][public-routing-edge] local health passed but public UAT health failed" >&2
  print_failure_diagnostics "public routing/edge health failed after local pass"
  exit 3
fi

log_step "deploy complete"
echo "target_tag=$TARGET_TAG"
echo "remote_head=$(git rev-parse HEAD)"
git log -1 --oneline
REMOTE_SCRIPT

ssh "$ssh_target" "chmod 700 '$remote_script'"

ssh "$ssh_target" "cat > '$remote_start'" <<'REMOTE_START'
#!/usr/bin/env bash
set -euo pipefail

REMOTE_SCRIPT="$1"
REMOTE_LOG="$2"
REMOTE_STATUS="$3"
shift 3

(
  set +e
  "$REMOTE_SCRIPT" "$@" >"$REMOTE_LOG" 2>&1
  printf "%s\n" "$?" >"$REMOTE_STATUS"
) </dev/null >/dev/null 2>&1 &
REMOTE_START

ssh "$ssh_target" "chmod 700 '$remote_start'"
ssh "$ssh_target" "'$remote_start' '$remote_script' '$remote_log' '$remote_status' '$TARGET_TAG' '$APP_DIR' '$APP_NAME' '$HOMESITE_PUBLISH_DIR' '$BASE_URL' '$LOCAL_HEALTH_URL' '$HEALTH_ATTEMPTS' '$HEALTH_DELAY_SECONDS' '$EXPECTED_SHA' '$HOMESITE_BASE_URL'"

last_lines=0
remote_exit=""
for poll in {1..240}; do
  current_lines="$(ssh "$ssh_target" "if [[ -f '$remote_log' ]]; then wc -l < '$remote_log'; else echo 0; fi" 2>/dev/null || echo 0)"
  current_lines="$(printf '%s' "$current_lines" | tr -d '[:space:]')"
  if [[ "${current_lines:-0}" -gt "$last_lines" ]]; then
    start_line=$((last_lines + 1))
    ssh "$ssh_target" "sed -n '${start_line},${current_lines}p' '$remote_log'" 2>/dev/null | tee -a "$evidence_dir/deploy.log" || true
    last_lines="$current_lines"
  fi

  remote_exit="$(ssh "$ssh_target" "if [[ -f '$remote_status' ]]; then cat '$remote_status'; fi" 2>/dev/null || true)"
  remote_exit="$(printf '%s' "$remote_exit" | tr -d '[:space:]')"
  if [[ -n "$remote_exit" ]]; then
    break
  fi

  sleep 5
done

if [[ -z "$remote_exit" ]]; then
  echo "[FAIL] Remote deploy did not finish before polling timeout." | tee -a "$evidence_dir/deploy.log" >&2
  ssh "$ssh_target" "tail -n 160 '$remote_log' || true" | tee -a "$evidence_dir/deploy.log"
  remote_exit=124
fi

echo "remote_exit_code=$remote_exit" | tee "$evidence_dir/exit-code.txt"
echo "remote_log=$remote_log" | tee "$evidence_dir/remote-log-path.txt"

echo
echo "Manual UAT deploy complete"
echo "target_tag=$TARGET_TAG"
echo "evidence_dir=$evidence_dir"
echo "remote_exit_code=$remote_exit"

exit "$remote_exit"
