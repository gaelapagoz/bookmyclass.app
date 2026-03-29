# 📡 Monitoring + Alerting Setup – BookMyClass

This guide defines the **actual beta-stage monitoring setup** for BookMyClass.

The goal is not enterprise observability.
The goal is to detect the failures that actually matter:

- app is down
- nginx is broken
- PM2 app is not running
- database backup failed
- disk is getting full
- memory pressure is too high
- the public site is unreachable

---

## 🎯 Goal

Use a **clear split of responsibility**:

- **`monitor.bookmyclass.app` (Uptime Kuma)** → public uptime monitoring
- **`checks.bookmyclass.app` (Healthchecks)** → daily backup-job heartbeat
- **`/usr/local/bin/bookmyclass-healthcheck.sh`** → internal server validation
- **Netdata** → host diagnostics only

Do not overlap these responsibilities.

---

## 1. Monitoring Strategy

Use this model:

### A. Internal server check
Used for:
- local `/api/health`
- PM2 process state
- disk usage
- memory usage
- recent non-empty DB backup presence

This is handled by:

```text
/usr/local/bin/bookmyclass-healthcheck.sh
```

Run by **root cron** every 5 minutes.

### B. External uptime monitor
Used for:
- homepage reachability
- booking page reachability
- health endpoint reachability
- SSL/domain visibility from outside

This is handled by:

```text
https://monitor.bookmyclass.app/
```

### C. Scheduled backup heartbeat
Used for:
- confirming the daily backup job completed successfully enough to:
  - create the dump
  - verify it is non-empty
  - upload it to Backblaze B2
  - send a success heartbeat

This is handled by:

```text
https://checks.bookmyclass.app/
```

---

## 2. Health Endpoint

Do not rely on the homepage as a health check.

Use a dedicated route:

```text
/api/health
```

Healthy response example:

```json
{"ok":true,"db":"up","timestamp":"..."}
```

Expected behavior:
- `200` when app + DB are healthy
- `503` when DB/app health fails

### Validation

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS https://bookmyclass.app/api/health
```

If this endpoint fails, treat it as production-critical.

---

## 3. PM2 Monitoring Basics

PM2 is owned by **`deploy`**, not `root`.

Useful commands:

```bash
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 status
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 logs bookmyclass-app --lines 100
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 monit
```

Important:
- `status` confirms process state
- `logs` confirms runtime issues
- `monit` gives live CPU/memory/process view

PM2 auto-start should already be configured separately.

---

## 4. Server Health Check Script

Actual script path:

```bash
/usr/local/bin/bookmyclass-healthcheck.sh
```

Actual behavior:
- checks local app health
- checks PM2 process as `deploy`
- checks disk usage
- checks memory usage
- checks latest recent backup exists and is non-empty

Use this exact script:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

APP_URL="http://127.0.0.1:3000/api/health"
BACKUP_DIR="/var/backups/bookmyclass-postgres"
MAX_DISK_PERCENT=85
MAX_MEMORY_PERCENT=90
APP_USER="deploy"
APP_PM2_HOME="/home/deploy/.pm2"

fail() {
  echo "[FAIL] $1"
  exit 1
}

curl -fsS "$APP_URL" >/dev/null || fail "App health endpoint failed"

sudo -u "$APP_USER" env PM2_HOME="$APP_PM2_HOME" pm2 describe bookmyclass-app >/dev/null 2>&1   || fail "PM2 process missing"

PM2_STATUS="$(
  sudo -u "$APP_USER" env PM2_HOME="$APP_PM2_HOME" pm2 jlist | node -e '
let s="";
process.stdin.on("data",d=>s+=d);
process.stdin.on("end",()=>{
  const arr=JSON.parse(s);
  const app=arr.find(x=>x.name==="bookmyclass-app");
  if(!app){ process.exit(2); }
  process.stdout.write(app.pm2_env.status || "");
});
'
)"

[ "$PM2_STATUS" = "online" ] || fail "PM2 process not online"

DISK_PERCENT="$(df / | awk 'NR==2 {gsub("%","",$5); print $5}')"
[ "$DISK_PERCENT" -lt "$MAX_DISK_PERCENT" ] || fail "Disk usage too high: ${DISK_PERCENT}%"

MEMORY_PERCENT="$(free | awk '/Mem:/ {printf("%.0f", $3/$2 * 100)}')"
[ "$MEMORY_PERCENT" -lt "$MAX_MEMORY_PERCENT" ] || fail "Memory usage too high: ${MEMORY_PERCENT}%"

LATEST_BACKUP="$(find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime -2 -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2- || true)"
[ -n "$LATEST_BACKUP" ] || fail "No recent database backup found"
[ -s "$LATEST_BACKUP" ] || fail "Latest database backup is empty: $LATEST_BACKUP"

echo "[OK] Healthcheck passed"
```

---

## 5. Test the Health Check Script

Run it as **root**, not `deploy`:

```bash
sudo /usr/local/bin/bookmyclass-healthcheck.sh
```

