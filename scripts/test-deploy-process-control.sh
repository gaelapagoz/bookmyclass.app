#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/lib/deploy-process-control.sh"

log_step() {
  echo "==> $*"
}

fail() {
  echo "[FAIL][test-deploy-process-control] $*" >&2
  exit 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  [[ "$actual" == "$expected" ]] || fail "${label}: expected ${expected}, got ${actual}"
}

assert_not_running() {
  local pid="$1"
  local label="$2"

  [[ -n "$pid" ]] || fail "${label}: missing pid"
  if kill -0 "$pid" 2>/dev/null; then
    ps -p "$pid" -o pid,ppid,pgid,stat,etime,cmd || true
    fail "${label}: process ${pid} is still running"
  fi
}

capture_rc() {
  local command_log="$TMP_DIR/command-$RANDOM.log"
  set +e
  "$@" >"$command_log" 2>&1
  local rc="$?"
  set -e
  cat "$command_log" >&2
  printf '%s\n' "$rc"
}

export DEPLOY_TIMEOUT_KILL_AFTER_SECONDS=1

success_rc="$(capture_rc deploy_run_with_timeout 5 "test success command" bash -c 'exit 0')"
assert_eq "0" "$success_rc" "successful command returns 0"

failure_rc="$(capture_rc deploy_run_with_timeout 5 "test failing command" bash -c 'exit 37')"
assert_eq "37" "$failure_rc" "failing command preserves exit code"

timeout_rc="$(capture_rc deploy_run_with_timeout 1 "test timed out command" bash -c 'sleep 10')"
assert_eq "124" "$timeout_rc" "timed-out command returns 124"

term_resistant_script="$TMP_DIR/term-resistant.sh"
cat > "$term_resistant_script" <<'SCRIPT'
#!/usr/bin/env bash
trap '' TERM
sleep 30 &
echo "$!" > "$1"
wait
SCRIPT
chmod 700 "$term_resistant_script"
term_child_pid_file="$TMP_DIR/term-child.pid"
term_rc="$(capture_rc deploy_run_with_timeout 1 "test TERM-resistant child cleanup" "$term_resistant_script" "$term_child_pid_file")"
assert_eq "124" "$term_rc" "TERM-resistant command times out"
term_child_pid="$(cat "$term_child_pid_file")"
sleep 1
assert_not_running "$term_child_pid" "TERM-resistant child force-killed"

nested_pid_file="$TMP_DIR/nested-child.pid"
nested_rc="$(capture_rc deploy_run_with_timeout 1 "test nested child cleanup" bash -c 'bash -c "sleep 30 & echo \$! > \"$1\"; wait"' _ "$nested_pid_file")"
assert_eq "124" "$nested_rc" "nested command times out"
nested_pid="$(cat "$nested_pid_file")"
sleep 1
assert_not_running "$nested_pid" "nested child process killed"

grep -q 'REMOTE_DEPLOY_TIMEOUT_SECONDS="${REMOTE_DEPLOY_TIMEOUT_SECONDS:-1500}"' "$ROOT_DIR/scripts/deploy-server-tag.sh" \
  || fail "outer deployment timeout default is not 1500 seconds"

remote_script="$TMP_DIR/remote-status.sh"
remote_log="$TMP_DIR/remote.log"
remote_status="$TMP_DIR/exit-code"
remote_pid="$TMP_DIR/pid"
cat > "$remote_script" <<'SCRIPT'
#!/usr/bin/env bash
exit 42
SCRIPT
chmod 700 "$remote_script"
(
  set +e
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -c 'pid_file="$1"; shift; printf "%s\n" "$$" > "$pid_file"; exec "$@"' _ "$remote_pid" "$remote_script" >"$remote_log" 2>&1
  else
    bash -c 'pid_file="$1"; shift; printf "%s\n" "$$" > "$pid_file"; exec "$@"' _ "$remote_pid" "$remote_script" >"$remote_log" 2>&1
  fi
  printf "%s\n" "$?" >"$remote_status"
) &
wait "$!"
assert_eq "42" "$(cat "$remote_status")" "remote exit-status file is written and propagated"

post_build_marker="$TMP_DIR/post-build-ran"
build_rc=0
deploy_run_with_timeout 5 "test build failure gate" bash -c 'exit 31' || build_rc="$?"
if [[ "$build_rc" -eq 0 ]]; then
  touch "$post_build_marker"
fi
[[ ! -e "$post_build_marker" ]] || fail "post-build stage executed after build failure"
assert_eq "31" "$build_rc" "build failure gate preserves exit code"

export DEPLOY_DIAGNOSTIC_MAX_ITERATIONS=1
deploy_start_runtime_diagnostics "test diagnostic cleanup" 1
diagnostic_pid="$DEPLOY_RUNTIME_DIAGNOSTICS_PID"
sleep 1
deploy_stop_runtime_diagnostics "$diagnostic_pid"
sleep 1
assert_not_running "$diagnostic_pid" "diagnostic background process cleaned up"
unset DEPLOY_DIAGNOSTIC_MAX_ITERATIONS

echo "[PASS] deploy process-control shell tests passed"
