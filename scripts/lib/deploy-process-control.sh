#!/usr/bin/env bash

deploy_timeout_kill_after_seconds() {
  printf '%s\n' "${DEPLOY_TIMEOUT_KILL_AFTER_SECONDS:-30}"
}

deploy_print_runtime_diagnostics() {
  local label="${1:-runtime diagnostics}"

  echo
  echo "==> diagnostics: ${label}"
  date -u || true
  if command -v free >/dev/null 2>&1; then
    free -h || true
  else
    echo "[diagnostics] free unavailable"
  fi
  if command -v swapon >/dev/null 2>&1; then
    swapon --show || true
  else
    echo "[diagnostics] swapon unavailable"
  fi
  if command -v uptime >/dev/null 2>&1; then
    uptime || true
  else
    echo "[diagnostics] uptime unavailable"
  fi
  ps -eo pid,ppid,pgid,stat,%cpu,%mem,rss,etime,cmd --sort=-rss 2>/dev/null | head -n 40 || true
}

deploy_start_runtime_diagnostics() {
  local label="$1"
  local interval_seconds="${2:-60}"
  local max_iterations="${DEPLOY_DIAGNOSTIC_MAX_ITERATIONS:-0}"

  (
    local iteration=0
    while true; do
      deploy_print_runtime_diagnostics "$label"
      iteration=$((iteration + 1))
      if [[ "$max_iterations" -gt 0 && "$iteration" -ge "$max_iterations" ]]; then
        break
      fi
      sleep "$interval_seconds"
    done
  ) &
  DEPLOY_RUNTIME_DIAGNOSTICS_PID="$!"
}

deploy_stop_runtime_diagnostics() {
  local diagnostics_pid="${1:-}"
  [[ -n "$diagnostics_pid" ]] || return 0

  kill "$diagnostics_pid" 2>/dev/null || true
  wait "$diagnostics_pid" 2>/dev/null || true
}

deploy_collect_failure_evidence() {
  local label="$1"
  local since_utc="${2:-}"

  deploy_print_runtime_diagnostics "failure: ${label}"

  echo
  echo "==> remaining deployment/build processes"
  ps -eo pid,ppid,pgid,stat,%cpu,%mem,rss,etime,cmd --sort=-rss \
    | grep -Ei 'next build|npm run build|typescript|turbopack|deploy\.sh' \
    | grep -v grep || true

  if [[ -n "$since_utc" ]] && command -v journalctl >/dev/null 2>&1; then
    echo
    echo "==> kernel log since deployment start"
    journalctl -k --since "$since_utc" --no-pager || true

    echo
    echo "==> kernel memory pressure signals since deployment start"
    journalctl -k --since "$since_utc" --no-pager \
      | grep -Ei 'oom|out of memory|killed process|memory cgroup' || true
  fi
}

deploy_run_with_timeout() {
  local timeout_seconds="$1"
  local label="$2"
  shift 2

  log_step "$label"
  echo "[cmd] $*"

  local restore_errexit=0
  case "$-" in
    *e*) restore_errexit=1 ;;
  esac

  set +e
  timeout --signal=TERM --kill-after="$(deploy_timeout_kill_after_seconds)s" "${timeout_seconds}s" "$@"
  local rc="$?"
  if [[ "$restore_errexit" -eq 1 ]]; then
    set -e
  fi

  if [[ "$rc" -eq 0 ]]; then
    return 0
  fi

  if [[ "$rc" -eq 124 || "$rc" -eq 137 ]]; then
    echo "[FAIL][timeout] ${label} exceeded ${timeout_seconds}s (status ${rc})" >&2
    return 124
  else
    echo "[FAIL][command] ${label} exited with status ${rc}" >&2
  fi

  return "$rc"
}
