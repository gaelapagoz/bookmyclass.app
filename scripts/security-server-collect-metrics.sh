#!/usr/bin/env bash
#
# Security server collect metrics
#
# Purpose:
# - Operational script for this repository's server/local workflows.
#
# Safety:
# - Read-only checks by default.
#
# Variables:
# - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
#
# Usage:
#   TARGET_ENV=staging BASE_URL=https://demo.bookmyclass.app bash scripts/security-server-collect-metrics.sh
#
set -euo pipefail

RUN_DIR="${1:-${RUN_DIR:-}}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp}"

if [[ -z "$RUN_DIR" ]]; then
  RUN_DIR="$(ls -1dt ${EVIDENCE_ROOT%/}/server-security-*-baseline 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$RUN_DIR" || ! -d "$RUN_DIR" ]]; then
  echo "Run dir not found. Pass it as arg: scripts/security-server-collect-metrics.sh /tmp/server-security-..." >&2
  exit 1
fi

report_json="$RUN_DIR/zap-baseline-report.json"
if [[ ! -f "$report_json" ]]; then
  echo "Missing $report_json" >&2
  exit 1
fi

if [[ -f "$RUN_DIR/run-meta.env" ]]; then
  # shellcheck disable=SC1090
  source "$RUN_DIR/run-meta.env"
fi

node -e '
const fs = require("fs");

const reportPath = process.argv[1];
const runDir = process.argv[2];

const data = JSON.parse(fs.readFileSync(reportPath, "utf8"));

const flattenAlerts = (payload) => {
  if (Array.isArray(payload.alerts)) {
    return payload.alerts;
  }
  if (Array.isArray(payload.site)) {
    return payload.site.flatMap((site) => (Array.isArray(site.alerts) ? site.alerts : []));
  }
  return [];
};

const hardeningNames = new Set([
  "Missing Anti-clickjacking Header",
  "X-Content-Type-Options Header Missing",
  "Strict-Transport-Security Header Not Set",
  "Server Leaks Information via \"X-Powered-By\" HTTP Response Header Field(s)",
  "Content Security Policy (CSP) Header Not Set",
  "Permissions Policy Header Not Set",
]);

const mustReviewNames = new Set([
  "Absence of Anti-CSRF Tokens",
  "User Controllable HTML Element Attribute (Potential XSS)",
]);

const informationalPatterns = [
  /cache/i,
  /retrieved from cache/i,
  /modern web application/i,
  /non-storable content/i,
];

const pathFocusPattern = /(\/sign-in|\/sign-up|\/admin|\/payment|\/checkout|\/subscription|\/api\/checkout|\/api\/subscription)/i;
const authPattern = /(auth|authentication|session|cookie|csrf|password|credential|login|logout|token|jwt)/i;

const getName = (alert) => String(alert.alert || alert.name || "Unknown");
const getRiskCode = (alert) => {
  const value = Number(alert.riskcode ?? alert.riskCode ?? -1);
  return Number.isFinite(value) ? value : -1;
};

const getUris = (alert) => {
  const fromInstances = Array.isArray(alert.instances)
    ? alert.instances
        .map((instance) => instance && (instance.uri || instance.url))
        .filter(Boolean)
    : [];

  const topLevelUri = alert.uri || alert.url;
  const all = topLevelUri ? [topLevelUri, ...fromInstances] : fromInstances;
  return [...new Set(all.map((u) => String(u)))];
};

const hasExplicitFailStatus = (alert) => {
  const raw = [alert.status, alert.result, alert.state, alert.alertStatus]
    .filter(Boolean)
    .map((v) => String(v).toUpperCase());
  return raw.some((value) => value.includes("FAIL"));
};

const isFailFinding = (alert, riskCode) => {
  if (hasExplicitFailStatus(alert)) {
    return true;
  }
  return riskCode >= 2;
};

const classify = (alert) => {
  const name = getName(alert);
  const riskCode = getRiskCode(alert);
  const uris = getUris(alert);

  if (isFailFinding(alert, riskCode)) {
    return "release_blocker";
  }

  if (mustReviewNames.has(name)) {
    return "must_review";
  }

  const hasFocusedPath = uris.some((uri) => pathFocusPattern.test(uri));
  const isAuthRelated = authPattern.test(name);
  if (hasFocusedPath && isAuthRelated) {
    return "must_review";
  }

  if (hardeningNames.has(name)) {
    return "hardening_backlog";
  }

  if (informationalPatterns.some((pattern) => pattern.test(name))) {
    return "informational";
  }

  if (riskCode === 1) {
    return "must_review";
  }

  return "informational";
};

