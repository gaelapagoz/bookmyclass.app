# Known Non-Goals

Purpose: prevent planning, implementation, and testing from assuming every modeled capability is already active in runtime.

## How To Read This File

- `Not Fully Active Today` lists flows that appear in code, schema, or docs but are not confirmed as fully active end-to-end.
- `Deferred Architecture Items` lists structural improvements the system still needs, but which are not yet landed as canonical runtime behavior.
- If a capability is modeled somewhere but is not confirmed as active in [00_01_system_baseline.md](/c:/Dev/studio.saas.platform/docs/00_01_system_baseline.md), treat it as not implemented for delivery planning and test expectations.

## Not Fully Active Today

- No-show operational flow is modeled but not confirmed as active end-to-end in runtime paths.
- Teacher route group access is enforced via `requireTeacherSession`, but broader teacher operational workflows are still only partially confirmed in production reality.
- Fine-grained `ADMIN` vs `MASTER_ADMIN` separation is partial: privileged role assignment/management is enforced, while broader admin route access remains shared in many runtime paths.
- Loyalty has an approved target contract in the roadmap and `docs/10_*` / `docs/20_*`, but it is still not an active runtime capability until later implementation slices land.

## Deferred Architecture Items

- **ARCH-03 (Phase 5)**: `ClassType` has no reliable schema-driven `serviceScope` contract in every production assumption. Entitlement scope has historically been derived through runtime logic in `src/lib/booking/entitlement-scope.ts` (`resolveEntitlementScopeFromCategorySlug`), where a misnamed slug can silently assign the wrong scope. The long-term fix is a Prisma-backed schema contract, backfill for existing rows, and caller updates so scope is read from canonical persisted data instead of inference.

## Working Rule

- Do not promote a modeled capability to implementation baseline unless it is also confirmed by the system baseline docs and current runtime evidence.
