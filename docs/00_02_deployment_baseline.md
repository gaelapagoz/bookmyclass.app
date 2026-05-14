# Deployment Baseline

Purpose: canonical runtime/deployment fact sheet for current production operations.

If a setup/runbook file conflicts with this file, treat this file as authoritative for deployment/runtime facts.

## Canonical Facts

| Fact | Canonical value | Status | Notes |
|---|---|---|---|
| Production host/IP or hostname | `bookmyclass-prod` / `46.62.208.152` | Verified live | Confirmed from live host inspection on April 18, 2026. |
| Production topology | Single app host + separate monitor host (`bookmyclass-monitor`) | Verified live | App runtime and nginx on production host; Uptime Kuma runs on monitor host. |
| PM2 app name | `bookmyclass-app` | Confirmed from deployment docs | Consistent across PM2/monitoring guides. |
| PM2 runtime/process mode | Cluster mode with 2 workers on production (2 vCPU) | Verified live | Keep one app name (`bookmyclass-app`) with 2 online workers. |
| Database container name | `bookmyclass-app-postgres` | Verified live | Confirmed via `docker ps` on production host. |
| Database name | `bookmyclass-app-db` | Verified live | Confirmed from production runtime `DATABASE_URL`. |
| Database user naming convention | `bookmyclass-app-user` | Verified live | Confirmed from production runtime `DATABASE_URL`. |
| App port | `3000` | Confirmed from deployment docs | Nginx proxy target uses `127.0.0.1:3000`. |
| Nginx/public routing facts | `bookmyclass.app` + `www.bookmyclass.app` serve static homesite; `bookmyclass.app/api/contact-form` proxies to `127.0.0.1:3000/api/contact-form`; `demo.bookmyclass.app` proxies to `127.0.0.1:3000` | Verified live | TLS served via certbot cert for `bookmyclass.app`. |
| Cloudflare edge/tunnel source of truth | Public web hostnames currently reach nginx via Cloudflare proxied DNS (edge IPs in nginx logs). Cloudflared named tunnel is remote-managed and currently advertises `ssh-prod.bookmyclass.app -> ssh://localhost:22` + `http_status:404`. | Verified live with drift note | Local `/etc/cloudflared/config.yml` must not be treated as web-routing source of truth while remote-managed config is authoritative. |
| Prisma Studio port | `NEEDS_OPERATOR_CONFIRMATION` | Needs confirmation | Conflicting docs: `5555` and `51212`. |
| Netdata port | `19999` (localhost binding) | Confirmed from deployment docs | Accessed via SSH tunnel. |
| Healthcheck script path | `/usr/local/bin/bookmyclass-healthcheck.sh` | Confirmed from deployment docs | Used by root cron. |
| Backup script path | `/usr/local/bin/bookmyclass-db-backup-run.sh` | Verified live | Confirmed in root crontab on production host. |
| Healthcheck cron | `*/5 * * * * /usr/local/bin/bookmyclass-healthcheck.sh >> /var/log/bookmyclass-healthcheck.log 2>&1` | Confirmed from deployment docs | Root crontab. |
| Backup cron | `30 2 * * * /usr/local/bin/bookmyclass-db-backup-run.sh >> /var/log/bookmyclass-db-backup.log 2>&1` | Verified live | Root crontab. |
| App maintenance cron | `*/5 * * * * cd /var/www/bookmyclass && set -a && . ./.env && set +a && curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://bookmyclass.app/api/cron/maintenance >> /var/log/bookmyclass-maintenance.log 2>&1` | Required | Runs webhook receipt cleanup, cart checkout idempotency cleanup, and expired booking draft cleanup. The old daily maintenance cron is insufficient for booking/cart cleanup. |
| `MARKETING_TRACKING_SECRET` env var | Required in production — no fallback. Must be set before enabling campaign sends. | Required | Previously had a fallback; enforced at startup via `validateRuntimeEnv()` — missing value causes 503 at `/api/health` and blocks Stripe client init. |
| Canonical auth secret env var | `AUTH_SECRET` | Confirmed from code/runtime | `NEXTAUTH_SECRET` appears only as fallback in one marketing helper. |
| Canonical Stripe env vars | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Confirmed from code/runtime | Seed/test-only Stripe price IDs are separate from core runtime Stripe keys. |
| Production email sender policy | `EMAIL_FROM` must use verified `@bookmyclass.app` sender domain when provider delivery is enabled | Confirmed from code/runtime | Test/e2e deterministic bypass does not require provider send. |

