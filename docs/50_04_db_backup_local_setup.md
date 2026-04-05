# 💾 Database Backup Setup (Local) – BookMyClass

> Procedural guide only. Canonical deployment/runtime facts live in docs/00_02_deployment_baseline.md. If this file conflicts with baseline docs, follow 00_02_deployment_baseline.md and 00_01_system_baseline.md.


This guide sets up **automated daily PostgreSQL backups** on your server.

---

## 🎯 Goal

- Create daily DB backups
- Keep last 14 days
- Ensure restore is possible

---

## 1. Create Backup Folder

```bash
mkdir -p /var/backups/bookmyclass-postgres
chmod 700 /var/backups/bookmyclass-postgres
```

---

## 2. Create Backup Script

```bash
nano /usr/local/bin/bookmyclass-db-backup.sh
```

Paste:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_DIR="/var/backups/bookmyclass-postgres"
TIMESTAMP="$(date -u +%Y-%m-%d_%H-%M-%S)"
FILENAME="<db-name-from-deployment-baseline>_${TIMESTAMP}.sql.gz"

CONTAINER_NAME="<db-container-from-deployment-baseline>"
POSTGRES_DB="<db-name-from-deployment-baseline>"
POSTGRES_USER="<db-user-from-deployment-baseline>"

mkdir -p "$BACKUP_DIR"

docker exec "$CONTAINER_NAME" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "${BACKUP_DIR}/${FILENAME}"

find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime +14 -delete

echo "Backup created: ${BACKUP_DIR}/${FILENAME}"
```

Make executable:

```bash
chmod +x /usr/local/bin/bookmyclass-db-backup.sh
```

---

## 3. Test Backup

```bash
/usr/local/bin/bookmyclass-db-backup.sh
```

Check file:

```bash
ls -lh /var/backups/bookmyclass-postgres
```

---

## 4. Validate Backup Content

```bash
gzip -cd /var/backups/bookmyclass-postgres/YOUR_FILE.sql.gz | head -n 20
```

---

## 5. Test Restore

Create test DB:

```bash
docker exec -it <db-container-from-deployment-baseline> psql -U <db-user-from-deployment-baseline> -d postgres -c "CREATE DATABASE bookmyclass_restore_test;"
```

Restore:

```bash
gzip -cd /var/backups/bookmyclass-postgres/YOUR_FILE.sql.gz | docker exec -i <db-container-from-deployment-baseline> psql -U <db-user-from-deployment-baseline> -d bookmyclass_restore_test
```

Verify:

```bash
docker exec -it <db-container-from-deployment-baseline> psql -U <db-user-from-deployment-baseline> -d bookmyclass_restore_test -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
```

Cleanup:

```bash
docker exec -it <db-container-from-deployment-baseline> psql -U <db-user-from-deployment-baseline> -d postgres -c "DROP DATABASE bookmyclass_restore_test;"
```

---

## 6. Schedule Daily Backup

```bash
crontab -e
```

Add:

```cron
30 2 * * * /usr/local/bin/bookmyclass-db-backup.sh >> /var/log/bookmyclass-db-backup.log 2>&1
```

---

## ✅ Done When

- Backup file created daily
- Restore works
- Old backups cleaned automatically

---

## ⚠️ Limitations

- Backups stored on same server
- Does NOT protect against server loss

👉 Use Backblaze setup for offsite protection



