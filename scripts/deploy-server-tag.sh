#!/usr/bin/env bash
#
# Deploy server tag
#
# Purpose:
# - Operational script for this repository's server/local workflows.
#
# Safety:
# - Mutating operation. Review target variables before running.
#
# Variables:
# - TARGET_ENV, SSH_HOST (or mapped host var), BASE_URL, APP_DIR, APP_NAME, plus script-specific flags.
#
# Usage:
#   TARGET_ENV=production BASE_URL=https://bookmyclass.app SSH_HOST=bookmyclass-prod RELEASE_TAG=vX.Y.Z CONFIRM_TARGET=production bash scripts/deploy-server-tag.sh
#
set -Eeuo pipefail

TARGET_ENV="${TARGET_ENV:-}"
BASE_URL="${BASE_URL:-https://demo.bookmyclass.app}"
SSH_HOST="${SSH_HOST:-${REMOTE_HOST:-}}"
APP_DIR="${APP_DIR:-/var/www/bookmyclass}"
APP_NAME="${APP_NAME:-bookmyclass-app}"
RELEASE_TAG="${RELEASE_TAG:-${1:-}}"
CONFIRM_TARGET="${CONFIRM_TARGET:-}"

REMOTE_USER="${REMOTE_USER:-deploy}"
HOMESITE_PUBLISH_DIR="${HOMESITE_PUBLISH_DIR:-/var/www/bookmyclass-homesite}"
HOMESITE_BASE_URL="${HOMESITE_BASE_URL:-https://bookmyclass.app}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp}"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-20}"
HEALTH_DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-5}"
EXPECTED_SHA="${EXPECTED_SHA:-}"
PUBLISH_HOMESITE="${PUBLISH_HOMESITE:-0}"

NPM_CI_TIMEOUT_SECONDS="${NPM_CI_TIMEOUT_SECONDS:-300}"
PRISMA_GENERATE_TIMEOUT_SECONDS="${PRISMA_GENERATE_TIMEOUT_SECONDS:-180}"
PRISMA_MIGRATE_TIMEOUT_SECONDS="${PRISMA_MIGRATE_TIMEOUT_SECONDS:-180}"
BUILD_TIMEOUT_SECONDS="${BUILD_TIMEOUT_SECONDS:-900}"
NPM_PRUNE_TIMEOUT_SECONDS="${NPM_PRUNE_TIMEOUT_SECONDS:-300}"
PM2_TIMEOUT_SECONDS="${PM2_TIMEOUT_SECONDS:-120}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"

fail() {
  echo "[FAIL][deploy-server-tag] $*" >&2
  exit 1
}

[[ -n "$TARGET_ENV" ]] || fail "TARGET_ENV is required (for example: uat or production)."
[[ -n "$SSH_HOST" ]] || fail "SSH_HOST is required."
[[ -n "$RELEASE_TAG" ]] || fail "RELEASE_TAG is required (or pass tag as arg1)."
[[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-].*)?$ ]] || fail "RELEASE_TAG must match vX.Y.Z."

if [[ "$TARGET_ENV" == "production" && "$CONFIRM_TARGET" != "production" ]]; then
  fail "Production deploy requires CONFIRM_TARGET=production."
fi

timestamp_utc="$(date -u +%Y%m%dT%H%M%SZ)"
remote_run_id="${TARGET_ENV}-deploy-${timestamp_utc}-${RELEASE_TAG//[^A-Za-z0-9_.-]/_}"
evidence_dir="${EVIDENCE_ROOT%/}/manual-cd-${timestamp_utc}-${RELEASE_TAG}"
mkdir -p "$evidence_dir"

echo "target_env=$TARGET_ENV"
echo "base_url=$BASE_URL"
echo "ssh_host=$SSH_HOST"
echo "app_dir=$APP_DIR"
echo "app_name=$APP_NAME"
echo "release_tag=$RELEASE_TAG"
echo "publish_homesite=$PUBLISH_HOMESITE"

ssh_target="${REMOTE_USER}@${SSH_HOST}"
remote_dir="/tmp/${remote_run_id}"
remote_script="${remote_dir}/deploy.sh"
remote_start="${remote_dir}/start.sh"
remote_log="${remote_dir}/deploy.log"
remote_status="${remote_dir}/exit-code"

ssh "$ssh_target" "mkdir -p '$remote_dir'"

