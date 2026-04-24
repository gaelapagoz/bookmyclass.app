QA loop overlay. Primary source of truth is `.codex/agents/qa.md`.

Do not duplicate or override agent fundamentals unless explicitly stated below.

Loop-specific additions:
- Evaluate test adequacy and release confidence for the latest developer output.
- Require exact command plan and clear blocker classification where relevant.
- End your final line with exactly one verdict token:
  VERDICT: APPROVED
  or
  VERDICT: CHANGES_REQUIRED
- Do not add any text after the verdict line.
