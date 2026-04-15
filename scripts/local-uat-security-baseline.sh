#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://uat.bookmyclass.app}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp}"
HOST_WORK_DIR="${HOST_WORK_DIR:-}"
ZAP_DOCKER_IMAGE="${ZAP_DOCKER_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
ZAP_MAX_MINUTES="${ZAP_MAX_MINUTES:-5}"
RUN_NORMALIZER="${RUN_NORMALIZER:-YES}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

log() {
  echo "[local-uat-security] $*"
}

fail() {
  echo "[local-uat-security][FAIL] $*" >&2
  exit 1
}

is_uat_like() {
  local value
  value="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == *"uat"* || "$value" == *"staging"* || "$value" == *"localhost"* || "$value" == *"127.0.0.1"* ]]
}

resolve_host_work_dir() {
  if [[ -n "$HOST_WORK_DIR" ]]; then
    echo "$HOST_WORK_DIR"
    return 0
  fi

  if pwd -W >/dev/null 2>&1; then
    pwd -W
    return 0
  fi

  pwd
}

if ! is_uat_like "$BASE_URL"; then
  fail "BASE_URL='$BASE_URL' does not look like UAT/staging/local. Refusing to run."
fi

if ! command -v docker >/dev/null 2>&1; then
  fail "docker is required on local machine."
fi

cd "$REPO_ROOT"
current_tag="$(git describe --tags --exact-match 2>/dev/null || true)"
if [[ -z "$current_tag" ]]; then
  fail "Current commit is not exactly on a tag. UAT validation must run from a git tag."
fi
current_commit="$(git rev-parse --short HEAD)"

timestamp_utc="$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="${EVIDENCE_ROOT%/}/local-uat-security-${timestamp_utc}-baseline"
mkdir -p "$run_dir"

# The ZAP Docker image writes the generated automation plan to /zap/wrk/zap.yaml.
# Create the workspace file ahead of time and mount the workspace into /zap/wrk.
workspace_dir="$(cd "$run_dir" && pwd)"
touch "$workspace_dir/zap.yaml"

pushd "$run_dir" >/dev/null
host_work_dir="$(resolve_host_work_dir)"
log "Running ZAP baseline against $BASE_URL"
log "tag=$current_tag commit=$current_commit run_dir=$run_dir workspace_dir=$workspace_dir"

start_epoch="$(date +%s)"
set +e
docker run --rm -t --user root \
  -v "${workspace_dir}:/zap/wrk:rw" \
  "$ZAP_DOCKER_IMAGE" \
  zap-baseline.py \
  -t "$BASE_URL" \
  -m "$ZAP_MAX_MINUTES" \
  -r "zap-baseline-report.html" \
  -J "zap-baseline-report.json" \
  -I 2>&1 | tee "zap-stdout.log"
zap_exit="${PIPESTATUS[0]}"
set -e
end_epoch="$(date +%s)"
popd >/dev/null

echo "$zap_exit" > "$run_dir/exit-code.txt"

cat > "$run_dir/run-meta.env" <<EOF
RUN_TYPE=local_uat_security_baseline
BASE_URL=$BASE_URL
TAG=$current_tag
COMMIT=$current_commit
ZAP_DOCKER_IMAGE=$ZAP_DOCKER_IMAGE
ZAP_MAX_MINUTES=$ZAP_MAX_MINUTES
HOST_WORK_DIR=$host_work_dir
RUN_DIR=$run_dir
START_EPOCH=$start_epoch
END_EPOCH=$end_epoch
DURATION_SECONDS=$((end_epoch-start_epoch))
ZAP_EXIT_CODE=$zap_exit
UTC_TS=$timestamp_utc
EOF

if [[ "$RUN_NORMALIZER" == "YES" ]]; then
  "$SCRIPT_DIR/local-uat-security-collect-metrics.sh" "$run_dir" 2>&1 | tee "$run_dir/normalizer.log"
fi

echo
echo "Local UAT security baseline complete"
echo "tag=$current_tag commit=$current_commit"
echo "run_dir=$run_dir"
echo "zap_exit_code=$zap_exit"

exit "$zap_exit"