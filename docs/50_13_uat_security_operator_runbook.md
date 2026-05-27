# UAT Security Baseline + Manual CD Runbook

Status: operational for operator-run manual validation. Current releases use
operator-run UAT/manual release validation with evidence in
`test-results/manual_test_<YYYY-MM-DD>.md`.

Purpose: define the local, repo-owned UAT security baseline flow using Dockerized OWASP ZAP.

## 0) Scope and hard rules

- Target: operator-approved UAT/demo validation URL only
- Local machine executes ZAP scan and normalization
- UAT validation must run from a git tag (`git describe --tags --exact-match`)
- Never deploy directly from `main` to UAT or production
- Never target production in this flow

## 1) Scripts

- Baseline runner: `scripts/security-server-run-baseline.sh`
- Summary normalizer: `scripts/security-server-collect-metrics.sh`
- Header forensics runner: `scripts/security-server-header-forensics.sh`

## 2) Local baseline run

Run this UAT example only when the operator approves security validation for the
target tag.

```bash
BASE_URL=https://uat.bookmyclass.app bash scripts/security-server-run-baseline.sh
```

Behavior:

- refuses non-UAT-like targets
- refuses to run if current commit is not exactly on a tag
- runs Dockerized ZAP stable image
- stores timestamped artifacts under `/tmp/server-security-<timestamp>-baseline`
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
HOST_WORK_DIR="$(pwd -W)" BASE_URL=https://uat.bookmyclass.app bash scripts/security-server-run-baseline.sh
```

## 4) Captured artifacts per run

Inside each run directory (`/tmp/server-security-<timestamp>-baseline`):

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
bash scripts/security-server-collect-metrics.sh /tmp/server-security-<timestamp>-baseline
```

If run dir is omitted, latest matching run folder is used.

## 7) UAT release validation usage

Before promoting a UAT-validated tag to production:

1. Confirm UAT deploy is on the intended tag
2. Run E2E and performance gates
3. Run local ZAP baseline against UAT
4. Review `normalized-summary.md`

Gate rule:

- If `release_blocker > 0`, do not promote tag to production
- If `release_blocker = 0`, proceed with risk review for `must_review` and backlog hardening entries

## 8) Example operator flow

Historical example only. Current release validation uses
operator-run manual release validation evidence.

```bash
# 1) deploy tag to UAT
TARGET_TAG=vX.Y.Z bash scripts/deploy-server-tag.sh

# 2) verify tag on UAT
EXPECTED_TAG=vX.Y.Z bash scripts/deploy-server-verify-tag.sh

# 3) local security baseline against UAT
BASE_URL=https://uat.bookmyclass.app bash scripts/security-server-run-baseline.sh

# 4) explicit re-run of normalizer (optional)
bash scripts/security-server-collect-metrics.sh /tmp/server-security-<timestamp>-baseline
```

## 8.1) Seed data refresh requirement for learning image migrations

- Deterministic seed entrypoint is `prisma/seed.ts`, which consumes `prisma/seed-data/learning-content.json` for learning content.
- If learning seed JSON changes, DB rows do not change until reset/reseed is executed.
- For UAT validation after seed-content changes, run the destructive reset/reseed flow from a tag before security scan:

```bash
CONFIRM_UAT_DB_RESET=YES TARGET_TAG=vX.Y.Z BASE_URL=https://uat.bookmyclass.app bash scripts/db-server-reset-and-verify.sh
```

- After reseed, verify learning thumbnails and program images in DB use canonical uploaded media paths (`/uploads/learning/*`) before running ZAP baseline.

## 9) Safety reminders

- Do not run this against production URLs
- Do not bypass tag-only validation flow
- Keep this as the minimum baseline gate; expand only with explicit scope approval

## 9.1) Header forensics (origin vs edge classification)

Use this after deploying and verifying a UAT tag when you need to classify whether missing headers are:
- app/origin emission gaps,
- reverse-proxy/edge behavior,
- Cloudflare-managed residuals,
- or scanner artifact URL classes.

Public-only check:

Only run this if UAT was operator-approved for the release.

```bash
BASE_URL=https://uat.bookmyclass.app bash scripts/security-server-header-forensics.sh
```

Public + origin-direct compare (when origin IP is known):

```bash
BASE_URL=https://uat.bookmyclass.app ORIGIN_IP=<origin_ip> bash scripts/security-server-header-forensics.sh
```

Optional flags:
- `ORIGIN_PORT` (defaults to 443 for https base URL, 80 for http)
- `ORIGIN_INSECURE=YES` (only if TLS chain mismatch must be bypassed)
- `RUN_TAG_CHECK=NO` (local non-release debugging only)
- `EXTRA_URLS` (newline-delimited additional paths)

