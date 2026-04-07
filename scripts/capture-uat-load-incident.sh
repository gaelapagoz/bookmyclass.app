#!/usr/bin/env bash

set -uo pipefail

MODE="${1:-}"
shift || true

BASE_URL="https://uat.bookmyclass.app"
DURATION=180
INTERVAL=5
OUTPUT_ROOT="/tmp"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/capture-uat-load-incident.sh baseline [--base-url URL] [--out-root DIR]
  bash scripts/capture-uat-load-incident.sh repro [--duration SEC] [--interval SEC] [--base-url URL] [--out-root DIR]

Examples:
  bash scripts/capture-uat-load-incident.sh baseline
  bash scripts/capture-uat-load-incident.sh repro --duration 180
  BASE_URL=https://uat.bookmyclass.app bash scripts/capture-uat-load-incident.sh repro --duration 300 --interval 5
USAGE
}

if [[ -z "$MODE" ]]; then
  usage
  exit 1
fi

if [[ "$MODE" != "baseline" && "$MODE" != "repro" ]]; then
  echo "[FAIL] Unknown mode: $MODE"
  usage
  exit 1
fi

if [[ -n "${BASE_URL:-}" ]]; then
  BASE_URL="${BASE_URL}"
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration)
      DURATION="${2:-}"
      shift 2
      ;;
    --interval)
      INTERVAL="${2:-}"
      shift 2
      ;;
    --base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --out-root)
      OUTPUT_ROOT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[FAIL] Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

is_int() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

if ! is_int "$DURATION" || [[ "$DURATION" -le 0 ]]; then
  echo "[FAIL] --duration must be a positive integer. Got: $DURATION"
  exit 1
fi

if ! is_int "$INTERVAL" || [[ "$INTERVAL" -le 0 ]]; then
  echo "[FAIL] --interval must be a positive integer. Got: $INTERVAL"
  exit 1
fi

if ! command -v date >/dev/null 2>&1; then
  echo "[FAIL] date command is required."
  exit 1
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
INCIDENT_DIR="${OUTPUT_ROOT%/}/uat-load-incident-${TS}"
mkdir -p "$INCIDENT_DIR"

META_FILE="$INCIDENT_DIR/meta.txt"
WARN_FILE="$INCIDENT_DIR/warnings.txt"

touch "$WARN_FILE"

warn() {
  local message="$1"
  echo "[WARN] $message" | tee -a "$WARN_FILE" >&2
}

log() {
  echo "[INFO] $1"
}

run_capture() {
  local out_file="$1"
  shift
  local label="$1"
  shift

  {
    echo "# label: $label"
    echo "# captured_at_utc: $(date -u --iso-8601=seconds)"
    echo "# command: $*"
    echo
    "$@"
  } >"$out_file" 2>&1

  local rc=$?
  if [[ $rc -ne 0 ]]; then
    warn "$label failed (exit=$rc). See: $out_file"
  fi
}

capture_if_cmd() {
  local cmd="$1"
  local out_file="$2"
  local label="$3"
  shift 3
  if command -v "$cmd" >/dev/null 2>&1; then
    run_capture "$out_file" "$label" "$@"
  else
    warn "Command '$cmd' not available. Skipping $label."
    echo "command '$cmd' not available" >"$out_file"
  fi
}

append_meta() {
  local key="$1"
  local value="$2"
  echo "$key=$value" >>"$META_FILE"
}

append_meta "mode" "$MODE"
append_meta "start_utc" "$(date -u --iso-8601=seconds)"
append_meta "base_url" "$BASE_URL"
append_meta "duration_seconds" "$DURATION"
append_meta "interval_seconds" "$INTERVAL"
append_meta "incident_dir" "$INCIDENT_DIR"
append_meta "hostname" "$(hostname 2>/dev/null || echo unknown)"
append_meta "runner_user" "$(id -un 2>/dev/null || echo unknown)"

collect_core() {
  run_capture "$INCIDENT_DIR/uname.txt" "uname" uname -a
  run_capture "$INCIDENT_DIR/uptime.txt" "uptime" uptime
  run_capture "$INCIDENT_DIR/free.txt" "free" free -h
  run_capture "$INCIDENT_DIR/df.txt" "df" df -h
  run_capture "$INCIDENT_DIR/loadavg.txt" "loadavg" cat /proc/loadavg
  run_capture "$INCIDENT_DIR/top.txt" "top" bash -lc "top -b -n 1 | head -n 40"
}

