#!/usr/bin/env bash

set -euo pipefail

HEALTH_URL="${HEALTH_URL:-https://demo.bookmyclass.app/api/health}"

confirm_kuma=false
confirm_backup_heartbeat=false
confirm_local_healthcheck=false
confirm_latest_backup=false
confirm_restore_proof=false

for arg in "$@"; do
  case "$arg" in
    --confirm-kuma)
      confirm_kuma=true
      ;;
    --confirm-backup-heartbeat)
      confirm_backup_heartbeat=true
      ;;
    --confirm-local-healthcheck)
      confirm_local_healthcheck=true
      ;;
    --confirm-latest-backup)
      confirm_latest_backup=true
      ;;
    --confirm-restore-proof)
      confirm_restore_proof=true
      ;;
    *)
      echo "[FAIL] Unknown flag: $arg"
      echo "Usage: bash scripts/verify-production-readiness.sh"
      echo "  --confirm-kuma"
      echo "  --confirm-backup-heartbeat"
      echo "  --confirm-local-healthcheck"
      echo "  --confirm-latest-backup"
      echo "  --confirm-restore-proof"
      exit 1
      ;;
  esac
done

missing=false

check_confirm() {
  local key="$1"
  local value="$2"

  if [[ "$value" == "true" ]]; then
    echo "[PASS] $key confirmed"
  else
    echo "[FAIL] Missing confirmation: $key"
    missing=true
  fi
}

check_confirm "--confirm-kuma" "$confirm_kuma"
check_confirm "--confirm-backup-heartbeat" "$confirm_backup_heartbeat"
check_confirm "--confirm-local-healthcheck" "$confirm_local_healthcheck"
check_confirm "--confirm-latest-backup" "$confirm_latest_backup"
check_confirm "--confirm-restore-proof" "$confirm_restore_proof"

if [[ "$missing" == "true" ]]; then
  echo "[FAIL] Production readiness verification failed: required confirmations are missing."
  exit 1
fi

status_code="$(curl -sS -o /dev/null -w "%{http_code}" "$HEALTH_URL" || true)"
if [[ "$status_code" != "200" ]]; then
  echo "[FAIL] $HEALTH_URL returned HTTP $status_code (expected 200)"
  exit 1
fi

echo "[PASS] $HEALTH_URL returned HTTP 200"
echo "[PASS] Production readiness verification passed"
