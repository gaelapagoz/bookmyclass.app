# 📡 Monitoring + Alerting Setup – BookMyClass

This guide sets up **practical beta-stage monitoring** for BookMyClass.

The goal is not enterprise observability.
The goal is to detect the failures that actually matter:

- app is down
- Nginx is broken
- database backup failed
- disk is getting full
- PM2 process crashed
- Stripe/payment flow is broken silently

---

## 🎯 Goal

Set up a **simple monitoring baseline** with:

- health endpoint
- PM2 process checks
- disk and memory checks
- backup job monitoring
- external uptime monitoring
- email alerts

---

## 1. Monitoring Strategy

Use this simple model:

### Internal checks on the server
Used for:
- PM2 process
- disk space
- recent backup presence
- local app health

### External uptime monitor
Used for:
- public website availability
- SSL / domain reachability
- alerting when site is down

This combination is enough for beta.

---

## 2. Add a Real Health Endpoint

Do not rely on the homepage as a health check.

Create a dedicated route:

```text
/api/health
```

It should return:

- app status = ok
- database status = ok

Example response:

```json
{ "status": "ok", "database": "ok" }
```

### Validation
After deployment, this should work:

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS https://bookmyclass.app/api/health
```

If this endpoint fails, treat it as production-critical.

---

## 3. PM2 Monitoring Basics

PM2 already gives you useful process monitoring.

Use:

```bash
pm2 status
pm2 logs bookmyclass-app --lines 100
pm2 monit
```

Important:
- `status` confirms process state
- `logs` confirms runtime issues
- `monit` gives live CPU/memory/process view

Keep PM2 startup enabled:

```bash
pm2 save
pm2 startup
```

---

## 4. Create a Server Health Check Script

Create:

```bash
nano /usr/local/bin/bookmyclass-healthcheck.sh
```

Paste:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

APP_URL="http://127.0.0.1:3000/api/health"
BACKUP_DIR="/var/backups/bookmyclass-postgres"
MAX_DISK_PERCENT=85
MAX_MEMORY_PERCENT=90

fail() {
  echo "[FAIL] $1"
  exit 1
}

# 1. App health
curl -fsS "$APP_URL" >/dev/null || fail "App health endpoint failed"

# 2. PM2 process check
pm2 describe bookmyclass-app >/dev/null 2>&1 || fail "PM2 process missing"

PM2_STATUS="$(pm2 jlist | node -e '
let s="";
process.stdin.on("data",d=>s+=d);
process.stdin.on("end",()=>{
  const arr=JSON.parse(s);
  const app=arr.find(x=>x.name==="bookmyclass-app");
  if(!app){ process.exit(2); }
  process.stdout.write(app.pm2_env.status || "");
});
')"

[ "$PM2_STATUS" = "online" ] || fail "PM2 process not online"

# 3. Disk check
DISK_PERCENT="$(df / | awk 'NR==2 {gsub("%","",$5); print $5}')"
[ "$DISK_PERCENT" -lt "$MAX_DISK_PERCENT" ] || fail "Disk usage too high: ${DISK_PERCENT}%"

# 4. Memory check
MEMORY_PERCENT="$(free | awk '/Mem:/ {printf("%.0f", $3/$2 * 100)}')"
[ "$MEMORY_PERCENT" -lt "$MAX_MEMORY_PERCENT" ] || fail "Memory usage too high: ${MEMORY_PERCENT}%"

# 5. Backup freshness check
LATEST_BACKUP="$(find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime -2 | head -n 1 || true)"
[ -n "$LATEST_BACKUP" ] || fail "No recent database backup found"

echo "[OK] Healthcheck passed"
```

Make it executable:

```bash
chmod +x /usr/local/bin/bookmyclass-healthcheck.sh
```

---

## 5. Test the Health Check Script

Run manually:

```bash
/usr/local/bin/bookmyclass-healthcheck.sh
```

Expected:

```text
[OK] Healthcheck passed
```

If it fails, fix that issue before moving on.

---

## 6. Add Health Check Cron

Run every 5 minutes:

```bash
crontab -e
```

Add:

