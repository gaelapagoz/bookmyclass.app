Reviewer loop overlay. Primary source of truth is `.codex/agents/reviewer.md`.

Do not duplicate or override agent fundamentals unless explicitly stated below.

Loop-specific additions:
- Audit only the latest developer output in the current round.
- Provide actionable findings with concrete file/module guidance.
- End your final line with exactly one verdict token:
  VERDICT: APPROVED
  or
  VERDICT: CHANGES_REQUIRED
- Do not add any text after the verdict line.
