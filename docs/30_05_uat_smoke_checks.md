# UAT Smoke Checks

## Purpose

This smoke layer validates that a freshly deployed UAT tag is reachable and serving core public endpoints before heavier UAT validation runs.

It is intentionally:
- fast
- deterministic
- non-destructive
- release-blocking

## Coverage

The smoke script checks:
1. `GET /api/health` returns `200`
2. `GET /` returns `200` and contains a stable homepage marker
3. `GET /sign-in` returns `200`
4. `GET /book-a-class` returns `200`
5. `GET /subscription` returns `200`
6. `GET /api/categories` returns `200` as a public catalogue endpoint

Script location:
- `scripts/uat-smoke-check.ts`

NPM command:
- `npm run test:uat:smoke`

## Configuration

- `BASE_URL` (optional): defaults to `https://uat.bookmyclass.app`
- `UAT_SMOKE_TIMEOUT_MS` (optional): defaults to `8000`

Example:

```bash
BASE_URL=https://uat.bookmyclass.app npm run test:uat:smoke
```

## Release sequence in GitHub Actions

Expected order:
1. Deploy exact tag to UAT over SSH
2. Run `npm run test:uat:smoke` from the GitHub runner against the public UAT URL
3. Run UAT E2E checks
4. Run later-stage validation (for example ZAP baseline and k6)

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
