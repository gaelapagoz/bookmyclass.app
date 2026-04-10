#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://uat.bookmyclass.app}"
STAGE_PROFILE="smoke"
K6_SCENARIO_SET="${K6_SCENARIO_SET:-full_smoke}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp}"

timestamp_utc="$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="${EVIDENCE_ROOT%/}/local-uat-perf-${timestamp_utc}-${STAGE_PROFILE}"
mkdir -p "$run_dir"

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 is required on local machine." >&2
  exit 1
fi

start_epoch="$(date +%s)"
set +e
k6 run \
  --summary-export "$run_dir/k6-summary.json" \
  -e BASE_URL="$BASE_URL" \
  -e STAGE_PROFILE="$STAGE_PROFILE" \
  -e K6_SCENARIO_SET="$K6_SCENARIO_SET" \
  k6/main.js 2>&1 | tee "$run_dir/k6-output.log"
k6_exit="${PIPESTATUS[0]}"
set -e
end_epoch="$(date +%s)"

cat > "$run_dir/run-meta.env" <<EOF
RUN_TYPE=local_k6
STAGE_PROFILE=$STAGE_PROFILE
K6_SCENARIO_SET=$K6_SCENARIO_SET
BASE_URL=$BASE_URL
START_EPOCH=$start_epoch
END_EPOCH=$end_epoch
DURATION_SECONDS=$((end_epoch-start_epoch))
K6_EXIT_CODE=$k6_exit
RUN_DIR=$run_dir
UTC_TS=$timestamp_utc
EOF

echo "k6_exit_code=$k6_exit" | tee "$run_dir/exit-code.txt"

node -e '
const fs = require("fs");
const path = process.argv[1];
const metrics = JSON.parse(fs.readFileSync(path, "utf8")).metrics || {};
const get = (n, ...keys) => {
  const metric = metrics[n];
  if (!metric || typeof metric !== "object") {
    return "NA";
  }
  const values = metric.values && typeof metric.values === "object" ? metric.values : metric;
  for (const key of keys) {
    if (key && key in values) return values[key];
  }
  return "NA";
};
console.log(`avg=${get("http_req_duration","avg")}`);
console.log(`p95=${get("http_req_duration","p(95)")}`);
console.log(`req_rate=${get("http_reqs","rate")}`);
console.log(`failed_rate=${get("http_req_failed","rate","value")}`);
' "$run_dir/k6-summary.json" | tee "$run_dir/quick-summary.txt"

echo
echo "Local UAT smoke complete"
echo "run_dir=$run_dir"
echo "k6_exit_code=$k6_exit"

exit "$k6_exit"

