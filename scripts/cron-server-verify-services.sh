#!/usr/bin/env bash
#
# Cron server verify services
#
# Purpose:
# - Operational script for this repository's server/local workflows.
#
# Safety:
# - Read-only checks by default.
#
# Variables:
# - TARGET_ENV, SSH_HOST (or mapped host var), BASE_URL, APP_DIR, APP_NAME, plus script-specific flags.
#
# Usage:
#   TARGET_ENV=staging BASE_URL=https://demo.bookmyclass.app bash scripts/cron-server-verify-services.sh
#
# Verify the production root crontab entries required for BookMyClass.
# The managed maintenance cron targets the canonical /api/cron/maintenance
# route, including expired coupon reservation cleanup with the existing
# booking/webhook/cart maintenance responsibilities.
#
# Usage:
#   sudo bash scripts/cron-server-verify-services.sh
#   sudo APP_DIR=/var/www/bookmyclass BASE_URL=https://demo.bookmyclass.app bash scripts/cron-server-verify-services.sh
#   sudo RUN_BACKUP_CHECK=1 bash scripts/cron-server-verify-services.sh
#
# The DB backup script is not run by default because it can be expensive.

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/bookmyclass}"
BASE_URL="${BASE_URL:-https://demo.bookmyclass.app}"
BASE_URL="${BASE_URL%/}"
RUN_BACKUP_CHECK="${RUN_BACKUP_CHECK:-0}"

BEGIN_MARKER="# BEGIN BOOKMYCLASS MANAGED CRON"
END_MARKER="# END BOOKMYCLASS MANAGED CRON"

BACKUP_SCRIPT="/usr/local/bin/bookmyclass-db-backup-run.sh"
HEALTHCHECK_SCRIPT="/usr/local/bin/bookmyclass-healthcheck.sh"

MAINTENANCE_LOG="/var/log/bookmyclass-maintenance.log"
BACKUP_LOG="/var/log/bookmyclass-db-backup.log"
HEALTHCHECK_LOG="/var/log/bookmyclass-healthcheck.log"

MAINTENANCE_CRON="*/5 * * * * cd $APP_DIR && set -a && . ./.env && set +a && response=\$(curl -fsS -H \"Authorization: Bearer \$CRON_SECRET\" $BASE_URL/api/cron/maintenance) && printf '%s\n' \"\$response\" >> $MAINTENANCE_LOG && printf '%s' \"\$response\" | grep -q '\"ok\":true'"
BACKUP_CRON="30 2 * * * $BACKUP_SCRIPT >> $BACKUP_LOG 2>&1"
HEALTHCHECK_CRON="*/5 * * * * $HEALTHCHECK_SCRIPT >> $HEALTHCHECK_LOG 2>&1"

failed=0

pass() {
  echo "[PASS] $*"
}

fail() {
  echo "[FAIL] $*"
  failed=1
}

suggest_next_commands() {
  cat <<EOF

Suggested next commands:
  sudo bash scripts/cron-server-install-services.sh
  sudo bash scripts/cron-server-verify-services.sh
  sudo crontab -l
  sudo systemctl status cron --no-pager
  sudo tail -n 50 $MAINTENANCE_LOG
  sudo tail -n 50 $BACKUP_LOG
  sudo tail -n 50 $HEALTHCHECK_LOG
EOF
}

require_root() {
  if [[ "$(id -u)" == "0" ]]; then
    pass "Running as root"
  else
    fail "Run this script as root, for example: sudo bash scripts/cron-server-verify-services.sh"
  fi
}

check_cron_service() {
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet cron.service 2>/dev/null || systemctl is-active --quiet crond.service 2>/dev/null; then
      pass "Cron service is active"
    else
      fail "Cron service is not active"
    fi
    return
  fi

  if pgrep -x cron >/dev/null 2>&1 || pgrep -x crond >/dev/null 2>&1; then
    pass "Cron process is active"
  else
    fail "Cron service/process could not be verified"
  fi
}

root_crontab() {
  crontab -l 2>/dev/null || true
}

managed_block_from() {
  awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
    $0 == begin { in_block = 1 }
    in_block { print }
    $0 == end { in_block = 0 }
  '
}

outside_managed_block_from() {
  awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
    $0 == begin { in_block = 1; next }
    $0 == end { in_block = 0; next }
    !in_block { print }
  '
}

line_count() {
  local line="$1"
  local input="$2"
  awk -v expected="$line" '$0 == expected { count++ } END { print count + 0 }' "$input"
}

