#!/usr/bin/env bash
set -euo pipefail

TARGET_TAG="${1:-${TARGET_TAG:-}}"
REMOTE_HOST="${REMOTE_HOST:-bookmyclass-prod}"
REMOTE_USER="${REMOTE_USER:-deploy}"
APP_DIR="${APP_DIR:-/var/www/bookmyclass}"
APP_NAME="${APP_NAME:-bookmyclass-app}"
HOMESITE_PUBLISH_DIR="${HOMESITE_PUBLISH_DIR:-/var/www/bookmyclass-homesite}"
BASE_URL="${BASE_URL:-https://bookmyclass.app}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-artifacts/prod-deploy}"

if [[ -z "$TARGET_TAG" ]]; then
  echo "Usage: TARGET_TAG=vX.Y.Z bash scripts/prod-deploy-tag.sh" >&2
  echo "   or: bash scripts/prod-deploy-tag.sh vX.Y.Z" >&2
  exit 1
fi

if [[ ! "$TARGET_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-].*)?$ ]]; then
  echo "TARGET_TAG must match vX.Y.Z (or prerelease/build suffix)." >&2
  exit 1
fi

timestamp_utc="$(date -u +%Y%m%dT%H%M%SZ)"
evidence_dir="${EVIDENCE_ROOT%/}/manual-prod-${timestamp_utc}-${TARGET_TAG}"
mkdir -p "$evidence_dir"

ssh_target="deploy-target"

echo "Deploying tag $TARGET_TAG to production alias $ssh_target (user=${REMOTE_USER} host=${REMOTE_HOST})"

set +e
ssh "$ssh_target" bash -s -- "$TARGET_TAG" "$APP_DIR" "$APP_NAME" "$HOMESITE_PUBLISH_DIR" "$BASE_URL" <<'REMOTE' 2>&1 | tee "$evidence_dir/deploy.log"
set -euo pipefail
TARGET_TAG="$1"
APP_DIR="$2"
APP_NAME="$3"
HOMESITE_PUBLISH_DIR="$4"
BASE_URL="$5"
RUN_DIR="$(pwd)"

log_step() {
  echo
  echo "==> $*"
}

clean_git_worktree_for_exact_tag() {
  log_step "sanitize git worktree before exact tag checkout"
  git status --short || true
  git diff -- > "${RUN_DIR}/remote-dirty-worktree.patch" || true
  git status --short > "${RUN_DIR}/remote-dirty-worktree.status" || true
  git reset --hard
  git clean -ffd \
    -e .env \
    -e .env.local \
    -e '.env.*' \
    -e uploads \
    -e 'uploads/**' \
    -e public/uploads \
    -e 'public/uploads/**'
}

log_step "checkout exact tag"
cd "$APP_DIR"
git fetch --all --tags --prune --force
clean_git_worktree_for_exact_tag
git checkout --detach "$TARGET_TAG"
actual_head="$(git rev-parse HEAD)"
tag_commit="$(git rev-parse "$TARGET_TAG^{commit}")"
echo "remote_head=$actual_head"
echo "target_tag_commit=$tag_commit"
if [[ "$actual_head" != "$tag_commit" ]]; then
  echo "[FAIL][tag-resolution-mismatch] head=$actual_head target_tag_commit=$tag_commit" >&2
  exit 11
fi
bash "$APP_DIR/scripts/publish-homesite-assets.sh" "$APP_DIR" "$HOMESITE_PUBLISH_DIR" "$BASE_URL"
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart "$APP_NAME" --update-env
npm run verify:media-runtime
git describe --tags --exact-match
pm2 status
curl -sSf -o /dev/null -w "url=http://127.0.0.1:3000/api/health code=%{http_code} total=%{time_total}s\n" http://127.0.0.1:3000/api/health
REMOTE
remote_exit="${PIPESTATUS[0]}"
set -e

curl -sSf -o /dev/null -w "url=${BASE_URL%/}/api/health code=%{http_code} total=%{time_total}s\n" "${BASE_URL%/}/api/health" \
  | tee "$evidence_dir/public-health.txt"

echo "remote_exit_code=$remote_exit" | tee "$evidence_dir/exit-code.txt"

echo
echo "Manual production deploy complete"
echo "target_tag=$TARGET_TAG"
echo "evidence_dir=$evidence_dir"
echo "remote_exit_code=$remote_exit"

exit "$remote_exit"
