#!/usr/bin/env bash
#
# Cron server install services
#
# Purpose:
# - Operational script for this repository's server/local workflows.
#
# Safety:
# - Mutating operation. Review target variables before running.
#
# Variables:
# - TARGET_ENV, SSH_HOST (or mapped host var), BASE_URL, APP_DIR, APP_NAME, plus script-specific flags.
#
# Usage:
#   TARGET_ENV=staging BASE_URL=https://demo.bookmyclass.app bash scripts/cron-server-install-services.sh
#
# Install the production root crontab entries required for BookMyClass.
# The managed maintenance cron calls the canonical /api/cron/maintenance route,
# which clears expired booking drafts, webhook receipts, cart idempotency,
# expired coupon reservations, and runs other maintenance-safe tasks.
#
# Usage:
#   sudo bash scripts/cron-server-install-services.sh
#   sudo APP_DIR=/var/www/bookmyclass BASE_URL=https://demo.bookmyclass.app bash scripts/cron-server-install-services.sh
#
# This script is idempotent. It preserves unrelated root crontab entries,
# replaces the BookMyClass managed block, and removes the obsolete daily
# /api/cron/maintenance entry when found outside the managed block.

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/bookmyclass}"
BASE_URL="${BASE_URL:-https://demo.bookmyclass.app}"
BASE_URL="${BASE_URL%/}"

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

# Initialized for safe trap cleanup under `set -u`.
current_crontab=""
filtered_crontab=""
desired_crontab=""

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

require_root() {
  if [[ "$(id -u)" != "0" ]]; then
    fail "Run this script as root, for example: sudo bash scripts/cron-server-install-services.sh"
  fi
}

validate_environment() {
  [[ -d "$APP_DIR" ]] || fail "APP_DIR does not exist: $APP_DIR"
  [[ -f "$APP_DIR/.env" ]] || fail "Missing environment file: $APP_DIR/.env"

  (
    cd "$APP_DIR"
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
    [[ -n "${CRON_SECRET:-}" ]]
  ) || fail "CRON_SECRET is missing or empty in $APP_DIR/.env"

  [[ -x "$BACKUP_SCRIPT" ]] || fail "Backup script is missing or not executable: $BACKUP_SCRIPT"
  [[ -x "$HEALTHCHECK_SCRIPT" ]] || fail "Healthcheck script is missing or not executable: $HEALTHCHECK_SCRIPT"
}

prepare_logs() {
  local owner_group="root:root"
  if getent group adm >/dev/null 2>&1; then
    owner_group="root:adm"
  fi

  touch "$MAINTENANCE_LOG" "$BACKUP_LOG" "$HEALTHCHECK_LOG"
  chown "$owner_group" "$MAINTENANCE_LOG" "$BACKUP_LOG" "$HEALTHCHECK_LOG"
  chmod 0640 "$MAINTENANCE_LOG" "$BACKUP_LOG" "$HEALTHCHECK_LOG"
}

managed_block() {
  cat <<EOF
$BEGIN_MARKER
$MAINTENANCE_CRON
$BACKUP_CRON
$HEALTHCHECK_CRON
$END_MARKER
EOF
}

filter_existing_crontab() {
  local source_file="$1"
  local target_file="$2"

  awk \
    -v begin="$BEGIN_MARKER" \
    -v end="$END_MARKER" \
    -v maintenance="$MAINTENANCE_CRON" \
    -v backup="$BACKUP_CRON" \
    -v healthcheck="$HEALTHCHECK_CRON" '
    $0 == begin { in_block = 1; next }
    $0 == end { in_block = 0; next }
    in_block { next }
    $0 == maintenance { next }
    $0 == backup { next }
    $0 == healthcheck { next }
    $0 ~ /^[[:space:]]*0[[:space:]]+3[[:space:]]+\*[[:space:]]+\*[[:space:]]+\*/ && $0 ~ /\/api\/cron\/maintenance/ { next }
    { print }
  ' "$source_file" > "$target_file"
}

reload_cron_if_available() {
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files cron.service >/dev/null 2>&1; then
      systemctl reload cron.service >/dev/null 2>&1 || systemctl restart cron.service
      return
    fi
    if systemctl list-unit-files crond.service >/dev/null 2>&1; then
      systemctl reload crond.service >/dev/null 2>&1 || systemctl restart crond.service
      return
    fi
  fi

  if command -v service >/dev/null 2>&1; then
    service cron reload >/dev/null 2>&1 || service cron restart >/dev/null 2>&1 || true
  fi
}

install_crontab() {
  current_crontab="$(mktemp)"
  filtered_crontab="$(mktemp)"
  desired_crontab="$(mktemp)"
  trap 'rm -f "${current_crontab:-}" "${filtered_crontab:-}" "${desired_crontab:-}"' EXIT

  crontab -l > "$current_crontab" 2>/dev/null || true
  filter_existing_crontab "$current_crontab" "$filtered_crontab"

  cat "$filtered_crontab" > "$desired_crontab"
  if [[ -s "$desired_crontab" ]] && [[ "$(tail -c 1 "$desired_crontab")" != "" ]]; then
    printf '\n' >> "$desired_crontab"
  fi
  printf '\n' >> "$desired_crontab"
  managed_block >> "$desired_crontab"
  printf '\n' >> "$desired_crontab"

  if cmp -s "$current_crontab" "$desired_crontab"; then
    echo "[PASS] Root crontab already contains the desired managed block."
  else
    crontab "$desired_crontab"
    reload_cron_if_available
    echo "[PASS] Installed BookMyClass managed cron block."
  fi
}

require_root
validate_environment
prepare_logs
install_crontab

echo
echo "Resulting managed cron block:"
managed_block
