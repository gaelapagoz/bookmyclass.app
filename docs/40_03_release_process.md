# Release Process

Purpose: capture the release process currently documented/enforced in this repository.

## Canonical Release Sequence
1. Merge to `main`.
2. Create release tag (`vX.Y.Z`).
3. Deploy tag to UAT.
4. Run validation in UAT:
   - e2e
   - load testing (k6, when applicable)
5. Promote the same validated tag to production.

Rule:
- Do not deploy directly from unvalidated `main` to production.

## Quality Gates in Repository
- CI build and test pass.
- E2E job pass.
- Prisma migration status check pass.

## Operational Readiness Checks
- Repository includes `scripts/verify-production-readiness.sh` with explicit operator confirmations for monitoring and backup evidence.

## Rollback Detail Status
- No fully automated rollback workflow is defined in GitHub Actions.
- Rollback remains runbook/operator-driven.

## Canonical References
- `docs/00_02_deployment_baseline.md`
- `.github/workflows/ci.yml`
- `scripts/verify-production-readiness.sh`
- `docs/50_02_bookmyclass_server_setup_updated.md`
