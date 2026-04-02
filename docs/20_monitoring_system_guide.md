# Monitoring System Guide

## Purpose

This monitoring setup is designed to answer three different questions without overlapping responsibilities:

- **Is the public app reachable right now?** → `monitor.bookmyclass.app`
- **Did the critical daily backup job complete?** → `checks.bookmyclass.app`
- **Why is the server slow or unstable?** → Netdata at `localhost:19999`
- **Is the app + DB technically healthy from inside the box?** → `/api/health` + local root healthcheck script

The goal is to keep monitoring simple, production-safe, and useful for beta.

---

## Monitoring Components

### 1. `https://checks.bookmyclass.app/`

This is the **critical scheduled-job alerting layer**.

Use it for:

- backup heartbeat monitoring
- future critical push checks if truly needed

Current role:

- confirms that the daily database backup job completed successfully enough to:
  - create the dump
  - verify a non-empty backup file
  - upload to Backblaze B2
  - send the success ping

What it means:

- **Green / recent** = the backup job finished and pinged the check
- **Red / overdue** = the backup job failed, did not run, or did not complete successfully enough to send the ping

Current source of ping:

```text
/usr/local/bin/bookmyclass-db-backup-run.sh
```

Do not use it for:

- public HTTP uptime
- PM2 state
- CPU/RAM diagnosis

---

### 2. `https://monitor.bookmyclass.app/`

This is the **external uptime dashboard** (Uptime Kuma).

Use it for:

- HTTP uptime checks
- endpoint response-time history
- public-facing availability tracking

Current monitors include:

- App Health (`/api/health`)
- Book a Class page
- Home page

What it means:

- **Green / Up** = the monitored URL is reachable and responding as expected
- **Red / Down** = the endpoint is failing from the outside

This is the first place to look for public reachability and uptime issues.

---

### 3. `https://bookmyclass.app/api/health`

This is the **application health truth endpoint**.

Use it for:

- confirming the app is running
- confirming the database is reachable

Healthy response example:

```json
{"ok":true,"db":"up","timestamp":"..."}
```

What it means:

- **200 OK** = application is running and database is reachable
- **503** = database is not reachable or app health check failed

This is the main technical truth for application readiness.

---

### 4. `/usr/local/bin/bookmyclass-healthcheck.sh`

This is the **internal server validation layer**.

Use it for:

- local `/api/health` check
- PM2 online check
- disk threshold check
- memory threshold check
- recent non-empty DB backup presence

Important implementation detail:
- the script runs from **root cron**
- PM2 is checked as **`deploy`**
- backup files remain **root-owned**

Current cron:

```cron
*/5 * * * * /usr/local/bin/bookmyclass-healthcheck.sh >> /var/log/bookmyclass-healthcheck.log 2>&1
```

Useful commands:

```bash
sudo /usr/local/bin/bookmyclass-healthcheck.sh
sudo tail -n 100 /var/log/bookmyclass-healthcheck.log
```

---

### 5. Netdata (`http://localhost:19999/` via SSH tunnel)

This is the **server diagnostics layer**.

Use it for:

- CPU usage
- RAM usage
- disk usage
- load spikes
- process-level inspection

This is not your first alerting screen. It is where you go when you need to understand why the server is under pressure.

Use SSH tunnel:

```bash
ssh -L 19999:127.0.0.1:19999 deploy@YOUR_SERVER_IP
```

Then open:

```text
http://localhost:19999/
```

---

## Correct Monitoring Flow

Always use the same order.

### Normal daily check

1. Open `checks.bookmyclass.app`
2. Confirm backup check is green and recent
3. Open `monitor.bookmyclass.app`
4. Confirm `App Health` is up
5. Stop there if everything is green

Do not open Netdata unless something looks wrong.

---

## Incident Flow

### Case 1: Backup check is failing

1. Open `checks.bookmyclass.app`
2. Confirm the backup heartbeat is overdue or failed
3. SSH into server
4. Check backup log:

```bash
sudo tail -n 100 /var/log/bookmyclass-db-backup.log
```

5. Check latest backup files:

```bash
sudo ls -lt /var/backups/bookmyclass-postgres | head
```

6. If needed, run manual backup test:

```bash
sudo /usr/local/bin/bookmyclass-db-backup-run.sh
```

---

### Case 2: App Health is down in monitor

1. Open `monitor.bookmyclass.app`
2. Confirm `App Health` is red/down
3. Test health endpoint directly:

```bash
curl -i https://bookmyclass.app/api/health
```

4. SSH into server and test locally:

```bash
curl -i http://127.0.0.1:3000/api/health
```

5. Check PM2:

```bash
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 status
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 logs bookmyclass-app --lines 100
```

6. If needed, run the internal healthcheck:

```bash
sudo /usr/local/bin/bookmyclass-healthcheck.sh
```

