# Security Testing Checklist

Use this checklist for local-to-UAT security baseline validation.

## Before running

- [ ] Confirm target is UAT/staging URL (never production)
- [ ] Confirm local checkout is exactly on a release tag (`git describe --tags --exact-match`)
- [ ] Confirm Docker is available locally
- [ ] Confirm UAT deploy tag matches release candidate tag
- [ ] Confirm admin abuse guard readiness is healthy (`GET /api/health` includes `adminLoginAbuseGuard.ready=true`)
- [ ] If break-glass is active, confirm `ADMIN_LOGIN_ABUSE_BREAK_GLASS_UNTIL` is explicitly time-bounded and incident-owned before proceeding
- [ ] Confirm homesite contact-form IP trust boundary is explicit: ingress provides trusted `cf-connecting-ip`/`x-real-ip`, or `TRUST_X_FORWARDED_FOR=1` is set only for sanitized proxy chains

## Baseline execution

- [ ] Run `BASE_URL=https://uat.bookmyclass.app bash scripts/local-uat-security-baseline.sh`
- [ ] Verify run artifacts are created under `/tmp/local-uat-security-<timestamp>-baseline`
- [ ] If seed data changed (for example learning thumbnails), run reset/reseed before baseline so DB content matches the validated tag
- [ ] Verify artifacts include HTML report, JSON report, stdout log, exit code, run metadata

- [ ] Run `bash scripts/security-check-headers.sh` and verify root + robots/static coverage
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
- [ ] Confirm break-glass override (if used) is removed or expired before production promotion

## Evidence retention

- [ ] Keep run directory path in release notes or operator handoff
- [ ] Do not commit local security artifacts to git