const alerts = flattenAlerts(data);
const findings = alerts.map((alert) => {
  const name = getName(alert);
  const riskCode = getRiskCode(alert);
  const uris = getUris(alert);
  const category = classify(alert);
  const count = Number(alert.count ?? alert.instances?.length ?? 0) || 0;

  return {
    category,
    name,
    riskCode,
    count,
    pluginId: String(alert.pluginid ?? alert.pluginId ?? "unknown"),
    confidence: String(alert.confidence ?? "unknown"),
    uris,
  };
});

const grouped = {
  release_blocker: [],
  must_review: [],
  hardening_backlog: [],
  informational: [],
};

for (const finding of findings) {
  grouped[finding.category].push(finding);
}

const summarize = (rows) => {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.name}::${row.pluginId}`;
    const existing = map.get(key) || {
      name: row.name,
      pluginId: row.pluginId,
      riskCode: row.riskCode,
      confidence: row.confidence,
      occurrences: 0,
      uris: new Set(),
    };
    existing.occurrences += row.count > 0 ? row.count : 1;
    for (const uri of row.uris) {
      existing.uris.add(uri);
    }
    map.set(key, existing);
  }

  return [...map.values()].map((value) => ({
    name: value.name,
    pluginId: value.pluginId,
    riskCode: value.riskCode,
    confidence: value.confidence,
    occurrences: value.occurrences,
    uris: [...value.uris],
  }));
};

const normalized = {
  generatedAt: new Date().toISOString(),
  sourceReport: reportPath,
  classificationRulesVersion: "v1",
  totals: {
    alerts: findings.length,
    release_blocker: grouped.release_blocker.length,
    must_review: grouped.must_review.length,
    hardening_backlog: grouped.hardening_backlog.length,
    informational: grouped.informational.length,
  },
  categories: {
    release_blocker: summarize(grouped.release_blocker),
    must_review: summarize(grouped.must_review),
    hardening_backlog: summarize(grouped.hardening_backlog),
    informational: summarize(grouped.informational),
  },
};

const outJson = `${runDir}/normalized-summary.json`;
fs.writeFileSync(outJson, JSON.stringify(normalized, null, 2));

const renderCategory = (title, items) => {
  if (!items.length) {
    return [`## ${title}`, "", "- none", ""];
  }

  const lines = [`## ${title}`, ""];
  for (const item of items) {
    const sample = item.uris.slice(0, 3).join(", ") || "no-uri-captured";
    lines.push(`- ${item.name} (pluginId=${item.pluginId}, occurrences=${item.occurrences}, riskCode=${item.riskCode}, confidence=${item.confidence})`);
    lines.push(`  sample_paths: ${sample}`);
  }
  lines.push("");
  return lines;
};

const mdLines = [
  "# Local UAT Security Baseline Summary",
  "",
  `- Generated at: ${normalized.generatedAt}`,
  `- Source report: ${reportPath}`,
  `- Total alert rows: ${normalized.totals.alerts}`,
  `- release_blocker: ${normalized.totals.release_blocker}`,
  `- must_review: ${normalized.totals.must_review}`,
  `- hardening_backlog: ${normalized.totals.hardening_backlog}`,
  `- informational: ${normalized.totals.informational}`,
  "",
  "## Gate recommendation",
  "",
  normalized.totals.release_blocker > 0
    ? "- Result: BLOCK release (release_blocker findings present)."
    : "- Result: No release_blocker findings detected by classifier.",
  "",
  ...renderCategory("release_blocker", normalized.categories.release_blocker),
  ...renderCategory("must_review", normalized.categories.must_review),
  ...renderCategory("hardening_backlog", normalized.categories.hardening_backlog),
  ...renderCategory("informational", normalized.categories.informational),
  "## Output files",
  "",
  `- ${outJson}`,
  `- ${runDir}/normalized-summary.md`,
];

fs.writeFileSync(`${runDir}/normalized-summary.md`, mdLines.join("\n"));
' "$report_json" "$RUN_DIR"

cat "$RUN_DIR/normalized-summary.md"

echo
echo "Local UAT security normalization complete"
echo "summary=$RUN_DIR/normalized-summary.md"