collect_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    run_capture "$INCIDENT_DIR/pm2.status.txt" "pm2 status" pm2 status
    run_capture "$INCIDENT_DIR/pm2.describe.bookmyclass-app.txt" "pm2 describe bookmyclass-app" pm2 describe bookmyclass-app
    run_capture "$INCIDENT_DIR/pm2.logs.bookmyclass-app.txt" "pm2 logs bookmyclass-app" pm2 logs bookmyclass-app --lines 300 --nostream
    return
  fi

  if command -v sudo >/dev/null 2>&1 && id deploy >/dev/null 2>&1; then
    run_capture "$INCIDENT_DIR/pm2.status.txt" "pm2 status as deploy" sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 status
    run_capture "$INCIDENT_DIR/pm2.describe.bookmyclass-app.txt" "pm2 describe bookmyclass-app as deploy" sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 describe bookmyclass-app
    run_capture "$INCIDENT_DIR/pm2.logs.bookmyclass-app.txt" "pm2 logs bookmyclass-app as deploy" sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 logs bookmyclass-app --lines 300 --nostream
    return
  fi

  warn "pm2 not available in PATH and deploy/pm2 sudo fallback unavailable."
  echo "pm2 unavailable" >"$INCIDENT_DIR/pm2.status.txt"
  echo "pm2 unavailable" >"$INCIDENT_DIR/pm2.describe.bookmyclass-app.txt"
  echo "pm2 unavailable" >"$INCIDENT_DIR/pm2.logs.bookmyclass-app.txt"
}

collect_nginx() {
  local found=0
  if [[ -f /var/log/nginx/access.log ]]; then
    found=1
    run_capture "$INCIDENT_DIR/nginx.access.tail.txt" "nginx access tail" tail -n 2000 /var/log/nginx/access.log
  fi
  if [[ -f /var/log/nginx/error.log ]]; then
    found=1
    run_capture "$INCIDENT_DIR/nginx.error.tail.txt" "nginx error tail" tail -n 2000 /var/log/nginx/error.log
  fi

  if [[ $found -eq 0 ]]; then
    warn "nginx logs not found under /var/log/nginx."
    echo "nginx logs not found" >"$INCIDENT_DIR/nginx.logs.note.txt"
  fi
}

collect_netdata() {
  capture_if_cmd systemctl "$INCIDENT_DIR/netdata.systemctl.status.txt" "systemctl status netdata" systemctl status netdata --no-pager
  capture_if_cmd journalctl "$INCIDENT_DIR/netdata.journal.txt" "journalctl -u netdata" journalctl -u netdata --since "2 hours ago" --no-pager
}

collect_kernel_oom() {
  if command -v dmesg >/dev/null 2>&1; then
    run_capture "$INCIDENT_DIR/dmesg.oom.txt" "dmesg oom signals" bash -lc "dmesg -T | egrep -i 'oom|out of memory|killed process|netdata|node|postgres|nginx' || true"
  else
    warn "dmesg command not available."
    echo "dmesg unavailable" >"$INCIDENT_DIR/dmesg.oom.txt"
  fi
}

PG_CONTAINER=""
collect_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    warn "docker command not available."
    echo "docker unavailable" >"$INCIDENT_DIR/docker.note.txt"
    return
  fi

  run_capture "$INCIDENT_DIR/docker.ps.txt" "docker ps" docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
  run_capture "$INCIDENT_DIR/docker.stats.txt" "docker stats" docker stats --no-stream

  PG_CONTAINER="$(docker ps --format '{{.Names}} {{.Image}}' | awk 'BEGIN{IGNORECASE=1} /postgres/{print $1; exit}')"
  if [[ -n "$PG_CONTAINER" ]]; then
    append_meta "postgres_container_detected" "$PG_CONTAINER"
    run_capture "$INCIDENT_DIR/postgres.container.logs.txt" "docker logs postgres container" docker logs --since 2h "$PG_CONTAINER"
  else
    warn "No running postgres container discovered by name/image pattern."
    echo "postgres container not discovered" >"$INCIDENT_DIR/postgres.container.note.txt"
  fi
}

collect_health_probes() {
  local external_url="${BASE_URL%/}/api/health"
  local local_url="http://127.0.0.1:3000/api/health"

  if command -v curl >/dev/null 2>&1; then
    run_capture "$INCIDENT_DIR/health.external.txt" "external health probe" \
      curl -sS -o /dev/null -w "url=${external_url} code=%{http_code} total=%{time_total}s connect=%{time_connect}s ttfb=%{time_starttransfer}s\n" "$external_url"

    run_capture "$INCIDENT_DIR/health.local.txt" "local health probe" \
      curl -sS -o /dev/null -w "url=${local_url} code=%{http_code} total=%{time_total}s connect=%{time_connect}s ttfb=%{time_starttransfer}s\n" "$local_url"
  else
    warn "curl not available; health probes skipped."
    echo "curl unavailable" >"$INCIDENT_DIR/health.external.txt"
    echo "curl unavailable" >"$INCIDENT_DIR/health.local.txt"
  fi
}

