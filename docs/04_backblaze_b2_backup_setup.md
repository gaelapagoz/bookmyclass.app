# ☁️ Offsite Backup – Backblaze B2 (BookMyClass)

This guide configures automatic upload of your DB backups to Backblaze B2.

---

## 🎯 Goal

- Keep offsite copies of DB backups
- Protect against server loss
- Automate uploads

---

## 1. Install B2 CLI

```bash
pip install --upgrade b2
```

If pip missing:

```bash
apt install -y python3-pip
pip install b2
```

---

## 2. Create Backblaze Bucket

In Backblaze dashboard:
- Create bucket: `bookmyclass-db-backups`
- Private bucket

---

## 3. Create Application Key

- Generate key with access to that bucket
- Save:
  - keyID
  - applicationKey

---

## 4. Authorize CLI

```bash
b2 authorize-account
```

Enter:
- keyID
- applicationKey

---

## 5. Test Upload

```bash
b2 upload-file bookmyclass-db-backups /var/backups/bookmyclass-postgres/YOUR_FILE.sql.gz YOUR_FILE.sql.gz
```

---

## 6. Create Upload Script

```bash
nano /usr/local/bin/bookmyclass-db-backup-upload.sh
```

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_DIR="/var/backups/bookmyclass-postgres"
LATEST_FILE=$(ls -t $BACKUP_DIR/*.sql.gz | head -n 1)

b2 upload-file bookmyclass-db-backups "$LATEST_FILE" "$(basename $LATEST_FILE)"

echo "Uploaded $LATEST_FILE to Backblaze"
```

```bash
chmod +x /usr/local/bin/bookmyclass-db-backup-upload.sh
```

---

## 7. Test Upload Script

```bash
/usr/local/bin/bookmyclass-db-backup-upload.sh
```

---

## 8. Add to Cron

```bash
crontab -e
```

Add:

```cron
45 2 * * * /usr/local/bin/bookmyclass-db-backup-upload.sh >> /var/log/bookmyclass-db-upload.log 2>&1
```

---

## 9. Verify in Backblaze

Check bucket → file should appear.

---

## ⚠️ Notes

- Upload runs AFTER backup (02:30 → 02:45)
- Do not expose keys
- Keep bucket private

---

## ✅ Done When

- Files appear daily in Backblaze
- Upload script runs without error
- Restore test possible from B2
