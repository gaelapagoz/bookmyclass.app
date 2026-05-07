#!/usr/bin/env bash
set -euo pipefail

# UAT operator reset helper.
# Destructive: requires CONFIRM_UAT_DB_RESET=YES.

APP_DIR="${APP_DIR:-/var/www/bookmyclass-uat}"
APP_NAME="${APP_NAME:-bookmyclass-app-uat}"
BASE_URL="${BASE_URL:-https://uat.bookmyclass.app}"
TARGET_TAG="${TARGET_TAG:-}"
CONFIRM_UAT_DB_RESET="${CONFIRM_UAT_DB_RESET:-NO}"
RUN_K6_SEED="${RUN_K6_SEED:-YES}"
RUN_K6_DISCOVER="${RUN_K6_DISCOVER:-YES}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp}"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://127.0.0.1:3000/api/health}"

timestamp_utc="$(date -u +%Y%m%dT%H%M%SZ)"
evidence_dir="${EVIDENCE_ROOT%/}/uat-perf-${timestamp_utc}-reset"
mkdir -p "$evidence_dir"

log() {
  echo "[uat-reset] $*"
}

fail() {
  echo "[uat-reset][FAIL] $*" >&2
  exit 1
}

is_uat_like() {
  local value
  value="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == *"uat"* || "$value" == *"staging"* || "$value" == *"demo.bookmyclass.app"* || "$value" == *"localhost"* || "$value" == *"127.0.0.1"* ]]
}

read_db_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "$DATABASE_URL"
    return 0
  fi

  if [[ -f "$APP_DIR/.env" ]]; then
    awk -F= '$1=="DATABASE_URL"{sub(/^DATABASE_URL=/,""); print; exit}' "$APP_DIR/.env"
    return 0
  fi

  echo ""
}

if [[ "$CONFIRM_UAT_DB_RESET" != "YES" ]]; then
  fail "Refusing destructive reset. Re-run with CONFIRM_UAT_DB_RESET=YES."
fi

if ! is_uat_like "$BASE_URL"; then
  fail "BASE_URL='$BASE_URL' does not look like UAT/staging/demo/local."
fi

cd "$APP_DIR"

db_url="$(read_db_url)"
if [[ -z "$db_url" ]]; then
  fail "DATABASE_URL is not available from env or $APP_DIR/.env."
fi
if ! is_uat_like "$db_url"; then
  fail "DATABASE_URL does not look like UAT/staging/local. Aborting."
fi

if [[ -n "$TARGET_TAG" ]]; then
  [[ "$TARGET_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-].*)?$ ]] || fail "TARGET_TAG must look like vX.Y.Z."
  log "Deploying tag $TARGET_TAG before reset."
  git fetch --all --tags | tee "$evidence_dir/git-fetch.log"
  git checkout "$TARGET_TAG" | tee "$evidence_dir/git-checkout.log"
  npm ci --include=dev | tee "$evidence_dir/npm-ci.log"
  npx prisma migrate deploy | tee "$evidence_dir/prisma-migrate-deploy.log"
  npx prisma generate | tee "$evidence_dir/prisma-generate.log"
  npm run build | tee "$evidence_dir/npm-build.log"
  pm2 restart "$APP_NAME" --update-env | tee "$evidence_dir/pm2-restart.log"
fi

current_tag="$(git describe --tags --exact-match 2>/dev/null || true)"
if [[ -z "$current_tag" ]]; then
  fail "Current commit is not exactly on a tag. UAT validation must run from a git tag."
fi

current_commit="$(git rev-parse --short HEAD)"
log "Running destructive DB reset on tag=$current_tag commit=$current_commit"

npm run db:reset | tee "$evidence_dir/db-reset.log"

if [[ "$RUN_K6_SEED" == "YES" ]]; then
  UAT_K6_SEED=1 npm run db:seed:uat:k6 | tee "$evidence_dir/db-seed-uat-k6.log"
fi

if [[ "$RUN_K6_DISCOVER" == "YES" ]]; then
  BASE_URL="$BASE_URL" npm run k6:discover:uat | tee "$evidence_dir/k6-discover-uat.log"
fi

curl -sS -o /dev/null -w "url=${LOCAL_HEALTH_URL} code=%{http_code} total=%{time_total}s\n" "$LOCAL_HEALTH_URL" \
  | tee "$evidence_dir/health-local.txt"
curl -sS -o /dev/null -w "url=${BASE_URL%/}/api/health code=%{http_code} total=%{time_total}s\n" "${BASE_URL%/}/api/health" \
  | tee "$evidence_dir/health-public.txt"
pm2 status | tee "$evidence_dir/pm2-status.txt"

cat > "$evidence_dir/run-meta.env" <<EOF
RUN_TYPE=reset
TAG=$current_tag
COMMIT=$current_commit
APP_NAME=$APP_NAME
BASE_URL=$BASE_URL
EVIDENCE_DIR=$evidence_dir
RUN_K6_SEED=$RUN_K6_SEED
RUN_K6_DISCOVER=$RUN_K6_DISCOVER
UTC_TS=$timestamp_utc
EOF

echo
echo "UAT reset complete"
echo "tag=$current_tag commit=$current_commit"
echo "evidence_dir=$evidence_dir"
