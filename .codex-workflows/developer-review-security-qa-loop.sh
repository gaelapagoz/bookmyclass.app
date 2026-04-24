#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <feature-context-file> [max-rounds]" >&2
  exit 1
fi

FEATURE_FILE="$1"
MAX_ROUNDS="${2:-${MAX_ROUNDS:-5}}"
RUNS_DIR_BASE=".codex-workflows/runs"
CODEX_RUNNER="${CODEX_RUNNER:-codex}"

DEVELOPER_AGENT=".codex/agents/developer.md"
REVIEWER_AGENT=".codex/agents/reviewer.md"
SECURITY_REVIEWER_AGENT=".codex/agents/security-reviewer.md"
QA_AGENT=".codex/agents/qa.md"

DEVELOPER_OVERLAY=".codex-workflows/developer.md"
REVIEWER_OVERLAY=".codex-workflows/reviewer.md"
SECURITY_REVIEWER_OVERLAY=".codex-workflows/security-reviewer.md"
QA_OVERLAY=".codex-workflows/qa.md"

if [[ ! -f "$FEATURE_FILE" ]]; then
  echo "Feature context file not found: $FEATURE_FILE" >&2
  exit 1
fi

for required_file in \
  "$DEVELOPER_AGENT" "$REVIEWER_AGENT" "$SECURITY_REVIEWER_AGENT" "$QA_AGENT" \
  "$DEVELOPER_OVERLAY" "$REVIEWER_OVERLAY" "$SECURITY_REVIEWER_OVERLAY" "$QA_OVERLAY"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Missing required file: $required_file" >&2
    exit 1
  fi
done

if ! [[ "$MAX_ROUNDS" =~ ^[0-9]+$ ]]; then
  echo "max-rounds must be an integer" >&2
  exit 1
fi

if (( MAX_ROUNDS < 1 || MAX_ROUNDS > 5 )); then
  echo "max-rounds must be between 1 and 5" >&2
  exit 1
fi

ts="$(date -u +"%Y%m%dT%H%M%SZ")"
run_dir="$RUNS_DIR_BASE/$ts"
mkdir -p "$run_dir"
cp "$FEATURE_FILE" "$run_dir/feature-context.md"
echo "workflow=developer-review-security-qa-loop" > "$run_dir/workflow.txt"

last_reviewer_feedback="No prior reviewer feedback."
last_security_feedback="No prior security-reviewer feedback."
last_qa_feedback="No prior qa feedback."

detected_runner=""

