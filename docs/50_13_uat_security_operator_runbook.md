# UAT Security Baseline + Manual CD Runbook

Purpose: define the minimum local, repo-owned UAT security baseline flow using Dockerized OWASP ZAP, with evidence capture and explicit release gating.

## 0) Scope and hard rules

- Target: UAT only (`https://uat.bookmyclass.app` by default)
- Local machine executes ZAP scan and normalization
- UAT validation must run from a git tag (`git describe --tags --exact-match`)
- Never deploy directly from `main` to UAT or production
- Never target production in this flow

## 1) Scripts

- Baseline runner: `scripts/local-uat-security-baseline.sh`
- Summary normalizer: `scripts/local-uat-security-collect-metrics.sh`

## 2) Local baseline run

```bash
BASE_URL=https://uat.bookmyclass.app bash scripts/local-uat-security-baseline.sh
```

Behavior:

- refuses non-UAT-like targets
- refuses to run if current commit is not exactly on a tag
- runs Dockerized ZAP stable image
- stores timestamped artifacts under `/tmp/local-uat-security-<timestamp>-baseline`
- runs normalization automatically after scan

Default image:

- `ghcr.io/zaproxy/zaproxy:stable`

Optional runtime overrides:

- `EVIDENCE_ROOT` (default `/tmp`)
- `ZAP_MAX_MINUTES` (default `5`)
- `HOST_WORK_DIR` (override bind source path)
- `ZAP_DOCKER_IMAGE` (override image tag)
- `RUN_NORMALIZER=NO` (skip auto-normalize)

## 3) Windows Git Bash Docker mount note

For Git Bash on Windows, this flow supports the same working mount pattern that was proven:

- `$(pwd -W):/zap/wrk/:rw`

The baseline script auto-detects `pwd -W` when available.
If detection fails or custom pathing is needed, set `HOST_WORK_DIR` explicitly.

Example:

```bash
HOST_WORK_DIR="$(pwd -W)" BASE_URL=https://uat.bookmyclass.app bash scripts/local-uat-security-baseline.sh
```

## 4) Captured artifacts per run

Inside each run directory (`/tmp/local-uat-security-<timestamp>-baseline`):

- `zap-baseline-report.html`
- `zap-baseline-report.json`
- `zap-stdout.log`
- `exit-code.txt`
- `run-meta.env`
- `normalized-summary.md`
- `normalized-summary.json`
- `normalizer.log`

## 5) Normalization and classification model

The normalizer reads `zap-baseline-report.json` and classifies findings into:

- `release_blocker`
- `must_review`
- `hardening_backlog`
- `informational`

Initial rules:

- `release_blocker`
  - any FAIL finding
  - risk-based fallback: medium/high (`riskCode >= 2`) treated as FAIL-equivalent for baseline gating
- `must_review`
  - `Absence of Anti-CSRF Tokens`
  - `User Controllable HTML Element Attribute (Potential XSS)`
  - auth-related warning names on sign-in/sign-up/admin/payment/checkout/subscription paths
- `hardening_backlog`
  - `Missing Anti-clickjacking Header`
  - `X-Content-Type-Options Header Missing`
  - `Strict-Transport-Security Header Not Set`
  - `Server Leaks Information via "X-Powered-By" HTTP Response Header Field(s)`
  - `Content Security Policy (CSP) Header Not Set`
  - `Permissions Policy Header Not Set`
- `informational`
  - cache / retrieved-from-cache / modern-web-app / non-storable-content findings unless higher-severity mapping applies

## 6) Manual normalization run

If needed, run classifier separately against a run directory:

```bash
bash scripts/local-uat-security-collect-metrics.sh /tmp/local-uat-security-<timestamp>-baseline
```

If run dir is omitted, latest matching run folder is used.

## 7) UAT release gate usage

Before promoting a UAT-validated tag to production:

1. Confirm UAT deploy is on the intended tag
2. Run E2E and performance gates
3. Run local ZAP baseline against UAT
4. Review `normalized-summary.md`

Gate rule:

- If `release_blocker > 0`, do not promote tag to production
- If `release_blocker = 0`, proceed with risk review for `must_review` and backlog hardening entries

## 8) Example operator flow

```bash
# 1) deploy tag to UAT
TARGET_TAG=vX.Y.Z bash scripts/uat-deploy-tag.sh

# 2) verify tag on UAT
EXPECTED_TAG=vX.Y.Z bash scripts/uat-verify-tag.sh

# 3) local security baseline against UAT
BASE_URL=https://uat.bookmyclass.app bash scripts/local-uat-security-baseline.sh

# 4) explicit re-run of normalizer (optional)
bash scripts/local-uat-security-collect-metrics.sh /tmp/local-uat-security-<timestamp>-baseline
```

## 8.1) Seed data refresh requirement for learning image migrations

- Deterministic seed entrypoint is `prisma/seed.ts`, which consumes `prisma/seed-data/learning-content.json` for learning content.
- If learning seed JSON changes (for example, thumbnail URL migrations), DB rows do not change until reset/reseed is executed.
- For UAT validation after seed-content changes, run the destructive reset/reseed flow from a tag before security scan:

```bash
CONFIRM_UAT_DB_RESET=YES TARGET_TAG=vX.Y.Z BASE_URL=https://uat.bookmyclass.app bash scripts/uat-reset-and-verify.sh
```

- After reseed, verify learning thumbnails in DB are first-party (`/images/learning/...`) before running ZAP baseline.

## 9) Safety reminders

- Do not run this against production URLs
- Do not bypass tag-only validation flow
- Keep this as the minimum baseline gate; expand only with explicit scope approval

## 10) Current residual findings (expected for now)

- App-level header baseline is in place (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`).
- Current CSRF defense is same-origin validation (Origin/Referer) for non-auth mutations and server actions.
- ZAP may still report token-style CSRF findings because no synchronizer-token marker is emitted by this model.
- Edge/static header coverage is now explicitly configured for `/robots.txt` and `/_next/static/*` surfaces we control. Remaining header findings on Cloudflare-managed `cdn-cgi/*` paths may still be expected.