7. If health endpoint still fails, check DB and server resources

---

### Case 3: App is slow but not fully down

1. Open `monitor.bookmyclass.app`
2. Check for response-time spikes
3. Open Netdata
4. Inspect:
   - CPU
   - RAM
   - system load
   - disk usage
5. SSH into server if needed:

```bash
top
free -h
df -h
```

6. Check PM2 logs for runtime issues:

```bash
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 logs bookmyclass-app --lines 100
```

---

## What Each Tool Is Responsible For

### `checks.bookmyclass.app`

Responsible for:

- critical scheduled checks
- backup heartbeat monitoring
- alerting for missed critical jobs

Do not use it for:

- CPU/RAM diagnosis
- debugging response-time spikes
- generic app uptime

### `monitor.bookmyclass.app`

Responsible for:

- uptime visibility
- endpoint availability
- response-time trends

Do not use it for:

- backup success confirmation
- server resource diagnosis

### `/api/health`

Responsible for:

- application + database readiness truth

Do not use it for:

- backup status
- CPU/RAM checks

### `bookmyclass-healthcheck.sh`

Responsible for:

- local internal validation
- PM2 online state
- recent backup presence
- disk/memory thresholds

Do not use it as your public uptime dashboard.

### Netdata

Responsible for:

- infrastructure diagnosis
- CPU/RAM/disk/load investigation

Do not use it as your first alert screen.

---

## Healthy System Checklist

A healthy beta system looks like this:

- backup check is green in `checks.bookmyclass.app`
- `App Health` is green in `monitor.bookmyclass.app`
- `/api/health` returns `200`
- `sudo /usr/local/bin/bookmyclass-healthcheck.sh` returns `[OK]`
- Netdata shows:
  - CPU not pinned for long periods
  - available RAM still healthy
  - disk comfortably below 80%

---

## Operational Thresholds

For this server, use these practical thresholds:

- CPU sustained above **85%** for several minutes → investigate
- RAM sustained above **85%** or very low available memory → investigate
- disk above **80%** → action needed
- disk above **90%** → urgent
- backup heartbeat overdue → critical
- `/api/health` failing → critical
- `bookmyclass-healthcheck.sh` failing → critical

---

## Summary

Use this mental model:

- **Checks = scheduled-job alerts**
- **Monitor = public uptime visibility**
- **/api/health = app truth**
- **Local healthcheck = internal validation**
- **Netdata = diagnosis**

And use them in this order:

1. `checks.bookmyclass.app`
2. `monitor.bookmyclass.app`
3. `/api/health`
4. `/usr/local/bin/bookmyclass-healthcheck.sh`
5. Netdata

## Sentry Verification Checklist

After deploying with Sentry env vars configured, verify all core paths:

1. API error capture
- Trigger a known API failure (for example invalid checkout payload on `/api/checkout/session`).
- Confirm the error appears in Sentry with route context.

2. Server action error capture
- Trigger a controlled server action failure (for example invalid admin mutation input).
- Confirm the exception is visible in Sentry under a `serverAction/*` transaction.

3. Stripe webhook error capture
- Send a webhook event that fails processing in staging.
- Confirm Sentry event includes safe tags:
  - `stripe.event_type`
  - `stripe.event_id`
  - `checkout_session_id` (when available)
  - `customer_id` (when available)

4. Render/global error capture
- Trigger a render-time crash in a non-critical page.
- Confirm `app/global-error.tsx` captures the exception and event is visible in Sentry.

5. Validate required event metadata
- Confirm each test event includes:
  - `environment` (production on live deploys)
  - `release` (deploy version or commit SHA)
  - actionable route/action naming context
- For webhook errors, confirm Stripe tags are present and no raw payload dump is captured.

## Release Verification

Run this from the repo root before each production release:

```bash
npm run ops:verify-production-readiness -- \
  --confirm-kuma \
  --confirm-backup-heartbeat \
  --confirm-local-healthcheck \
  --confirm-latest-backup \
  --confirm-restore-proof
```

### Confirmation flags

- `--confirm-kuma`: you verified `monitor.bookmyclass.app` is up for key endpoints.
- `--confirm-backup-heartbeat`: you verified `checks.bookmyclass.app` shows the backup heartbeat as green/recent.
- `--confirm-local-healthcheck`: you ran `sudo /usr/local/bin/bookmyclass-healthcheck.sh` on the server and it passed.
- `--confirm-latest-backup`: you verified the latest backup artifact exists and is non-empty.
- `--confirm-restore-proof`: you verified recent restore proof exists (documented restore validation evidence).

### Pass/Fail criteria

- Pass:
  - all five confirmation flags are explicitly provided
  - `https://bookmyclass.app/api/health` returns HTTP `200`
- Fail:
  - any required confirmation flag is missing
  - `/api/health` does not return `200`
  - command exits non-zero in all fail cases
