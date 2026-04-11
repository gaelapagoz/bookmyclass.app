#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-bookmyclass-app}"
TARGET_WORKERS="${TARGET_WORKERS:-}"
BASE_URL="${BASE_URL:-https://uat.bookmyclass.app}"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp}"

if [[ -z "$TARGET_WORKERS" ]]; then
  cpu_count="$(nproc)"
  if [[ "$cpu_count" -gt 16 ]]; then
    TARGET_WORKERS="16"
  else
    TARGET_WORKERS="$cpu_count"
  fi
fi

[[ "$TARGET_WORKERS" =~ ^[0-9]+$ ]] || { echo "TARGET_WORKERS must be an integer" >&2; exit 1; }
[[ "$TARGET_WORKERS" -gt 0 ]] || { echo "TARGET_WORKERS must be > 0" >&2; exit 1; }

timestamp_utc="$(date -u +%Y%m%dT%H%M%SZ)"
evidence_dir="${EVIDENCE_ROOT%/}/uat-perf-${timestamp_utc}-pm2-scale"
mkdir -p "$evidence_dir"

pm2 jlist > "$evidence_dir/pm2-before.json"

pm2 scale "$APP_NAME" "$TARGET_WORKERS" | tee "$evidence_dir/pm2-scale.log"
sleep 2
pm2 jlist > "$evidence_dir/pm2-after.json"
pm2 status | tee "$evidence_dir/pm2-status.txt"

node -e '
const fs = require("fs");
const path = process.argv[1];
const app = process.argv[2];
const target = Number(process.argv[3]);
const rows = JSON.parse(fs.readFileSync(path, "utf8"));
const appRows = rows.filter((r) => r.name === app);
const online = appRows.filter((r) => r.pm2_env && r.pm2_env.status === "online").length;
const modes = [...new Set(appRows.map((r) => (r.pm2_env && r.pm2_env.exec_mode) || "unknown"))];
console.log(`APP=${app}`);
console.log(`TARGET=${target}`);
console.log(`ONLINE=${online}`);
console.log(`MODES=${modes.join(",")}`);
if (online !== target) process.exit(2);
' "$evidence_dir/pm2-after.json" "$APP_NAME" "$TARGET_WORKERS" | tee "$evidence_dir/pm2-verify.txt"

curl -sS -o /dev/null -w "url=${LOCAL_HEALTH_URL} code=%{http_code} total=%{time_total}s\n" "$LOCAL_HEALTH_URL" \
  | tee "$evidence_dir/health-local.txt"
curl -sS -o /dev/null -w "url=${BASE_URL%/}/api/health code=%{http_code} total=%{time_total}s\n" "${BASE_URL%/}/api/health" \
  | tee "$evidence_dir/health-public.txt"

echo
echo "PM2 scale complete"
echo "app=$APP_NAME target_workers=$TARGET_WORKERS"
echo "Note: PM2 IDs are not the goal; online worker count and process mode are the goal."
echo "evidence_dir=$evidence_dir"
