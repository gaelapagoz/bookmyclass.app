#!/usr/bin/env bash
set -euo pipefail

RUN_DIR="${1:-${RUN_DIR:-}}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp}"

if [[ -z "$RUN_DIR" ]]; then
  RUN_DIR="$(ls -1dt ${EVIDENCE_ROOT%/}/local-uat-perf-* 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$RUN_DIR" || ! -d "$RUN_DIR" ]]; then
  echo "Run dir not found. Pass it as arg: scripts/local-uat-collect-metrics.sh /tmp/local-uat-perf-..." >&2
  exit 1
fi

summary_json="$RUN_DIR/k6-summary.json"
if [[ ! -f "$summary_json" ]]; then
  echo "Missing $summary_json" >&2
  exit 1
fi

timestamp_utc="$(date -u +%Y%m%dT%H%M%SZ)"
out_dir="${EVIDENCE_ROOT%/}/local-uat-perf-${timestamp_utc}-summary"
mkdir -p "$out_dir"

if [[ -f "$RUN_DIR/run-meta.env" ]]; then
  # shellcheck disable=SC1090
  source "$RUN_DIR/run-meta.env"
fi

node -e '
const fs = require("fs");
const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const m = s.metrics || {};
const get = (name, ...keys) => {
  const metric = m[name];
  if (!metric || typeof metric !== "object") {
    return "NA";
  }
  const values = metric.values && typeof metric.values === "object" ? metric.values : metric;
  for (const key of keys) {
    if (key && key in values) {
      return values[key];
    }
  }
  return "NA";
};
const lines = [
  `http_req_duration_avg=${get("http_req_duration","avg")}`,
  `http_req_duration_p50=${get("http_req_duration","p(50)","med")}`,
  `http_req_duration_p90=${get("http_req_duration","p(90)")}`,
  `http_req_duration_p95=${get("http_req_duration","p(95)")}`,
  `http_req_duration_p99=${get("http_req_duration","p(99)")}`,
  `http_reqs_rate=${get("http_reqs","rate")}`,
  `http_req_failed_rate=${get("http_req_failed","rate","value")}`,
  `booking_draft_technical_failure_rate=${get("booking_draft_technical_failure_rate","rate","value")}`,
  `booking_draft_expected_conflict_rate=${get("booking_draft_expected_conflict_rate","rate","value")}`,
];
console.log(lines.join("\n"));
' "$summary_json" > "$out_dir/metrics.env"

# shellcheck disable=SC1091
source "$out_dir/metrics.env"

cat > "$out_dir/summary.md" <<EOF
# Local UAT k6 Summary

- Run profile: ${STAGE_PROFILE:-unknown}
- Base URL: ${BASE_URL:-unknown}
- Duration seconds: ${DURATION_SECONDS:-unknown}
- Run dir: $RUN_DIR
- Summary dir: $out_dir
- k6 exit code: ${K6_EXIT_CODE:-unknown}

## k6 metrics

- http_req_duration avg: $http_req_duration_avg
- http_req_duration p50: $http_req_duration_p50
- http_req_duration p90: $http_req_duration_p90
- http_req_duration p95: $http_req_duration_p95
- http_req_duration p99: $http_req_duration_p99
- http_reqs rate: $http_reqs_rate
- http_req_failed rate: $http_req_failed_rate
- booking_draft_technical_failure_rate: $booking_draft_technical_failure_rate
- booking_draft_expected_conflict_rate: $booking_draft_expected_conflict_rate

## Raw artifacts

- k6 output log: $RUN_DIR/k6-output.log
- k6 summary json: $RUN_DIR/k6-summary.json
- run metadata: $RUN_DIR/run-meta.env
- script summary: $out_dir/summary.md
EOF

cat "$out_dir/summary.md"

echo
echo "Local metrics collection complete"
echo "summary=$out_dir/summary.md"