check_crontab_entries() {
  local crontab_file
  local managed_file
  local outside_file
  local count

  crontab_file="$(mktemp)"
  managed_file="$(mktemp)"
  outside_file="$(mktemp)"
  root_crontab > "$crontab_file"
  managed_block_from < "$crontab_file" > "$managed_file"
  outside_managed_block_from < "$crontab_file" > "$outside_file"

  if grep -Fxq "$BEGIN_MARKER" "$managed_file" && grep -Fxq "$END_MARKER" "$managed_file"; then
    pass "Root crontab contains the managed block"
  else
    fail "Root crontab does not contain the managed BookMyClass block"
  fi

  for cron_line in "$MAINTENANCE_CRON" "$BACKUP_CRON" "$HEALTHCHECK_CRON"; do
    count="$(line_count "$cron_line" "$crontab_file")"
    if [[ "$count" == "1" ]]; then
      pass "Cron entry is present exactly once: $cron_line"
    else
      fail "Cron entry count is $count, expected 1: $cron_line"
    fi
  done

  if awk '/^[[:space:]]*0[[:space:]]+3[[:space:]]+\*[[:space:]]+\*[[:space:]]+\*/ && /\/api\/cron\/maintenance/ { found = 1 } END { exit found ? 0 : 1 }' "$outside_file"; then
    fail "Obsolete daily maintenance cron still exists outside the managed block"
  else
    pass "Obsolete daily maintenance cron is absent outside the managed block"
  fi

  rm -f "$crontab_file" "$managed_file" "$outside_file"
}

check_app_environment() {
  if [[ -d "$APP_DIR" ]]; then
    pass "APP_DIR exists: $APP_DIR"
  else
    fail "APP_DIR does not exist: $APP_DIR"
  fi

  if [[ -f "$APP_DIR/.env" ]]; then
    pass "APP_DIR/.env exists"
  else
    fail "Missing APP_DIR/.env"
    return
  fi

  if (
    cd "$APP_DIR"
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
    [[ -n "${CRON_SECRET:-}" ]]
  ); then
    pass "CRON_SECRET is present"
  else
    fail "CRON_SECRET is missing or empty"
  fi
}

check_scripts() {
  if [[ -x "$BACKUP_SCRIPT" ]]; then
    pass "Backup script exists and is executable: $BACKUP_SCRIPT"
  else
    fail "Backup script is missing or not executable: $BACKUP_SCRIPT"
  fi

  if [[ -x "$HEALTHCHECK_SCRIPT" ]]; then
    pass "Healthcheck script exists and is executable: $HEALTHCHECK_SCRIPT"
  else
    fail "Healthcheck script is missing or not executable: $HEALTHCHECK_SCRIPT"
  fi
}

check_logs() {
  local log_file
  for log_file in "$MAINTENANCE_LOG" "$BACKUP_LOG" "$HEALTHCHECK_LOG"; do
    if [[ -f "$log_file" && -w "$log_file" ]]; then
      pass "Log file exists and is writable by root: $log_file"
    else
      fail "Log file is missing or not writable by root: $log_file"
    fi
  done
}

check_endpoints() {
  local maintenance_response

  if maintenance_response="$(
    cd "$APP_DIR" && set -a && . ./.env && set +a && curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$BASE_URL/api/cron/maintenance"
  )" && printf '%s' "$maintenance_response" | grep -q '"ok":true'; then
    pass "Maintenance endpoint returned success"
  else
    fail "Maintenance endpoint check failed: $BASE_URL/api/cron/maintenance${maintenance_response:+ response=$maintenance_response}"
  fi

  if curl -fsS "$BASE_URL/api/health" >/dev/null; then
    pass "Health endpoint returned success"
  else
    fail "Health endpoint check failed: $BASE_URL/api/health"
  fi
}

check_optional_backup() {
  if [[ "$RUN_BACKUP_CHECK" == "1" ]]; then
    if "$BACKUP_SCRIPT"; then
      pass "Manual DB backup check completed"
    else
      fail "Manual DB backup check failed"
    fi
  else
    pass "Skipped DB backup execution; set RUN_BACKUP_CHECK=1 to run it manually"
  fi
}

require_root
check_cron_service
check_crontab_entries
check_app_environment
check_scripts
check_logs
check_endpoints
check_optional_backup

if [[ "$failed" != "0" ]]; then
  suggest_next_commands
  exit 1
fi

echo
echo "[PASS] Production cron verification passed"
