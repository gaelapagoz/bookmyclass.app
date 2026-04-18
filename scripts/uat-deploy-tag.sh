#!/usr/bin/env bash
set -euo pipefail

TARGET_TAG="${1:-${TARGET_TAG:-}}"
REMOTE_HOST="${REMOTE_HOST:-bookmyclass-uat}"
REMOTE_USER="${REMOTE_USER:-deploy}"
APP_DIR="${APP_DIR:-/var/www/bookmyclass}"
APP_NAME="${APP_NAME:-bookmyclass-app-uat}"
HOMESITE_PUBLISH_DIR="${HOMESITE_PUBLISH_DIR:-/var/www/bookmyclass-homesite}"
BASE_URL="${BASE_URL:-https://uat.bookmyclass.app}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp}"

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

echo "Deploying tag $TARGET_TAG to UAT alias $ssh_target (user=${REMOTE_USER} host=${REMOTE_HOST})"

set +e
ssh "$ssh_target" bash -s -- "$TARGET_TAG" "$APP_DIR" "$APP_NAME" "$HOMESITE_PUBLISH_DIR" <<'REMOTE' 2>&1 | tee "$evidence_dir/deploy.log"
set -euo pipefail
TARGET_TAG="$1"
APP_DIR="$2"
APP_NAME="$3"
HOMESITE_PUBLISH_DIR="$4"

cd "$APP_DIR"
git fetch --all --tags
git checkout "$TARGET_TAG"
mkdir -p "$HOMESITE_PUBLISH_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$APP_DIR/homesite/" "$HOMESITE_PUBLISH_DIR/"
else
  cp -a "$APP_DIR/homesite/." "$HOMESITE_PUBLISH_DIR/"
fi
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart "$APP_NAME" --update-env
git describe --tags --exact-match
pm2 status
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
    echo "Local health check passed"
    break
  fi
  echo "Waiting for local app health... attempt ${attempt}/30"
  sleep 2
  if [[ ${attempt} -eq 30 ]]; then
    echo "Local health check did not become healthy within 60 seconds" >&2
    exit 1
  fi
done
REMOTE
remote_exit="${PIPESTATUS[0]}"
set -e

curl -sSf -o /dev/null -w "url=${BASE_URL%/}/api/health code=%{http_code} total=%{time_total}s\n" "${BASE_URL%/}/api/health" \
  | tee "$evidence_dir/public-health.txt"

echo "remote_exit_code=$remote_exit" | tee "$evidence_dir/exit-code.txt"

echo
echo "Manual UAT deploy complete"
echo "target_tag=$TARGET_TAG"
echo "evidence_dir=$evidence_dir"
echo "remote_exit_code=$remote_exit"

exit "$remote_exit"
