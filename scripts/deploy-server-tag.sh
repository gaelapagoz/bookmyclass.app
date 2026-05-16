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
set -euo pipefail

# Generic server tag deploy entrypoint.
# Required:
#   TARGET_ENV, SSH_HOST, RELEASE_TAG
# Safety:
#   For TARGET_ENV=production you must set CONFIRM_TARGET=production.

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
evidence_dir="${EVIDENCE_ROOT%/}/manual-cd-${timestamp_utc}-${RELEASE_TAG}"
mkdir -p "$evidence_dir"

echo "target_env=$TARGET_ENV"
echo "base_url=$BASE_URL"
echo "ssh_host=$SSH_HOST"
echo "app_dir=$APP_DIR"
echo "app_name=$APP_NAME"
echo "release_tag=$RELEASE_TAG"

ssh_target="${REMOTE_USER}@${SSH_HOST}"
remote_run_id="deploy-${TARGET_ENV}-${timestamp_utc}-${RELEASE_TAG//[^A-Za-z0-9_.-]/_}"
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

log_step() { echo; echo "==> $*"; }

clean_git_worktree_for_exact_tag() {
  log_step "sanitize git worktree before exact tag checkout"
  git status --short || true
  git diff -- > "${RUN_DIR}/remote-dirty-worktree.patch" || true
  git status --short > "${RUN_DIR}/remote-dirty-worktree.status" || true
  git reset --hard
  git clean -ffd -e .env -e .env.local -e '.env.*' -e uploads -e 'uploads/**' -e public/uploads -e 'public/uploads/**'
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

RUN_DIR="$(pwd)"
cd "$APP_DIR"
git fetch --all --tags --prune --force
clean_git_worktree_for_exact_tag
git checkout --detach "$RELEASE_TAG"

actual_head="$(git rev-parse HEAD)"
tag_commit="$(git rev-parse "$RELEASE_TAG^{commit}")"
echo "remote_head=$actual_head"
echo "target_tag_commit=$tag_commit"
[[ "$actual_head" == "$tag_commit" ]] || { echo "[FAIL][tag-resolution-mismatch]" >&2; exit 11; }
if [[ -n "$EXPECTED_SHA" && "$actual_head" != "$EXPECTED_SHA" ]]; then
  echo "[FAIL][tag-sha-mismatch] expected_sha=$EXPECTED_SHA actual_head=$actual_head" >&2
  exit 4
fi

bash "$APP_DIR/scripts/homesite-server-publish-assets.sh" "$APP_DIR" "$HOMESITE_PUBLISH_DIR" "$HOMESITE_BASE_URL"
npm ci --include=dev
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart "$APP_NAME" --update-env
npm run verify:media-runtime

local_ok=0
for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if curl_probe "$LOCAL_HEALTH_URL"; then local_ok=1; break; fi
  sleep "$HEALTH_DELAY_SECONDS"
done
[[ "$local_ok" -eq 1 ]] || exit 2

public_ok=0
public_url="${BASE_URL%/}/api/health"
for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if curl_probe "$public_url"; then public_ok=1; break; fi
  sleep "$HEALTH_DELAY_SECONDS"
done
[[ "$public_ok" -eq 1 ]] || exit 3
REMOTE_SCRIPT

ssh "$ssh_target" "chmod 700 '$remote_script'"
ssh "$ssh_target" "cat > '$remote_start'" <<'REMOTE_START'
#!/usr/bin/env bash
set -euo pipefail
REMOTE_SCRIPT="$1"; REMOTE_LOG="$2"; REMOTE_STATUS="$3"; shift 3
( set +e; "$REMOTE_SCRIPT" "$@" >"$REMOTE_LOG" 2>&1; printf "%s\n" "$?" >"$REMOTE_STATUS" ) </dev/null >/dev/null 2>&1 &
REMOTE_START
ssh "$ssh_target" "chmod 700 '$remote_start'"
ssh "$ssh_target" "'$remote_start' '$remote_script' '$remote_log' '$remote_status' '$RELEASE_TAG' '$APP_DIR' '$APP_NAME' '$HOMESITE_PUBLISH_DIR' '$BASE_URL' '$LOCAL_HEALTH_URL' '$HEALTH_ATTEMPTS' '$HEALTH_DELAY_SECONDS' '$EXPECTED_SHA' '$HOMESITE_BASE_URL'"

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
