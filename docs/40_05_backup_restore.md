# Backup and Restore

Purpose: summarize backup and restore posture currently documented for operations.

## Current Documented Model
- Local DB backup scripts and operational flow are documented.
- Offsite backup to Backblaze B2 is documented.
- Monitoring/heartbeat integration for backup checks is documented.
- Restore guidance exists in runbooks.
- Uploaded product images under `public/uploads/products/` are runtime media assets and must be included in backup/restore procedures.
- Restoring the database without uploaded media files may leave Product image references pointing at missing files.
- Production deploy steps must preserve uploaded media directories and must not wipe runtime uploads.

## Canonical Runtime Facts Status
- Exact active production backup script path and cron entry still require operator confirmation (see deployment baseline).

## Verification Pattern
- Use readiness/ops checklist workflow (`scripts/verify-production-readiness.sh`) to confirm recent backup and restore proof during release readiness checks.

## Canonical References
- `docs/00_02_deployment_baseline.md`
- `docs/50_04_db_backup_local_setup.md`
- `docs/50_05_backblaze_b2_backup_setup.md`
- `docs/50_09_monitoring_system_guide.md`
- `scripts/verify-production-readiness.sh`
