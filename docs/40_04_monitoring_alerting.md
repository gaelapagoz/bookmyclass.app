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
