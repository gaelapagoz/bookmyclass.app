# UAT Performance + Manual CD Runbook

Status: operational for operator-run manual validation. Do not treat this
runbook as an automatic release gate; the operator runs it manually when release
scope requires UAT performance evidence.

Purpose: self-serve operator flow with strict separation:

- Local machine runs k6 load generation and local evidence capture.
- UAT host handles only host operations (reset, PM2, deploy/verify).
- Current validation uses operator-run UAT/manual release validation with evidence in `test-results/manual_test_<YYYY-MM-DD>.md`.

## 0) One-time operator confirmations

Confirm these values once before first run (deployment baseline still has operator-confirmation fields):

- `REMOTE_HOST` (default in helper scripts: `bookmyclass-uat`)
- `REMOTE_USER` (default: `deploy`)
- `APP_DIR` on UAT (default: `/var/www/bookmyclass`)
- `APP_NAME` on UAT (default: `bookmyclass-app-uat`)
- `BASE_URL` for UAT (default: `https://uat.bookmyclass.app`)

Naming note:
- UAT PM2 app name: `bookmyclass-app-uat`
- Production PM2 app name: `bookmyclass-app` (see deployment baseline)

## 1) Script split

UAT host operation scripts:

- `scripts/db-server-reset-and-verify.sh`
- `scripts/performance-server-scale-pm2.sh`

Local k6 scripts:

- `scripts/performance-server-run-smoke.sh`
- `scripts/performance-server-run-t50.sh`
- `scripts/performance-server-run-t100.sh`
- `scripts/performance-server-collect-metrics.sh`

Archived local k6 scripts:

- `scripts/archive/perf-legacy/*`
- Legacy aliases/scripts are deprecated for one release tag, then removed from active usage.

Local security scripts:

- `scripts/security-server-run-baseline.sh`
- `scripts/security-server-collect-metrics.sh`

Manual CD scripts (run from local machine via SSH):

- `scripts/deploy-server-tag.sh`
- `scripts/deploy-server-verify-tag.sh`

## 2) UAT host prep flow

Run the examples in this section only when the operator approves UAT validation
for the target tag.

### A. Clean reset (destructive)

```bash
CONFIRM_UAT_DB_RESET=YES \
TARGET_TAG=vX.Y.Z \
BASE_URL=https://uat.bookmyclass.app \
bash scripts/db-server-reset-and-verify.sh
```

Notes:

- `TARGET_TAG` is optional if tag is already deployed on UAT host.
- Script refuses reset unless `CONFIRM_UAT_DB_RESET=YES`.
- Script captures evidence under `/tmp/uat-perf-<timestamp>-reset`.

### B. PM2 worker sizing

```bash
TARGET_WORKERS="$(($(nproc)>16?16:$(nproc)))" bash scripts/performance-server-scale-pm2.sh
```

Validation target:

- online worker count matches requested worker count
- health checks are 200
- PM2 internal IDs are irrelevant; worker count and mode are what matter

### C. Load-window booking draft rate limits

Enable load-window mode on UAT before performance stages:

```bash
export BOOKING_DRAFT_RATE_LIMIT_MODE=load
export BOOKING_DRAFT_USER_MAX_ATTEMPTS_LOAD=200
export BOOKING_DRAFT_USER_WINDOW_MS_LOAD=60000
export BOOKING_DRAFT_USER_BLOCK_DURATION_MS_LOAD=30000
export BOOKING_DRAFT_IP_MAX_ATTEMPTS_LOAD=400
export BOOKING_DRAFT_IP_WINDOW_MS_LOAD=60000
export BOOKING_DRAFT_IP_BLOCK_DURATION_MS_LOAD=30000
pm2 restart bookmyclass-app-uat --update-env
```

When `BOOKING_DRAFT_RATE_LIMIT_MODE` is unset, app defaults remain strict production-safe values.

## 3) Local k6 flow

Do not run these UAT examples as current release gates unless UAT has been
operator-approved for the release.

Mandatory rule:
- Before each local stage, run local discovery against UAT to refresh `k6/data/services.json` and `k6/data/products.json`.
- `scripts/performance-server-run-smoke.sh`, `scripts/performance-server-run-t50.sh`, and `scripts/performance-server-run-t100.sh` enforce this automatically before `k6 run`.

### A. Smoke

```bash
BASE_URL=https://uat.bookmyclass.app bash scripts/performance-server-run-smoke.sh
```

### B. t50

```bash
BASE_URL=https://uat.bookmyclass.app bash scripts/performance-server-run-t50.sh
```

### C. t100

```bash
BASE_URL=https://uat.bookmyclass.app bash scripts/performance-server-run-t100.sh
```

Each local run stores:

- `k6-output.log`
- `k6-summary.json`
- `k6-discover.log`
- `discovered-services.json`
- `discovered-products.json`
- `run-meta.env`
- `exit-code.txt`
- `quick-summary.txt`

Folder pattern:

- `/tmp/server-perf-<timestamp>-<profile>`

### G. Local metrics summary

