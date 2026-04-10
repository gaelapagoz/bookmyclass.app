#!/usr/bin/env bash
set -euo pipefail

EXPECTED_TAG="${1:-${EXPECTED_TAG:-}}"
REMOTE_HOST="${REMOTE_HOST:-bookmyclass-uat}"
REMOTE_USER="${REMOTE_USER:-deploy}"
APP_DIR="${APP_DIR:-/var/www/bookmyclass}"
APP_NAME="${APP_NAME:-bookmyclass-app}"
BASE_URL="${BASE_URL:-https://uat.bookmyclass.app}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp}"

if [[ -z "$EXPECTED_TAG" ]]; then
  echo "Usage: EXPECTED_TAG=vX.Y.Z bash scripts/uat-verify-tag.sh" >&2
  echo "   or: bash scripts/uat-verify-tag.sh vX.Y.Z" >&2
  exit 1
fi

if [[ ! "$EXPECTED_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-].*)?$ ]]; then
  echo "EXPECTED_TAG must match vX.Y.Z (or prerelease/build suffix)." >&2
  exit 1
fi

timestamp_utc="$(date -u +%Y%m%dT%H%M%SZ)"
evidence_dir="${EVIDENCE_ROOT%/}/manual-cd-verify-${timestamp_utc}-${EXPECTED_TAG}"
mkdir -p "$evidence_dir"

ssh_target="${REMOTE_USER}@${REMOTE_HOST}"

set +e
ssh "$ssh_target" bash -s -- "$EXPECTED_TAG" "$APP_DIR" "$APP_NAME" <<'REMOTE' 2>&1 | tee "$evidence_dir/verify.log"
set -euo pipefail
EXPECTED_TAG="$1"
APP_DIR="$2"
APP_NAME="$3"

cd "$APP_DIR"
actual_tag="$(git describe --tags --exact-match)"
if [[ "$actual_tag" != "$EXPECTED_TAG" ]]; then
  echo "[FAIL] tag mismatch expected=$EXPECTED_TAG actual=$actual_tag" >&2
  exit 2
fi

echo "tag_ok=$actual_tag"
pm2 status
curl -sS -o /dev/null -w "url=http://127.0.0.1:3000/api/health code=%{http_code} total=%{time_total}s\n" http://127.0.0.1:3000/api/health
REMOTE
remote_exit="${PIPESTATUS[0]}"
set -e

curl -sS -o /dev/null -w "url=${BASE_URL%/}/api/health code=%{http_code} total=%{time_total}s\n" "${BASE_URL%/}/api/health" \
  | tee "$evidence_dir/public-health.txt"

echo "remote_exit_code=$remote_exit" | tee "$evidence_dir/exit-code.txt"

echo
echo "UAT tag verification complete"
echo "expected_tag=$EXPECTED_TAG"
echo "evidence_dir=$evidence_dir"
echo "remote_exit_code=$remote_exit"

exit "$remote_exit"