What the script captures:
- URL classes: `/`, `/learning`, `/robots.txt`, `/sitemap.xml`, one discovered `/_next/static/*.js`, one discovered `/_next/static/media/*`, one `/_next/image` optimizer URL, known malformed scanner-style image URLs, and `/cdn-cgi/l/email-protection`.
- Headers: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`, `Cross-Origin-Resource-Policy`, `Cache-Control`, `Age`, `cf-cache-status`.
- Artifacts:
  - `summary.md`
  - `summary.csv`
  - raw per-URL header captures under `raw/`

Interpretation:
- Origin has header, public missing: edge/proxy/cache issue.
- Origin and public both missing on normal routes: app/origin gap.
- Missing only on malformed scanner paths: scanner artifact route class.
- Missing on `/cdn-cgi/*`: Cloudflare-managed residual.

## 9.2) Narrow remediation for public static/text header propagation

Use this only when UAT forensics prove that app routes have headers but public delivery is missing headers on:
- `/robots.txt`
- `/_next/static/*`
- `/_next/static/media/*`

Do not use this section for CSP redesign and do not force `Cross-Origin-Embedder-Policy`.

### Step A - confirm origin vs public first

Only run this if UAT was operator-approved for the release.

```bash
BASE_URL=https://uat.bookmyclass.app ORIGIN_IP=<origin_ip> bash scripts/security-server-header-forensics.sh
```

Proceed only if origin shows expected low-level headers and public misses them on the path classes above.

### Step B - Cloudflare response header propagation (UAT zone)

Create one Response Header Transform Rule for URI path matching:
- equals `/robots.txt`
- starts with `/_next/static/`

Set these response headers (overwrite):
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Resource-Policy: same-origin`
- `Cross-Origin-Opener-Policy: same-origin`

Keep CSP handling unchanged. Do not add/force COEP in this remediation.

## 9.3) CSP rollout mode (report-only -> enforce)

Use middleware CSP mode for phased rollout during Phase 6 hardening.

Mode source:
- `CSP_HEADER_MODE` environment variable.
- `ALLOW_CSP_REPORT_ONLY_IN_UAT` environment variable (explicit override gate).
- `report-only` emits `Content-Security-Policy-Report-Only`.
- `enforce` emits `Content-Security-Policy`.
- Unset/invalid defaults to `enforce`.
- Precedence:
  - Production runtime enforces CSP by default.
  - UAT report-only requires all three: `NODE_ENV=production`, `CSP_HEADER_MODE=report-only`, `ALLOW_CSP_REPORT_ONLY_IN_UAT=1` (and UAT host).
  - Without explicit UAT override, production runtime stays enforce-only.

Compatibility route matrix for every UAT run:
- `/`
- `/sign-in`
- `/sign-up`
- `/subscription`
- booking checkout entry route(s) and booking success route(s)
- authenticated dashboard entry route

Promotion rule (report-only -> enforce):
- Keep `CSP_HEADER_MODE=report-only` in UAT until 2 consecutive runs show zero high/critical CSP violations on compatibility routes.
- After threshold, switch UAT to `CSP_HEADER_MODE=enforce` and rerun header/security checks.

Rollback trigger after enforce:
- Any high/critical CSP regression on compatibility routes.
- Immediate rollback action: set `CSP_HEADER_MODE=report-only`, redeploy same tag configuration, rerun checks, and capture evidence.

Required evidence record for this gate:
- Append to `test-results/manual_test_<YYYY-MM-DD>.md`:
  - run #1 date/time, tag, mode (`report-only`), compatibility-route results, high/critical CSP count
  - run #2 date/time, tag, mode (`report-only`), compatibility-route results, high/critical CSP count
  - explicit statement: "2 consecutive UAT runs clean: yes/no"
  - enforce switch verification run with effective header name on compatibility routes

### Step C - targeted cache purge

Purge only:
- `https://uat.bookmyclass.app/robots.txt`
- `https://uat.bookmyclass.app/_next/static/*`

Avoid full-zone purge unless emergency response requires it.

### Step D - optional nginx fallback (only if static is served directly by nginx)

If UAT nginx has dedicated static locations bypassing app proxy, add these with `always`:
- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `Permissions-Policy`
- `Cross-Origin-Resource-Policy`
- `Cross-Origin-Opener-Policy`

Then run:

```bash
nginx -t && systemctl reload nginx
```

### Step E - verify post-change behavior

Only run this if UAT was operator-approved for the release.

```bash
BASE_URL=https://uat.bookmyclass.app bash scripts/security-server-check-headers.sh
BASE_URL=https://uat.bookmyclass.app bash scripts/security-server-header-forensics.sh
```

Expected after remediation:
- `/robots.txt` has required low-level security headers.
- `/_next/static/*.js` has required low-level security headers.
- `/_next/static/media/*` has required low-level security headers.
- Remaining misses are limited to malformed scanner-style URLs and Cloudflare-managed `/cdn-cgi/*`.

## 10) Current residual findings (expected for now)

- App-level header baseline is in place (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`).
- Current CSRF defense is same-origin validation (Origin/Referer) for non-auth mutations and server actions.
- ZAP may still report token-style CSRF findings because no synchronizer-token marker is emitted by this model.
- Edge/static header coverage is now explicitly configured for `/robots.txt` and `/_next/static/*` surfaces we control. Remaining header findings on Cloudflare-managed `cdn-cgi/*` paths may still be expected.
- Learning images are first-party only and must remain under canonical `/uploads/learning/*` in DB rows and runtime output. Legacy pre-cutover learning image path values are migration-only.

