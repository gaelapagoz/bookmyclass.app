# Release Smoke Checks

## Purpose

This smoke layer validates release reachability after deployment.

It is intentionally:
- fast
- deterministic
- non-destructive
- release-blocking

## Coverage

The smoke script supports two topologies:

1. UAT/demo app-host topology (operator-run manual validation)
  - `GET /api/health` returns `200`
  - `GET /` returns `200` with homepage marker
  - `GET /sign-in` returns `200`
  - `GET /book-a-class` returns `200`
  - `GET /subscription` returns `200`
  - `GET /api/categories` returns `200`

2. Production split-host topology (`BASE_URL=https://bookmyclass.app`)
  - `https://bookmyclass.app/` returns `200` with homesite marker
  - `https://www.bookmyclass.app/` returns `200` with homesite marker
  - `https://demo.bookmyclass.app/` returns `200` with app marker
  - `https://demo.bookmyclass.app/api/health` returns `200` with `{"ok":true...}`

Script location:
- `scripts/deploy-server-smoke-check.ts`

NPM command:
- `npm run test:uat:smoke`

## Configuration

- `BASE_URL` (optional): set to the operator-approved validation URL
- `UAT_SMOKE_TIMEOUT_MS` (optional): defaults to `8000`
- `MARKETING_BASE_URL` (optional, split mode)
- `WWW_BASE_URL` (optional, split mode)
- `DEMO_BASE_URL` (optional, split mode)

Example:

```bash
BASE_URL=<operator-approved-url> npm run test:uat:smoke

# production split topology smoke
BASE_URL=https://bookmyclass.app npm run test:uat:smoke
```

## Release sequence in GitHub Actions

Expected order:
1. `regression`
2. `e2e`
3. Run operator-approved smoke validation for the exact tag
4. Record evidence in `test-results/manual_test_<YYYY-MM-DD>.md`
5. Promote the exact validated tag through manual production approval

Assumed SSH secrets for deploy step:
- UAT secrets remain UAT-only.
- During demo-stage operation, UAT secrets may intentionally contain the same
  host/app values as the production/demo server. This is allowed only when the
  values are still provided through the `UAT_*` secret names and the workflow
  emits a warning that UAT is targeting the prod/demo topology.
- Do not reference `PROD_*` secrets directly from UAT workflow steps.

Example post-deploy smoke step:

```yaml
- name: Run UAT smoke checks
  env:
    BASE_URL: <operator-approved-url>
  run: npm run test:uat:smoke
```