## Last Verified

- Verified by: `Codex + operator-approved live inspection`
- Verified at: `2026-04-18`
- Verification method: `pm2 status/show, docker ps, crontab -l, nginx config audit, cloudflared systemd/log audit, runtime env audit, public endpoint probes`
- Notes: Cloudflared remains remote-managed for tunnel ingress; public web routing source of truth is currently nginx behind Cloudflare proxied DNS rather than tunnel ingress rules.

## Production Root Cron

Production root cron should include these managed operational jobs:

```cron
*/5 * * * * cd /var/www/bookmyclass && set -a && . ./.env && set +a && curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://bookmyclass.app/api/cron/maintenance >> /var/log/bookmyclass-maintenance.log 2>&1
30 2 * * * /usr/local/bin/bookmyclass-db-backup-run.sh >> /var/log/bookmyclass-db-backup.log 2>&1
*/5 * * * * /usr/local/bin/bookmyclass-healthcheck.sh >> /var/log/bookmyclass-healthcheck.log 2>&1
```

- App maintenance must run every 5 minutes so expired booking drafts and cart checkout idempotency records are cleaned up promptly.
- DB backup runs daily at 02:30 UTC.
- Local app healthcheck runs every 5 minutes.
- The previous daily `0 3 * * *` maintenance cron is insufficient for booking/cart cleanup and should be replaced.
- Install and verify with `scripts/prod-install-cron.sh` and `scripts/prod-verify-cron.sh`; both scripts default to `/var/www/bookmyclass` and `https://bookmyclass.app` while allowing `APP_DIR` and `BASE_URL` overrides.

## Deployment Flow (Canonical)

Current release flow with operator-run UAT available:

1. Merge to main through PR with CI passing.
2. Create release tag (vX.Y.Z).
3. Run local/CI validation appropriate to the change:
   - full regression suite
   - relevant E2E tests
   - Stripe CLI webhook simulation for payment/webhook changes
   - operator-run smoke, security, and performance checks when relevant
4. When release scope requires it, the operator runs UAT smoke, security,
   performance, or E2E validation against the approved UAT/demo target.
5. Promote the exact validated tag to production through the manual production workflow.
6. Run production smoke checks and observability/log review immediately after deploy.

Rules:
- Never deploy directly to production from main.
- Production deployment remains explicit and operator-approved.
- UAT is operational for manual operator validation and is not an automatic gate.
- Use "operator-run UAT/manual release validation" for current manual evidence.
- Store manual evidence at `test-results/manual_test_<YYYY-MM-DD>.md`.

## Manual Evidence Convention

Manual validation evidence must use this file pattern:

```text
test-results/manual_test_<YYYY-MM-DD>.md
```

Recommended structure:

```text
# Operator-Run Manual Release Validation - YYYY-MM-DD

## Environment
- Target:
- URL:
- Build/tag:
- Operator:
- Date:

## Defect Evidence
### S1_001
- Status:
- Evidence:
- Screenshot/log/video:
- Notes:

## Signoff
- Operator:
- Result:
```

## Source Priority

Use this source order when current implementation work conflicts with older docs:

1. `docs/00_*`
2. `docs/10_*`
3. `docs/20_*`
4. `docs/30_*`
5. `docs/40_*`
6. `docs/50_*`
7. `docs/60_*`
8. `docs/70_*`
9. `docs/80_*`
10. `docs/90_*`
11. Latest manual defect campaign

## Operator-Run UAT Flow

1. Merge to main
2. Create release tag (vX.Y.Z)
3. Deploy to UAT when the operator approves UAT validation for the release.
4. Run:
   - E2E tests
   - load testing (k6)
   - security baseline testing (local OWASP ZAP baseline against UAT)
5. If successful, deploy the same tag to production.

Rule:
- Never deploy directly to production from main

