# Deployment Baseline

Purpose: canonical runtime/deployment fact sheet for current production operations.

If a setup/runbook file conflicts with this file, treat this file as authoritative for deployment/runtime facts.

## Canonical Facts

| Fact | Canonical value | Status | Notes |
|---|---|---|---|
| Production host/IP or hostname | `NEEDS_OPERATOR_CONFIRMATION` | Needs confirmation | Conflicting docs: `46.62.208.152` and `37.27.192.11`; alias `bookmyclass-prod` appears once. |
| Production topology | `NEEDS_OPERATOR_CONFIRMATION` | Needs confirmation | Not verifiable whether single-host or split hosts are currently live. |
| PM2 app name | `bookmyclass-app` | Confirmed from deployment docs | Consistent across PM2/monitoring guides. |
| Database container name | `NEEDS_OPERATOR_CONFIRMATION` | Needs confirmation | Conflicting docs: `bookmyclass-app-postgres` vs `bookmyclass-postgres`. |
| Database name | `NEEDS_OPERATOR_CONFIRMATION` | Needs confirmation | Conflicting docs: `bookmyclass-app-db` vs `bookmyclass`. |
| Database user naming convention | `NEEDS_OPERATOR_CONFIRMATION` | Needs confirmation | Conflicting docs: `bookmyclass-app-user` vs `bookmyclass_user`. |
| App port | `3000` | Confirmed from deployment docs | Nginx proxy target uses `127.0.0.1:3000`. |
| Nginx/public routing facts | `bookmyclass.app` and `www.bookmyclass.app` proxied to `127.0.0.1:3000` | Confirmed from deployment docs | TLS via certbot is documented. |
| Prisma Studio port | `NEEDS_OPERATOR_CONFIRMATION` | Needs confirmation | Conflicting docs: `5555` and `51212`. |
| Netdata port | `19999` (localhost binding) | Confirmed from deployment docs | Accessed via SSH tunnel. |
| Healthcheck script path | `/usr/local/bin/bookmyclass-healthcheck.sh` | Confirmed from deployment docs | Used by root cron. |
| Backup script path | `/usr/local/bin/bookmyclass-db-backup-run.sh` | Needs confirmation | Also documented: `bookmyclass-db-backup.sh` + `bookmyclass-db-backup-upload.sh`. |
| Healthcheck cron | `*/5 * * * * /usr/local/bin/bookmyclass-healthcheck.sh >> /var/log/bookmyclass-healthcheck.log 2>&1` | Confirmed from deployment docs | Root crontab. |
| Backup cron | `30 2 * * * /usr/local/bin/bookmyclass-db-backup-run.sh >> /var/log/bookmyclass-db-backup.log 2>&1` | Needs confirmation | Legacy docs show split backup/upload jobs at `02:30` and `02:45`. |
| Canonical auth secret env var | `AUTH_SECRET` | Confirmed from code/runtime | `NEXTAUTH_SECRET` appears only as fallback in one marketing helper. |
| Canonical Stripe env vars | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Confirmed from code/runtime | Seed/test-only Stripe price IDs are separate from core runtime Stripe keys. |
| Production email sender policy | `EMAIL_FROM` must use verified `@bookmyclass.app` sender domain when provider delivery is enabled | Confirmed from code/runtime | Test/e2e deterministic bypass does not require provider send. |

## Last Verified

- Verified by: `TODO_OPERATOR_NAME`
- Verified at: `TODO_YYYY-MM-DD`
- Verification method: `TODO (pm2 status, docker ps, crontab -l, nginx config, env audit)`
- Notes: update this section whenever operator confirms/changes live runtime facts.

## Deployment Flow (Canonical)

1. Merge to main
2. Create release tag (vX.Y.Z)
3. Deploy to UAT
4. Run:
   - E2E tests
   - load testing (k6)
5. If successful → deploy SAME tag to production

Rule:
- Never deploy directly to production from main
