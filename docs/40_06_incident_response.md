# Incident Response

Purpose: provide the current incident-response baseline that is supported by existing tooling and docs.

## Detection Inputs Available
- CI failures (`ci` and `e2e` jobs).
- Sentry error monitoring in production runtime.
- `/api/health` endpoint status.
- Uptime Kuma / Healthchecks / Netdata (runbook-documented).

## Immediate Response Workflow (Current)
1. Confirm scope and severity from Sentry, health checks, and runtime logs.
2. Verify app/process/db status (PM2, database availability, health endpoint).
3. Identify most recent change/tag and determine rollback vs fix-forward.
4. If rollback is needed, execute runbook-driven deployment rollback to last known-good tag.
5. Validate recovery via health endpoint + smoke paths.

## Repository Status
- No dedicated incident automation workflow is committed.
- Response is currently operator-runbook driven.

## Canonical References
- `docs/50_09_monitoring_system_guide.md`
- `docs/50_08_pm2_autostart_setup.md`
- `docs/50_02_bookmyclass_server_setup_updated.md`
- `docs/40_03_release_process.md`