ssh "$ssh_target" "cat > '$remote_script'" <<'REMOTE_SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_TAG="$1"
APP_DIR="$2"
APP_NAME="$3"
HOMESITE_PUBLISH_DIR="$4"
BASE_URL="$5"
LOCAL_HEALTH_URL="$6"
HEALTH_ATTEMPTS="$7"
HEALTH_DELAY_SECONDS="$8"
EXPECTED_SHA="${9:-}"
HOMESITE_BASE_URL="${10:-https://bookmyclass.app}"
PUBLISH_HOMESITE="${11:-0}"
NPM_CI_TIMEOUT_SECONDS="${12:-300}"
PRISMA_GENERATE_TIMEOUT_SECONDS="${13:-180}"
PRISMA_MIGRATE_TIMEOUT_SECONDS="${14:-180}"
BUILD_TIMEOUT_SECONDS="${15:-900}"
NPM_PRUNE_TIMEOUT_SECONDS="${16:-300}"
PM2_TIMEOUT_SECONDS="${17:-120}"
HEALTH_TIMEOUT_SECONDS="${18:-120}"

LOCK_FILE="/tmp/bookmyclass-deploy.lock"
DEPLOY_FAILED=0

log_step() { echo; echo "==> $*"; }

cleanup_children() {
  local pids=()
  mapfile -t pids < <(jobs -pr || true)
  if [[ "${#pids[@]}" -eq 0 ]]; then
    return 0
  fi

  echo "[cleanup] terminating deploy child processes: ${pids[*]}"
  kill "${pids[@]}" 2>/dev/null || true
  sleep 2
  kill -9 "${pids[@]}" 2>/dev/null || true
}

on_exit() {
  local exit_code="$?"
  if [[ "$exit_code" -ne 0 ]]; then
    DEPLOY_FAILED=1
  fi
  cleanup_children
  if [[ "$DEPLOY_FAILED" -eq 1 ]]; then
    echo "[deploy] failed; PM2 runtime left untouched by cleanup"
  fi
  exit "$exit_code"
}

trap on_exit EXIT INT TERM

run_with_timeout() {
  local timeout_seconds="$1"
  local label="$2"
  shift 2

  log_step "$label"
  echo "[cmd] $*"
  if ! timeout --foreground "${timeout_seconds}s" "$@"; then
    local rc="$?"
    if [[ "$rc" -eq 124 ]]; then
      echo "[FAIL][timeout] ${label} exceeded ${timeout_seconds}s" >&2
    else
      echo "[FAIL][command] ${label} exited with status ${rc}" >&2
    fi
    return "$rc"
  fi
}

curl_probe() {
  local url="$1"
  local body_file status total
  body_file="$(mktemp)"
  status="$(curl -sS -L --max-time 20 -o "$body_file" -w "%{http_code}" "$url" || true)"
  total="$(wc -c <"$body_file" | tr -d ' ')"
  echo "url=$url code=${status:-curl_failed} body_bytes=$total"
  rm -f "$body_file"
  [[ "$status" == "200" ]]
}

require_env_file() {
  [[ -f "$APP_DIR/.env" ]] || {
    echo "[FAIL] missing required env file: $APP_DIR/.env" >&2
    return 1
  }
}

load_env_file() {
  set -a
  # shellcheck disable=SC1091
  . "$APP_DIR/.env"
  set +a
}

print_pre_diagnostics() {
  log_step "pre-deploy diagnostics"
  echo "hostname=$(hostname)"
  echo "whoami=$(whoami)"
  date -u
  echo "release_tag=$RELEASE_TAG"
  echo "current_git_sha=$(git rev-parse HEAD || true)"
  echo "target_tag_sha=$(git rev-parse "$RELEASE_TAG^{commit}" || true)"
  echo "node_version=$(node -v || true)"
  echo "npm_version=$(npm -v || true)"
  echo "npm_omit=$(npm config get omit || true)"
  echo "npm_production=$(npm config get production || true)"
  echo "node_env=${NODE_ENV:-unset}"
  free -h || true
  df -h || true
  uptime || true
  pm2 status || true
}

clean_git_worktree_for_exact_tag() {
  log_step "sanitize git worktree before exact tag checkout"
  git status --short || true
  git diff -- > "${RUN_DIR}/remote-dirty-worktree.patch" || true
  git status --short > "${RUN_DIR}/remote-dirty-worktree.status" || true
  git reset --hard
  git clean -ffd -e .env -e .env.local -e '.env.*' -e uploads -e 'uploads/**' -e public/uploads -e 'public/uploads/**'
}

RUN_DIR="$(pwd)"
cd "$APP_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[FAIL] another deployment is running (lock: $LOCK_FILE)" >&2
  exit 90
fi
echo "[lock] acquired $LOCK_FILE"

print_pre_diagnostics

run_with_timeout 120 "fetch exact release refs" git fetch --all --tags --prune --force
clean_git_worktree_for_exact_tag
run_with_timeout 60 "checkout exact release tag" git checkout --detach "$RELEASE_TAG"

