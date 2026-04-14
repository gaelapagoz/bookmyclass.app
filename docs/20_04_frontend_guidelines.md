# Frontend Guidelines

Purpose: document current frontend engineering constraints for this project.

## Current Frontend Stack
- Next.js App Router pages/layouts under `src/app`.
- Shared UI components under `src/components`.
- React client components used for interaction-heavy flows (booking steps, forms, dashboard interactions).

## Engineering Rules
- Keep business logic and decision rules in services (`src/lib/*`), not UI components.
- Keep security and eligibility checks server-side; frontend checks are UX only.
- Use API routes/server actions as mutation boundaries.
- Validate inputs before mutation calls.

## Routing Structure (Current)
- Route groups include `(public)`, `(protected)`, `admin`, `api`, `auth`, `m`, `teacher`.
- Protected customer routes use auth guards from `src/lib/auth/require-auth.ts`.
- Admin private routes are enforced via admin session guard.

## Testing Expectations for Frontend Work
- Use UI tests for branching states and rendering behavior.
- Use integration tests when behavior crosses route/service boundaries.
- Keep E2E focused on production-critical, release-blocking end-to-end flows.

## Canonical References
- `docs/30_01_testing_rulebook.md`
- `docs/90_01_codex_rulebook.md`
- `docs/00_01_system_baseline.md`
