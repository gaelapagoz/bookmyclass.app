# Testing Implementation Checklist

Use this checklist in feature tasks.

## Before coding
- [ ] Identify impacted areas: auth / booking / payments / learning / routing / API / service logic.
- [ ] Decide required test types (`unit`, `integration`, `ui`).
- [ ] Mark whether release-critical flows are impacted: auth / booking / checkout / webhook / cancellation / admin mutations.

## While implementing
- [ ] Add/update tests for changed behavior (not just happy path).
- [ ] Include at least one failure/edge path.
- [ ] Keep tests deterministic (mock time/network/externals where needed).

## Before handoff
- [ ] If this change is part of UAT release validation, run local UAT security baseline and attach normalized summary evidence (`scripts/security-server-run-baseline.sh`, `docs/30_03_security_testing_checklist.md`).
- [ ] Run only relevant test files locally first.
- [ ] Verify status codes/contracts for API changes.
- [ ] Verify branching states for page/UI changes.
- [ ] Document exact commands used to run tests.
- [ ] In the handoff summary, list exactly what tests were run.
- [ ] If any high-risk area was intentionally skipped, name the area and justify the skip explicitly.

