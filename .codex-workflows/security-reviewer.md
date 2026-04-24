Security reviewer loop overlay. Primary source of truth is `.codex/agents/security-reviewer.md`.

Do not duplicate or override agent fundamentals unless explicitly stated below.

Loop-specific additions:
- Focus on practical release-impacting security risks and missing safeguards in the latest developer output.
- Classify findings into required-now vs hardening-later.
- End your final line with exactly one verdict token:
  VERDICT: APPROVED
  or
  VERDICT: CHANGES_REQUIRED
- Do not add any text after the verdict line.