collect_db_queries() {
  local db_note="$INCIDENT_DIR/db.note.txt"

  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL not present in environment; DB queries skipped." >"$db_note"
    append_meta "db_queries" "skipped_no_database_url"
    return
  fi

  if ! command -v psql >/dev/null 2>&1; then
    echo "DATABASE_URL present but psql command not available; DB queries skipped." >"$db_note"
    append_meta "db_queries" "skipped_no_psql"
    return
  fi

  append_meta "db_queries" "attempted"

  local psql_base=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1)

  run_capture "$INCIDENT_DIR/db.connections.summary.txt" "db connections summary" \
    "${psql_base[@]}" -c "select datname, usename, application_name, state, count(*) as cnt from pg_stat_activity group by 1,2,3,4 order by cnt desc;"

  run_capture "$INCIDENT_DIR/db.connections.active_count.txt" "db active connection count" \
    "${psql_base[@]}" -c "select count(*) as active_connections from pg_stat_activity;"

  run_capture "$INCIDENT_DIR/db.long_running_queries.txt" "db long running queries" \
    "${psql_base[@]}" -c "select pid, usename, application_name, state, wait_event_type, wait_event, now() - query_start as duration, left(query, 500) as query from pg_stat_activity where state <> 'idle' order by duration desc limit 40;"

  run_capture "$INCIDENT_DIR/db.blocked_queries.txt" "db blocked queries" \
    "${psql_base[@]}" -c "select a.pid as blocked_pid, pg_blocking_pids(a.pid) as blocking_pids, now() - a.query_start as blocked_for, left(a.query, 500) as blocked_query from pg_stat_activity a where cardinality(pg_blocking_pids(a.pid)) > 0 order by blocked_for desc;"

  run_capture "$INCIDENT_DIR/db.lock_pressure.txt" "db lock pressure" \
    "${psql_base[@]}" -c "select mode, granted, count(*) as cnt from pg_locks group by 1,2 order by cnt desc;"

  run_capture "$INCIDENT_DIR/db.pg_stat_statements.check.txt" "db pg_stat_statements availability" \
    "${psql_base[@]}" -c "select extname from pg_extension where extname='pg_stat_statements';"

  if grep -qi "pg_stat_statements" "$INCIDENT_DIR/db.pg_stat_statements.check.txt" 2>/dev/null; then
    run_capture "$INCIDENT_DIR/db.pg_stat_statements.top.txt" "db pg_stat_statements top" \
      "${psql_base[@]}" -c "select calls, round(total_exec_time::numeric,2) as total_ms, round(mean_exec_time::numeric,2) as mean_ms, rows, left(query, 500) as query from pg_stat_statements order by total_exec_time desc limit 30;"
  else
    echo "pg_stat_statements extension not available; top statement capture skipped." >"$INCIDENT_DIR/db.pg_stat_statements.top.txt"
  fi
}

collect_sampler() {
  local total_seconds="$1"
  local interval_seconds="$2"
  local samples=$(( (total_seconds + interval_seconds - 1) / interval_seconds ))
  local out="$INCIDENT_DIR/repro.sampler.txt"

  {
    echo "# sampler_start_utc=$(date -u --iso-8601=seconds)"
    echo "# duration_seconds=$total_seconds"
    echo "# interval_seconds=$interval_seconds"

    for ((i=1; i<=samples; i++)); do
      echo
      echo "===== sample=$i ts_utc=$(date -u --iso-8601=seconds) ====="
      uptime || true
      echo
      free -m 2>/dev/null | sed -n '1,3p' || true
      echo
      vmstat 1 2 2>/dev/null | tail -1 || vmstat 2>/dev/null | tail -1 || true
      echo
      ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%cpu 2>/dev/null | head -n 20 || true

      if command -v docker >/dev/null 2>&1 && [[ -n "$PG_CONTAINER" ]]; then
        echo
        docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}' "$PG_CONTAINER" 2>/dev/null || true
      fi

      sleep "$interval_seconds"
    done

    echo
    echo "# sampler_end_utc=$(date -u --iso-8601=seconds)"
  } >"$out" 2>&1
}

log "Incident capture mode: $MODE"
log "Output directory: $INCIDENT_DIR"

collect_core
collect_pm2
collect_nginx
collect_netdata
collect_kernel_oom
collect_docker
collect_health_probes
collect_db_queries

if [[ "$MODE" == "repro" ]]; then
  log "Starting sampler loop for $DURATION seconds (interval=$INTERVAL sec)."
  collect_sampler "$DURATION" "$INTERVAL"
fi

append_meta "end_utc" "$(date -u --iso-8601=seconds)"

log "Capture complete."
log "Incident directory: $INCIDENT_DIR"
log "Warnings file: $WARN_FILE"

echo
printf 'NEXT: archive with\n  tar -czf "%s.tar.gz" -C "%s" "%s"\n' \
  "$INCIDENT_DIR" "$(dirname "$INCIDENT_DIR")" "$(basename "$INCIDENT_DIR")"