Expected:

```text
[OK] Healthcheck passed
```

Why root:
- the backup directory is root-owned
- PM2 is still checked correctly via `sudo -u deploy ...`

If it fails, fix the issue before moving on.

---

## 6. Health Check Cron

Use **root crontab**, not deploy crontab:

```bash
sudo crontab -e
```

Actual cron entry:

```cron
*/5 * * * * /usr/local/bin/bookmyclass-healthcheck.sh >> /var/log/bookmyclass-healthcheck.log 2>&1
```

Validate:

```bash
sudo tail -n 50 /var/log/bookmyclass-healthcheck.log
```

---

## 7. External Uptime Monitoring

Use **Uptime Kuma** at:

```text
https://monitor.bookmyclass.app/
```

Current practical monitors:
- Home Page
- Book a Class
- App Health (`https://bookmyclass.app/api/health`)

Recommended settings:
- interval: 60 seconds or 5 minutes
- email alerts enabled
- alert on consecutive failures, not one blip

Why this matters:
- catches DNS / SSL / nginx / public reachability failures
- catches full app outages from outside the server

---

## 8. Backup Monitoring

The daily backup job is handled by:

```text
/usr/local/bin/bookmyclass-db-backup-run.sh
```

This script does:
- local Postgres dump
- gzip to local file
- non-empty file validation
- Backblaze B2 upload
- Healthchecks heartbeat
- local retention cleanup

The real root cron entry is:

```cron
30 2 * * * /usr/local/bin/bookmyclass-db-backup-run.sh >> /var/log/bookmyclass-db-backup.log 2>&1
```

### Backup log checks

```bash
sudo tail -n 50 /var/log/bookmyclass-db-backup.log
sudo find /var/backups/bookmyclass-postgres -type f -name "*.sql.gz" | tail
```

### Healthchecks role

Use:

```text
https://checks.bookmyclass.app/
```

This confirms the **daily backup job heartbeat** only.

Green means:
- the scheduled backup script reached the success ping

It does **not** mean:
- the website is up
- PM2 is healthy
- `/api/health` is healthy

---

## 9. Alerting

For beta, email alerts are enough.

Use:
- **Uptime Kuma** for public-site alerts
- **Healthchecks** for backup-job overdue alerts

Do not add PagerDuty, Grafana, Prometheus, or other heavy alerting yet.

---

## 10. Validate Stripe / Payment Monitoring Manually

There is no separate automated payment monitor in this setup.

For beta, do a manual payment sanity check periodically:
- complete one low-risk payment test in test mode
- verify success page loads
- verify DB/payment state is correct
- verify dashboard reflects payment result

Useful logs:

```bash
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 logs bookmyclass-app --lines 100
```

Watch for:
- webhook signature failures
- Stripe secret misconfiguration
- checkout/session issues

---

## 11. Deployment Validation Checklist

After every production deploy, run:

```bash
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 status
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS https://bookmyclass.app/api/health
sudo /usr/local/bin/bookmyclass-healthcheck.sh
sudo tail -n 20 /var/log/bookmyclass-db-backup.log
sudo tail -n 20 /var/log/bookmyclass-healthcheck.log
```

---

## 12. What Not To Add Yet

Do **not** add yet unless you have a real pain point:

- Prometheus
- Grafana
- Loki
- Elasticsearch
- distributed tracing
- advanced APM
- Slack/PagerDuty escalation trees
- duplicate checks for the same responsibility

That is overkill for beta.

---

## 13. Failure Scenarios This Covers

This setup helps you catch:

- PM2 process crash
- app no longer responding
- public website outage
- nginx/domain/SSL failure
- disk filling up
- memory pressure
- missing recent DB backup
- overdue daily backup heartbeat

This does **not** fully catch:
- subtle business-logic bugs
- silent Stripe data mismatch
- bad UX issues
- restore-test failure unless you run restore drills
- data corruption that still returns HTTP 200

That is why UAT and restore testing still matter.

---

## 14. Suggested Weekly Routine

During beta, do this once or twice a week:

```bash
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 status
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 logs bookmyclass-app --lines 100
sudo tail -n 50 /var/log/bookmyclass-healthcheck.log
sudo tail -n 50 /var/log/bookmyclass-db-backup.log
df -h
free -h
```

Also:
- open `https://monitor.bookmyclass.app/`
- open `https://checks.bookmyclass.app/`
- verify `/api/health` is up
- verify a recent backup exists in Backblaze
- perform one end-to-end payment sanity check if needed

---

## ✅ Done When

You are done when:

- `/api/health` exists and works
- PM2 is stable
- healthcheck script passes
- root cron runs health checks
- Uptime Kuma monitors are active
- Healthchecks backup heartbeat is active
- backup logs are monitored
- you can detect real failures without manually discovering them

---

## 🚀 Next Step After Monitoring

After this, the next hardening step should be:

- security audit / pen test
- beta UAT
- rollout checklist

Not a bigger monitoring stack.
