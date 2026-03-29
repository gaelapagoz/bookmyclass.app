# PM2 Auto-Start Setup for BookMyClass

## Goal
Ensure the Next.js app starts automatically after a server reboot.

## Root Cause This Solves
If PM2 is only used to start the app manually, the process disappears after reboot and nginx returns `502 Bad Gateway` because nothing is listening on port `3000`.

## Assumptions
- app lives at `/var/www/bookmyclass`
- app runs as user `deploy`
- nginx proxies traffic to `127.0.0.1:3000`
- PM2 is installed globally

## One-Time Setup

### 1. Start the app with PM2 as `deploy`
```bash
su - deploy
cd /var/www/bookmyclass
pm2 start npm --name "bookmyclass-app" -- start
```

### 2. Save the PM2 process list
```bash
pm2 save
```

This writes the saved process list to:
```text
/home/deploy/.pm2/dump.pm2
```

### 3. Install PM2 startup integration
Run as `deploy`:
```bash
pm2 startup
```

PM2 will print an exact command. Run that exact command with `sudo`.

Example:
```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u deploy --hp /home/deploy
```

This creates and enables the systemd unit:
```text
/etc/systemd/system/pm2-deploy.service
```

### 4. Save again after startup is configured
```bash
pm2 save
```

## Validation

### Check the PM2 service is enabled
```bash
systemctl is-enabled pm2-deploy
```
Expected:
```text
enabled
```

### Validate PM2 from root safely
Use:
```bash
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 status
```

Do not use root-owned PM2.

### Reboot test
```bash
sudo reboot
```

After reconnecting:
```bash
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 status
curl http://127.0.0.1:3000/api/health
curl -i https://bookmyclass.app/api/health
```

Expected:
- `pm2 status` already shows `bookmyclass-app` running
- local `/api/health` returns `200`
- public `/api/health` returns `200`

## Useful Commands

### See PM2-managed processes
```bash
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 status
```

### Restart the app
```bash
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 restart bookmyclass-app
```

### View logs
```bash
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 logs bookmyclass-app
```

### Show the saved process dump
```bash
cat /home/deploy/.pm2/dump.pm2
```

### Inspect PM2 startup logs
```bash
journalctl -u pm2-deploy -b --no-pager
```

## Common Mistakes
- running `pm2 save` but not executing the generated `pm2 startup` command
- running PM2 as `root` instead of `deploy`
- checking PM2 as root and assuming the deploy-owned process is missing
- using a generic process name like `app`
- assuming it works without doing a real reboot test
- starting the app manually after reboot before validating auto-start

## Production Notes
- keep PM2 owned by `deploy`, not `root`
- keep nginx separate as the public entrypoint
- treat reboot validation as mandatory whenever startup behavior changes
