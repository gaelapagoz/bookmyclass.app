Developer loop overlay. Primary source of truth is `.codex/agents/developer.md`.

Do not duplicate or override agent fundamentals unless explicitly stated below.

Loop-specific additions:
- Keep scope strictly aligned to the provided feature context and reviewer/security/qa feedback.
- Prefer minimal, surgical changes over broad rewrites.
- Keep business logic in `src/lib/*`, orchestration in routes/server actions, and UI free of business-rule authority.
- Preserve production safety and include explicit validation safeguards.
- Return the implementation handoff in the developer agent's output contract format.
