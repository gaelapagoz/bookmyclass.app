# Known Non-Goals

Purpose: prevent future implementation work from assuming modeled capabilities are already active.

## Not Fully Active Today

- No-show operational flow is modeled but not confirmed as active end-to-end in runtime paths.
- Teacher route group and teacher operational workflows are present but not confirmed as fully enforced/production-ready.
- Fine-grained `ADMIN` vs `MASTER_ADMIN` separation is not confirmed as implemented beyond shared admin gate checks.

## Working Rule

If a flow is modeled in schema/docs but not marked active in [00_01_system_baseline.md](/c:/Dev/studio.saas.platform/docs/00_01_system_baseline.md), treat it as not implemented for delivery planning and test expectations.

