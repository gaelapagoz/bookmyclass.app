#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <feature-context-file> [max-rounds]" >&2
  exit 1
fi

FEATURE_FILE="$1"
MAX_ROUNDS="${2:-${MAX_ROUNDS:-5}}"
PLANNER_AGENT=".codex/agents/planner.md"
AUDITOR_AGENT=".codex/agents/auditor.md"
PLANNER_TEMPLATE=".codex-workflows/planner.md"
AUDITOR_TEMPLATE=".codex-workflows/auditor.md"
RUNS_DIR_BASE=".codex-workflows/runs"
CODEX_RUNNER="${CODEX_RUNNER:-codex}"
PROJECT_SKILLS_DIR="${PROJECT_SKILLS_DIR:-.codex/skills}"
GLOBAL_SKILLS_DIR="${GLOBAL_SKILLS_DIR:-/c/Users/gaela/.codex/skills}"

if [[ ! -d "$GLOBAL_SKILLS_DIR" && -d "C:/Users/gaela/.codex/skills" ]]; then
  GLOBAL_SKILLS_DIR="C:/Users/gaela/.codex/skills"
fi

extract_markdown_list_section() {
  local file_path="$1"
  local section_name="$2"
  awk -v section="$section_name" '
    BEGIN { in_section=0; found=0 }
    /^##[[:space:]]+/ {
      if (in_section==1) { exit }
      title=$0
      sub(/^##[[:space:]]+/, "", title)
      if (title==section) {
        in_section=1
        found=1
      }
      next
    }
    in_section==1 {
      if ($0 ~ /^[[:space:]]*-[[:space:]]+/) {
        line=$0
        sub(/^[[:space:]]*-[[:space:]]+/, "", line)
        gsub(/[[:space:]]+$/, "", line)
        if (length(line) > 0) {
          print line
        }
        next
      }
      if ($0 ~ /^[[:space:]]*$/) {
        next
      }
      next
    }
    END {
      if (found==0) {
        exit 3
      }
    }
  ' "$file_path"
}

resolve_skill_bundle() {
  local agent_file="$1"
  local overlay_file="$2"
  local -a declared_skills=()
  local section_output=""
  local line

  if section_output="$(extract_markdown_list_section "$agent_file" "Skills" 2>/dev/null)"; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && declared_skills+=("$line")
    done <<< "$section_output"
  else
    echo "WARNING: Agent has no ## Skills section: $agent_file" >&2
  fi

  if [[ -f "$overlay_file" ]]; then
    if section_output="$(extract_markdown_list_section "$overlay_file" "Additional Skills" 2>/dev/null)"; then
      while IFS= read -r line; do
        [[ -n "$line" ]] && declared_skills+=("$line")
      done <<< "$section_output"
    fi
  fi

  local -a resolved_skills=()
  local skill
  local seen
  local skip
  local project_path
  local global_path
  local resolved_path
  for skill in "${declared_skills[@]}"; do
    skip=0
    for seen in "${resolved_skills[@]}"; do
      if [[ "$seen" == "$skill" ]]; then
        skip=1
        break
      fi
    done
    if (( skip == 1 )); then
      continue
    fi
    resolved_skills+=("$skill")

    project_path="$PROJECT_SKILLS_DIR/$skill/SKILL.md"
    global_path="$GLOBAL_SKILLS_DIR/$skill/SKILL.md"
    if [[ -f "$project_path" ]]; then
      resolved_path="$project_path"
    elif [[ -f "$global_path" ]]; then
      resolved_path="$global_path"
    else
      echo "ERROR: Missing required skill: $skill" >&2
      echo "Expected project path: $project_path" >&2
      echo "Expected global path: $global_path" >&2
      exit 1
    fi
    printf "%s|%s\n" "$skill" "$resolved_path"
  done
}

