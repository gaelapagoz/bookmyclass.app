# Monitoring and Alerting

Purpose: document the current observability and monitoring setup from repo + runbooks.

## In-Application Monitoring (Code)
- Sentry is configured for server, edge, and client runtimes.
- Sentry is enabled in production mode and uses event sanitization.
- Health endpoint exists at `GET /api/health` and verifies DB readiness.

## Operational Monitoring (Runbook-Documented)
- Uptime Kuma checks are documented.
- Healthchecks heartbeat for backup jobs is documented.
- Netdata host monitoring is documented.
- PM2 status/log checks are documented in ops guides.

## Gift-Card Maintenance
- Manual/scheduled cleanup endpoint: `GET /api/cron/gift-cards/maintenance`.
- Authentication: `Authorization: Bearer $CRON_SECRET`.
- Current scope: expired `RESERVED` redemption release, batch size 100, no reconciliation retry.
- Operators should schedule this route only after release validation confirms `CRON_SECRET`.
- Cleanup failures emit `gift_card.reservation_cleanup_failed` to structured logs, Sentry, and `AuditLog`.

## Gift-Card Reconciliation Workflow
- Admin visibility is available under `/admin/gift-cards` and the admin gift-card API.
- `ADMIN` can inspect wallet balance, ledger history, redemption records, and reconciliation cases.
- `ADMIN` can add operational notes, but cannot resolve `MANUAL_REVIEW` or mutate balances.
- `MASTER_ADMIN` can resolve `MANUAL_REVIEW` only after the service verifies wallet, ledger, payment, order, and redemption consistency.
- Resolved cases are hidden from default reconciliation lists and can be included with a resolved/all filter.

## Current Limitations
- Live monitor configuration state cannot be fully verified from repo alone.
- Operator confirmation is required for current production monitor endpoints, alert channels, and schedules.

## Canonical References
- `src/app/api/health/route.ts`
- `instrumentation.ts`
- `instrumentation-client.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- `docs/50_06_monitoring_alerting_setup.md`
- `docs/50_07_monitoring_netdata_setup.md`
- `docs/50_09_monitoring_system_guide.md`
