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
| Webhook receipt cleanup cron | `GET /api/cron/webhook-receipt-cleanup` with `Authorization: Bearer $CRON_SECRET` header must be scheduled externally (e.g. daily or weekly). Without it, `StripeWebhookEventReceipt` grows unboundedly. | Needs operator confirmation | Route exists; external schedule not yet confirmed in root crontab or external scheduler. |
| Canonical auth secret env var | `AUTH_SECRET` | Confirmed from code/runtime | `NEXTAUTH_SECRET` appears only as fallback in one marketing helper. |
| Canonical Stripe env vars | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Confirmed from code/runtime | Seed/test-only Stripe price IDs are separate from core runtime Stripe keys. |
| Production email sender policy | `EMAIL_FROM` must use verified `@bookmyclass.app` sender domain when provider delivery is enabled | Confirmed from code/runtime | Test/e2e deterministic bypass does not require provider send. |

## Last Verified

- Verified by: `Codex + operator-approved live inspection`
- Verified at: `2026-04-18`
- Verification method: `pm2 status/show, docker ps, crontab -l, nginx config audit, cloudflared systemd/log audit, runtime env audit, public endpoint probes`
- Notes: Cloudflared remains remote-managed for tunnel ingress; public web routing source of truth is currently nginx behind Cloudflare proxied DNS rather than tunnel ingress rules.

## Deployment Flow (Canonical)

1. Merge to main
2. Create release tag (vX.Y.Z)
3. Deploy to UAT
4. Run:
   - E2E tests
   - load testing (k6)
   - security baseline testing (local OWASP ZAP baseline against UAT)
5. If successful → deploy SAME tag to production

Rule:
- Never deploy directly to production from main