```cron
*/5 * * * * /usr/local/bin/bookmyclass-healthcheck.sh >> /var/log/bookmyclass-healthcheck.log 2>&1
```

This gives you a rolling server-side health log.

---

## 7. Add External Uptime Monitoring

Use any external uptime service you trust.

Minimum checks to add:

### Check 1 – Homepage
```text
https://bookmyclass.app/
```

### Check 2 – Health endpoint
```text
https://bookmyclass.app/api/health
```

Recommended settings:
- interval: 5 minutes
- alert by email
- alert on consecutive failures, not a single one

Why external monitoring matters:
- catches DNS / SSL / Nginx / public reachability failures
- catches full app outages from outside the server

---

## 8. Monitor Backup Success

Your DB backup cron already writes to:

```text
/var/log/bookmyclass-db-backup.log
```

You should check periodically:

```bash
tail -n 50 /var/log/bookmyclass-db-backup.log
```

Also verify files still appear:

```bash
ls -lh /var/backups/bookmyclass-postgres
```

If using Backblaze upload too, also watch:

```bash
tail -n 50 /var/log/bookmyclass-db-upload.log
```

---

## 9. Add Simple Alert Hooks (Email First)

For beta, **email alerts are enough**.

You do not need PagerDuty, Grafana, Prometheus, or a full observability stack yet.

If your external uptime monitor supports email alerts, enable them for:
- homepage down
- health endpoint down
- SSL/domain failure

For internal checks, the minimum acceptable setup is:
- cron logs written to disk
- manual daily review during beta
- external email alert on website outage

If you want server-side emails too, add those later once the basic checks are stable.

---

## 10. Validate Stripe / Payment Monitoring Manually

There is no simple “Stripe is healthy” endpoint in your app unless you add one.

For beta, monitor payment by doing:

### Daily / regular manual check
- complete one low-risk payment test in test mode
- verify success page loads
- verify DB record created
- verify dashboard reflects payment result

### Log checks after payment work
```bash
pm2 logs bookmyclass-app --lines 100
```

Watch for:
- webhook signature failures
- Stripe secret misconfig
- redirect/session issues

This is enough for beta.
Do not overbuild payment monitoring yet.

---

## 11. Add a Deployment Validation Checklist

Every production update should end with these checks:

```bash
pm2 status
pm2 logs bookmyclass-app --lines 50
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS https://bookmyclass.app/api/health
ls -lh /var/backups/bookmyclass-postgres | tail
```

This should become habit.

---

## 12. What Not To Add Yet

Do **not** add these yet unless you have a real pain point:

- Prometheus
- Grafana
- Loki
- Elasticsearch
- distributed tracing
- advanced APM
- multi-node observability
- Slack / PagerDuty escalation trees

That is overkill for your current stage.

---

## 13. Failure Scenarios This Covers

This setup helps you catch:

- PM2 process crash
- app no longer responding
- public website outage
- Nginx/domain/SSL failure
- disk filling up
- memory pressure
- missing recent DB backup

This does **not** fully catch:
- subtle business logic bugs
- silent Stripe data mismatch
- bad UX issues
- data corruption that still returns HTTP 200

That is why UAT and manual smoke tests still matter.

---

## 14. Suggested Weekly Monitoring Routine

During beta, do this once or twice a week:

```bash
pm2 status
pm2 logs bookmyclass-app --lines 100
tail -n 50 /var/log/bookmyclass-healthcheck.log
tail -n 50 /var/log/bookmyclass-db-backup.log
tail -n 50 /var/log/bookmyclass-db-upload.log
df -h
free -h
```

Also:
- open the homepage
- open `/api/health`
- verify a recent DB backup exists in Backblaze
- perform one end-to-end payment sanity check if needed

---

## ✅ Done When

You are done when:

- `/api/health` exists and works
- PM2 is stable
- health check script passes
- cron runs health checks
- external uptime alerts are active
- backup logs are monitored
- you can detect app/down issues without manually discovering them

---

## 🚀 Next Step After Monitoring

After this, your next hardening step should be:

- security audit / pen test
- beta UAT
- rollout checklist

Not a bigger monitoring stack.