actual_head="$(git rev-parse HEAD)"
tag_commit="$(git rev-parse "$RELEASE_TAG^{commit}")"
echo "remote_head=$actual_head"
echo "target_tag_commit=$tag_commit"
[[ "$actual_head" == "$tag_commit" ]] || { echo "[FAIL][tag-resolution-mismatch]" >&2; exit 11; }
if [[ -n "$EXPECTED_SHA" && "$actual_head" != "$EXPECTED_SHA" ]]; then
  echo "[FAIL][tag-sha-mismatch] expected_sha=$EXPECTED_SHA actual_head=$actual_head" >&2
  exit 4
fi

require_env_file
load_env_file

echo "[deps] build requires temporary devDependencies; runtime will prune them before PM2 reload"
run_with_timeout "$NPM_CI_TIMEOUT_SECONDS" "install dependencies for build" npm ci --include=dev

log_step "verify vitest present during build phase"
npm ls vitest --depth=0 || true

run_with_timeout "$PRISMA_GENERATE_TIMEOUT_SECONDS" "generate prisma client" npx prisma generate
run_with_timeout "$PRISMA_MIGRATE_TIMEOUT_SECONDS" "apply prisma migrations" npx prisma migrate deploy
run_with_timeout "$BUILD_TIMEOUT_SECONDS" "build next application" npm run build

if [[ "$PUBLISH_HOMESITE" == "1" ]]; then
  run_with_timeout 180 "publish homesite assets (explicitly enabled)" bash "$APP_DIR/scripts/homesite-server-publish-assets.sh" "$APP_DIR" "$HOMESITE_PUBLISH_DIR" "$HOMESITE_BASE_URL"
else
  log_step "skip homesite asset publishing (set PUBLISH_HOMESITE=1 to enable)"
fi

run_with_timeout "$NPM_PRUNE_TIMEOUT_SECONDS" "prune devDependencies for runtime" npm prune --omit=dev

log_step "verify vitest after prune (expected missing for production runtime)"
npm ls vitest --depth=0 || true

run_with_timeout "$PM2_TIMEOUT_SECONDS" "reload pm2 app" pm2 reload "$APP_NAME" --update-env
run_with_timeout 180 "verify media runtime" npm run verify:media-runtime

log_step "post-reload pm2 status"
pm2 status || true

local_ok=0
for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if curl_probe "$LOCAL_HEALTH_URL"; then
    local_ok=1
    break
  fi
  sleep "$HEALTH_DELAY_SECONDS"
done
[[ "$local_ok" -eq 1 ]] || { echo "[FAIL] local health check failed" >&2; pm2 logs "$APP_NAME" --lines 80 --nostream || true; exit 2; }

public_ok=0
public_url="${BASE_URL%/}/api/health"
for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if curl_probe "$public_url"; then
    public_ok=1
    break
  fi
  sleep "$HEALTH_DELAY_SECONDS"
done
[[ "$public_ok" -eq 1 ]] || { echo "[FAIL] public health check failed" >&2; exit 3; }
REMOTE_SCRIPT

ssh "$ssh_target" "chmod 700 '$remote_script'"
ssh "$ssh_target" "cat > '$remote_start'" <<'REMOTE_START'
#!/usr/bin/env bash
set -euo pipefail
REMOTE_SCRIPT="$1"; REMOTE_LOG="$2"; REMOTE_STATUS="$3"; shift 3
( set +e; "$REMOTE_SCRIPT" "$@" >"$REMOTE_LOG" 2>&1; printf "%s\n" "$?" >"$REMOTE_STATUS" ) </dev/null >/dev/null 2>&1 &
REMOTE_START
ssh "$ssh_target" "chmod 700 '$remote_start'"
ssh "$ssh_target" "'$remote_start' '$remote_script' '$remote_log' '$remote_status' '$RELEASE_TAG' '$APP_DIR' '$APP_NAME' '$HOMESITE_PUBLISH_DIR' '$BASE_URL' '$LOCAL_HEALTH_URL' '$HEALTH_ATTEMPTS' '$HEALTH_DELAY_SECONDS' '$EXPECTED_SHA' '$HOMESITE_BASE_URL' '$PUBLISH_HOMESITE' '$NPM_CI_TIMEOUT_SECONDS' '$PRISMA_GENERATE_TIMEOUT_SECONDS' '$PRISMA_MIGRATE_TIMEOUT_SECONDS' '$BUILD_TIMEOUT_SECONDS' '$NPM_PRUNE_TIMEOUT_SECONDS' '$PM2_TIMEOUT_SECONDS' '$HEALTH_TIMEOUT_SECONDS'"

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
  [[ -n "$remote_exit" ]] && break
  sleep 5
done

if [[ -z "$remote_exit" ]]; then
  echo "[FAIL] Remote deploy timeout." | tee -a "$evidence_dir/deploy.log" >&2
  remote_exit=124
fi

echo "remote_exit_code=$remote_exit" | tee "$evidence_dir/exit-code.txt"
exit "$remote_exit"
