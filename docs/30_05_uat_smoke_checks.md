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

1. UAT app-host topology (default, `BASE_URL=https://uat.bookmyclass.app`)
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
- `scripts/uat-smoke-check.ts`

NPM command:
- `npm run test:uat:smoke`

## Configuration

- `BASE_URL` (optional): defaults to `https://uat.bookmyclass.app`
- `UAT_SMOKE_TIMEOUT_MS` (optional): defaults to `8000`
- `MARKETING_BASE_URL` (optional, split mode)
- `WWW_BASE_URL` (optional, split mode)
- `DEMO_BASE_URL` (optional, split mode)

Example:

```bash
BASE_URL=https://uat.bookmyclass.app npm run test:uat:smoke

# production split topology smoke
BASE_URL=https://bookmyclass.app npm run test:uat:smoke
```

## Release sequence in GitHub Actions

Expected order:
1. `regression`
2. `e2e`
3. Deploy exact tag to UAT over SSH (`deploy_uat`)
4. Run `npm run test:uat:smoke` (`smoke_uat`)
5. Run deployed UAT release e2e (`e2e_uat`)
6. Run k6 smoke (`k6_smoke_uat`)
7. Run ZAP baseline (`zap_uat`)

Assumed SSH secrets for deploy step:
- `UAT_SSH_HOST`
- `UAT_SSH_PORT`
- `UAT_SSH_USER`
- `UAT_SSH_PRIVATE_KEY`
- `UAT_SSH_KNOWN_HOSTS`

Example post-deploy smoke step:

```yaml
- name: Run UAT smoke checks
  env:
    BASE_URL: https://uat.bookmyclass.app
  run: npm run test:uat:smoke
```
