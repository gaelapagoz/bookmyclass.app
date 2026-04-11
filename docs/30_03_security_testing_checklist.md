# Security Testing Checklist

Use this checklist for local-to-UAT security baseline validation.

## Before running

- [ ] Confirm target is UAT/staging URL (never production)
- [ ] Confirm local checkout is exactly on a release tag (`git describe --tags --exact-match`)
- [ ] Confirm Docker is available locally
- [ ] Confirm UAT deploy tag matches release candidate tag

## Baseline execution

- [ ] Run `BASE_URL=https://uat.bookmyclass.app bash scripts/local-uat-security-baseline.sh`
- [ ] Verify run artifacts are created under `/tmp/local-uat-security-<timestamp>-baseline`
- [ ] Verify artifacts include HTML report, JSON report, stdout log, exit code, run metadata

## Normalization and triage

- [ ] Verify `normalized-summary.md` and `normalized-summary.json` exist
- [ ] Check category counts: `release_blocker`, `must_review`, `hardening_backlog`, `informational`
- [ ] If `release_blocker > 0`, stop release promotion and open remediation action
- [ ] Review `must_review` findings for auth/payment/admin/sign-in/sign-up paths
- [ ] Move header-hardening findings to hardening backlog with owner and due date

## Release gate decision

- [ ] Confirm security baseline result is attached to UAT evidence for the validated tag
- [ ] Confirm production promotion uses the same validated tag only
- [ ] Record operator decision with summary link/path

## Evidence retention

- [ ] Keep run directory path in release notes or operator handoff
- [ ] Do not commit local security artifacts to git
