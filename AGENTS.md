<!-- BEGIN:nextjs-agent-rules -->
# AGENTS.md

## Working agreement
- Follow docs priority exactly:
  1. docs/00_*
  2. docs/10_*
  3. docs/20_*
  4. docs/30_*
  5. docs/40_*
  6. docs/50_*
  7. docs/60_*
  8. docs/70_*
  9. docs/80_*
  10. docs/90_*

## Architecture rules
- Keep business logic in src/lib/*
- API routes and server actions orchestrate, they do not duplicate business rules
- Validate before mutate
- Do not assume a modeled capability is active unless confirmed in system baseline
- Prefer minimal, surgical edits
- Preserve production safety

## Validation
- Run relevant tests after changes
- Summaries must include:
  - impacted files
  - impacted services/modules
  - impacted tests
  - documentation conflicts found
<!-- END:nextjs-agent-rules -->

