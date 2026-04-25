# Known Non-Goals

Purpose: prevent future implementation work from assuming modeled capabilities are already active.

## Not Fully Active Today

- No-show operational flow is modeled but not confirmed as active end-to-end in runtime paths.
- Teacher route group access is enforced via `requireTeacherSession`; broader teacher operational workflows are still modeled and not fully production-ready.
- Fine-grained `ADMIN` vs `MASTER_ADMIN` separation is partial: privileged role assignment/management is enforced, while broader admin route access remains shared.

## Deferred Architecture Items

- **ARCH-03 (Phase 5)**: `ClassType` has no `serviceScope` column. Entitlement scope is derived at runtime via slug-match heuristic in `src/lib/booking/entitlement-scope.ts` (`resolveEntitlementScopeFromCategorySlug`). A misnamed slug silently assigns the wrong scope. The fix requires a Prisma migration adding `serviceScope` to `ClassType`, seed/backfill for existing rows, and updating all callers to read the column instead of inferring. This is a Phase 5 schema change — do not assume scope derivation is schema-driven until that migration lands.

## Working Rule

If a flow is modeled in schema/docs but not marked active in [00_01_system_baseline.md](/c:/Dev/studio.saas.platform/docs/00_01_system_baseline.md), treat it as not implemented for delivery planning and test expectations.