run_codex() {
  local input_file="$1"
  local output_file="$2"

  if [[ "$CODEX_RUNNER" == "codex" ]] && ! command -v codex >/dev/null 2>&1; then
    if [[ -z "$detected_runner" ]]; then
      detected_runner="$(ls -1d /c/Users/*/.vscode/extensions/openai.chatgpt-*/bin/windows-x86_64/codex.exe 2>/dev/null | sort | tail -n1 || true)"
    fi
    if [[ -n "$detected_runner" ]]; then
      CODEX_RUNNER="$detected_runner"
    fi
  fi

  if [[ "$CODEX_RUNNER" == */* ]]; then
    if [[ ! -x "$CODEX_RUNNER" ]]; then
      echo "CODEX_RUNNER path is not executable: $CODEX_RUNNER" >&2
      exit 1
    fi
  elif ! command -v "$CODEX_RUNNER" >/dev/null 2>&1; then
    echo "CODEX runner not found: $CODEX_RUNNER" >&2
    echo "Set CODEX_RUNNER to your codex executable path." >&2
    echo "Example: export CODEX_RUNNER=/c/Users/<you>/.vscode/extensions/openai.chatgpt-*/bin/windows-x86_64/codex.exe" >&2
    exit 1
  fi

  if ! "$CODEX_RUNNER" exec --output-last-message "$output_file" - < "$input_file" >/dev/null; then
    echo "Runner failed. Check CODEX_RUNNER and logs under $run_dir" >&2
    exit 1
  fi
}

extract_verdict() {
  local output_file="$1"
  local last_non_empty_line
  last_non_empty_line="$(awk 'NF{line=$0} END{print line}' "$output_file")"
  if [[ "$last_non_empty_line" == "VERDICT: APPROVED" ]]; then
    echo "VERDICT: APPROVED"
    return 0
  fi
  if [[ "$last_non_empty_line" == "VERDICT: CHANGES_REQUIRED" ]]; then
    echo "VERDICT: CHANGES_REQUIRED"
    return 0
  fi
  echo "VERDICT: CHANGES_REQUIRED"
  return 1
}

for round in $(seq 1 "$MAX_ROUNDS"); do
  round_dir="$run_dir/round-$round"
  mkdir -p "$round_dir"

  developer_prompt="$round_dir/developer-prompt.md"
  developer_output="$round_dir/developer-output.md"
  reviewer_prompt="$round_dir/reviewer-prompt.md"
  reviewer_output="$round_dir/reviewer-output.md"
  security_prompt="$round_dir/security-reviewer-prompt.md"
  security_output="$round_dir/security-reviewer-output.md"
  qa_prompt="$round_dir/qa-prompt.md"
  qa_output="$round_dir/qa-output.md"

  {
    echo "# Developer Agent Definition (source of truth)"
    cat "$DEVELOPER_AGENT"
    echo
    echo "# Developer Loop Overlay"
    cat "$DEVELOPER_OVERLAY"
    echo
    echo "Runtime input:"
    echo "## Feature context"
    cat "$run_dir/feature-context.md"
    echo
    echo "## Reviewer feedback from previous round"
    echo "$last_reviewer_feedback"
    echo
    echo "## Security-reviewer feedback from previous round"
    echo "$last_security_feedback"
    echo
    echo "## QA feedback from previous round"
    echo "$last_qa_feedback"
    echo
    echo "Instruction: produce a revised implementation handoff that resolves all required feedback while preserving scope control."
  } > "$developer_prompt"

  run_codex "$developer_prompt" "$developer_output"

  {
    echo "# Reviewer Agent Definition (source of truth)"
    cat "$REVIEWER_AGENT"
    echo
    echo "# Reviewer Loop Overlay"
    cat "$REVIEWER_OVERLAY"
    echo
    echo "Runtime input:"
    echo "## Feature context"
    cat "$run_dir/feature-context.md"
    echo
    echo "## Developer output to review"
    cat "$developer_output"
    echo
    echo "Instruction: review this output and finish with the required verdict token."
  } > "$reviewer_prompt"

  run_codex "$reviewer_prompt" "$reviewer_output"

  {
    echo "# Security Reviewer Agent Definition (source of truth)"
    cat "$SECURITY_REVIEWER_AGENT"
    echo
    echo "# Security Reviewer Loop Overlay"
    cat "$SECURITY_REVIEWER_OVERLAY"
    echo
    echo "Runtime input:"
    echo "## Feature context"
    cat "$run_dir/feature-context.md"
    echo
    echo "## Developer output to review"
    cat "$developer_output"
    echo
    echo "Instruction: perform focused security review and finish with the required verdict token."
  } > "$security_prompt"

  run_codex "$security_prompt" "$security_output"

  {
    echo "# QA Agent Definition (source of truth)"
    cat "$QA_AGENT"
    echo
    echo "# QA Loop Overlay"
    cat "$QA_OVERLAY"
    echo
    echo "Runtime input:"
    echo "## Feature context"
    cat "$run_dir/feature-context.md"
    echo
    echo "## Developer output to review"
    cat "$developer_output"
    echo
    echo "Instruction: review test/release confidence and finish with the required verdict token."
  } > "$qa_prompt"

  run_codex "$qa_prompt" "$qa_output"

  reviewer_verdict="$(extract_verdict "$reviewer_output" || true)"
  security_verdict="$(extract_verdict "$security_output" || true)"
  qa_verdict="$(extract_verdict "$qa_output" || true)"

  {
    echo "reviewer=$reviewer_verdict"
    echo "security_reviewer=$security_verdict"
    echo "qa=$qa_verdict"
  } > "$round_dir/verdicts.txt"

  if [[ "$reviewer_verdict" == "VERDICT: APPROVED" && "$security_verdict" == "VERDICT: APPROVED" && "$qa_verdict" == "VERDICT: APPROVED" ]]; then
    {
      echo "round=$round"
      echo "verdict=VERDICT: APPROVED"
      echo "reviewer=$reviewer_verdict"
      echo "security_reviewer=$security_verdict"
      echo "qa=$qa_verdict"
    } > "$run_dir/final-status.txt"
    echo "Approved in round $round"
    exit 0
  fi

  last_reviewer_feedback="$(cat "$reviewer_output")"
  last_security_feedback="$(cat "$security_output")"
  last_qa_feedback="$(cat "$qa_output")"
done

{
  echo "round=$MAX_ROUNDS"
  echo "verdict=VERDICT: CHANGES_REQUIRED"
  echo "reviewer=$reviewer_verdict"
  echo "security_reviewer=$security_verdict"
  echo "qa=$qa_verdict"
} > "$run_dir/final-status.txt"

echo "Stopped after $MAX_ROUNDS rounds without full approval."
exit 2