```bash
bash scripts/performance-server-collect-metrics.sh /tmp/server-perf-<timestamp>-t100
```

If path is omitted, script picks latest local run folder.

Summary output includes:

- profile, base URL, duration, exit code
- avg/p50/p90/p95/p99
- request rate
- `http_req_failed`
- `booking_draft_technical_failure_rate`
- `booking_draft_expected_conflict_rate` (if present)

### Ramp policy (explicit)

Use this stage order and only continue when the previous stage is healthy:

1. `smoke`
2. `t50`
3. `t100`

Gate rule:

- If a stage fails (non-zero exit code) or shows unacceptable error/latency metrics, stop ramp-up, collect metrics, and investigate before continuing.
- Do not jump directly to higher stages unless a deliberate incident drill requires it.

## 4) Manual UAT CD flow (tag-only)

### Sequence

1. Merge to `main`.
2. Create tag `vX.Y.Z`.
3. Wait for CI and E2E to pass.
4. When the operator approves UAT validation, manually deploy that exact tag to UAT.
5. Manually verify UAT is on that exact tag.
6. Capture operator-run UAT/manual release validation evidence.

### A. Manual deploy to UAT

```bash
TARGET_TAG=vX.Y.Z \
REMOTE_HOST=bookmyclass-uat \
REMOTE_USER=deploy \
BASE_URL=https://uat.bookmyclass.app \
bash scripts/deploy-server-tag.sh
```

or

```bash
bash scripts/deploy-server-tag.sh vX.Y.Z
```

What deploy script does on UAT host:

- `git fetch --all --tags`
- `git checkout vX.Y.Z`
- `npm ci`
- `npx prisma migrate deploy`
- `npx prisma generate`
- `npm run build`
- `pm2 restart bookmyclass-app-uat --update-env`
- `git describe --tags --exact-match`
- health checks + PM2 status

### B. Manual verify deployed tag

```bash
EXPECTED_TAG=vX.Y.Z \
REMOTE_HOST=bookmyclass-uat \
REMOTE_USER=deploy \
BASE_URL=https://uat.bookmyclass.app \
bash scripts/deploy-server-verify-tag.sh
```

or

```bash
bash scripts/deploy-server-verify-tag.sh vX.Y.Z
```

Verification checks:

- `git describe --tags --exact-match` equals expected tag
- PM2 status returned
- local UAT host health endpoint timing returned
- public UAT health endpoint timing returned

## 5) End-to-end operator example

Historical example only. Current release validation uses
operator-run manual release validation evidence.

```bash
# 1) reset UAT (destructive)
CONFIRM_UAT_DB_RESET=YES TARGET_TAG=v0.3.0 bash scripts/db-server-reset-and-verify.sh

# 2) scale PM2
TARGET_WORKERS="$(($(nproc)>16?16:$(nproc)))" bash scripts/performance-server-scale-pm2.sh

# 3) local smoke
BASE_URL=https://uat.bookmyclass.app bash scripts/performance-server-run-smoke.sh

# 4) local t50
BASE_URL=https://uat.bookmyclass.app bash scripts/performance-server-run-t50.sh

# 5) local t100
BASE_URL=https://uat.bookmyclass.app bash scripts/performance-server-run-t100.sh

# 7) tag release (example)
git checkout main
git pull origin main
git tag -a v0.3.1 -m "Release v0.3.1"
git push origin v0.3.1

# 8) manual deploy chosen tag to UAT
TARGET_TAG=v0.3.1 bash scripts/deploy-server-tag.sh

# 9) verify UAT is running that tag
EXPECTED_TAG=v0.3.1 bash scripts/deploy-server-verify-tag.sh

# 10) run local UAT security baseline
BASE_URL=https://uat.bookmyclass.app bash scripts/security-server-run-baseline.sh
```

## 6) Safety rules

- UAT is operational for operator-run manual validation.
- Never map UAT workflows or runbooks to production secrets.
- Deploy and validate tags only.
- Keep booking and entitlement validation server-side.
- Keep k6 load generation local so UAT host measurements are not distorted by local load generator CPU usage.
- Treat UAT security/performance evidence as manual operator validation.

## 7) Manual configuration

Use this on the **UAT host** (manual, tag-based):

Only use this when the operator approves UAT validation for the target tag.

```bash
cd /var/www/bookmyclass-uat
git fetch --all --tags
git checkout v0.2.37-rc.3   # or your target UAT tag
npm ci
npx prisma migrate reset
npx prisma migrate deploy
npx prisma generate

# App baseline seed
npm run prisma:seed

# k6/UAT load-test seed (optional but usually needed for smoke/t100 flows)
set -a && . ./.env && set +a
UAT_K6_SEED=1 npm run db:seed:server:k6
# optional server-side discover (local discover before each run is still mandatory)
BASE_URL=https://uat.bookmyclass.app npm run k6:discover:server
```

If you also want a full destructive reset first, run:

```bash
npx prisma migrate reset --force
npm run prisma:seed
```

Use a **tag checkout only** for UAT (not `main`).