print_skill_resolution() {
  local role="$1"
  shift
  local entries=("$@")
  echo "selected_agent[$role]=${role_agents[$role]}"
  echo "selected_overlay[$role]=${role_overlays[$role]}"
  if (( ${#entries[@]} == 0 )); then
    echo "loaded_skills[$role]=none"
    return
  fi
  local entry
  local skill_name
  local skill_path
  for entry in "${entries[@]}"; do
    skill_name="${entry%%|*}"
    skill_path="${entry#*|}"
    echo "loaded_skill[$role]=$skill_name"
    echo "skill_source[$role][$skill_name]=$skill_path"
  done
}

emit_loaded_skills_markdown() {
  local role="$1"
  shift
  local entries=("$@")
  echo "# Loaded Skills"
  echo "Role: $role"
  if (( ${#entries[@]} == 0 )); then
    echo "(none)"
    echo
    return
  fi

  local entry
  local skill_name
  local skill_path
  for entry in "${entries[@]}"; do
    skill_name="${entry%%|*}"
    skill_path="${entry#*|}"
    echo "## Skill: $skill_name"
    echo "Source: $skill_path"
    cat "$skill_path"
    echo
  done
}

if [[ ! -f "$FEATURE_FILE" ]]; then
  echo "Feature context file not found: $FEATURE_FILE" >&2
  exit 1
fi

if [[ ! -f "$PLANNER_TEMPLATE" ]]; then
  echo "Missing planner template: $PLANNER_TEMPLATE" >&2
  exit 1
fi

if [[ ! -f "$PLANNER_AGENT" ]]; then
  echo "Missing planner agent definition: $PLANNER_AGENT" >&2
  exit 1
fi

if [[ ! -f "$AUDITOR_TEMPLATE" ]]; then
  echo "Missing auditor template: $AUDITOR_TEMPLATE" >&2
  exit 1
fi

if [[ ! -f "$AUDITOR_AGENT" ]]; then
  echo "Missing auditor agent definition: $AUDITOR_AGENT" >&2
  exit 1
fi

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
skill_log="$run_dir/skill-resolution.log"

declare -A role_agents=(
  [planner]="$PLANNER_AGENT"
  [auditor]="$AUDITOR_AGENT"
)
declare -A role_overlays=(
  [planner]="$PLANNER_TEMPLATE"
  [auditor]="$AUDITOR_TEMPLATE"
)

mapfile -t planner_skill_entries < <(resolve_skill_bundle "$PLANNER_AGENT" "$PLANNER_TEMPLATE")
mapfile -t auditor_skill_entries < <(resolve_skill_bundle "$AUDITOR_AGENT" "$AUDITOR_TEMPLATE")

{
  print_skill_resolution "planner" "${planner_skill_entries[@]}"
  print_skill_resolution "auditor" "${auditor_skill_entries[@]}"
} | tee "$skill_log"

last_auditor_feedback="No prior auditor feedback."
verdict="VERDICT: CHANGES_REQUIRED"

run_codex() {
  local input_file="$1"
  local output_file="$2"

  if [[ "$CODEX_RUNNER" == "codex" ]] && ! command -v codex >/dev/null 2>&1; then
    detected_runner="$(ls -1d /c/Users/*/.vscode/extensions/openai.chatgpt-*/bin/windows-x86_64/codex.exe 2>/dev/null | sort | tail -n1 || true)"
    if [[ -n "${detected_runner:-}" ]]; then
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

  # Use non-interactive mode (`exec`) to avoid TTY requirements.
  if ! "$CODEX_RUNNER" exec --output-last-message "$output_file" - < "$input_file" >/dev/null; then
    echo "Runner failed. Check CODEX_RUNNER and logs under $run_dir" >&2
    exit 1
  fi
}

for round in $(seq 1 "$MAX_ROUNDS"); do
  round_dir="$run_dir/round-$round"
  mkdir -p "$round_dir"

  planner_prompt="$round_dir/planner-prompt.md"
  planner_output="$round_dir/planner-output.md"
  auditor_prompt="$round_dir/auditor-prompt.md"
  auditor_output="$round_dir/auditor-output.md"

  {
    echo "# Planner Agent Definition (source of truth)"
    cat "$PLANNER_AGENT"
    echo
    emit_loaded_skills_markdown "planner" "${planner_skill_entries[@]}"
    echo "# Planner Loop Overlay"
    cat "$PLANNER_TEMPLATE"
    echo
    echo "Runtime input:"
    echo "## Feature context"
    cat "$run_dir/feature-context.md"
    echo
    echo "## Auditor feedback from previous round"
    echo "$last_auditor_feedback"
    echo
    echo "Instruction: revise the plan to resolve auditor findings while keeping scope controlled."
  } > "$planner_prompt"

  run_codex "$planner_prompt" "$planner_output"

  {
    echo "# Auditor Agent Definition (source of truth)"
    cat "$AUDITOR_AGENT"
    echo
    emit_loaded_skills_markdown "auditor" "${auditor_skill_entries[@]}"
    echo "# Auditor Loop Overlay"
    cat "$AUDITOR_TEMPLATE"
    echo
    echo "Runtime input:"
    echo "## Feature context"
    cat "$run_dir/feature-context.md"
    echo
    echo "## Planner output to audit"
    cat "$planner_output"
    echo
    echo "Instruction: evaluate only this plan and return required corrections if needed."
  } > "$auditor_prompt"

  run_codex "$auditor_prompt" "$auditor_output"

  last_non_empty_line="$(awk 'NF{line=$0} END{print line}' "$auditor_output")"

  if [[ "$last_non_empty_line" == "VERDICT: APPROVED" ]]; then
    verdict="VERDICT: APPROVED"
    printf "round=%s\nverdict=%s\n" "$round" "$verdict" > "$run_dir/final-status.txt"
    echo "Approved in round $round"
    exit 0
  fi

  if [[ "$last_non_empty_line" == "VERDICT: CHANGES_REQUIRED" ]]; then
    verdict="VERDICT: CHANGES_REQUIRED"
    last_auditor_feedback="$(cat "$auditor_output")"
    continue
  fi

  verdict="VERDICT: CHANGES_REQUIRED"
  {
    echo "Auditor output did not end with a valid verdict line."
    echo "Expected final line: VERDICT: APPROVED or VERDICT: CHANGES_REQUIRED"
    echo
    cat "$auditor_output"
  } > "$round_dir/auditor-output.invalid-verdict.md"
  last_auditor_feedback="$(cat "$round_dir/auditor-output.invalid-verdict.md")"
done

printf "round=%s\nverdict=%s\n" "$MAX_ROUNDS" "$verdict" > "$run_dir/final-status.txt"
echo "Stopped after $MAX_ROUNDS rounds without approval."
exit 2
