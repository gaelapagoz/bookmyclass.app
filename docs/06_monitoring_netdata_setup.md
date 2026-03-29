# Netdata Configuration for BookMyClass

## Goal
Use Netdata as the private host-monitoring dashboard for CPU, RAM, disk, and process visibility.

## Role of Netdata
Netdata is for **server metrics and troubleshooting**.

Use it for:
- CPU usage
- Load average
- RAM usage
- Disk usage
- Process visibility

Do **not** use it as a replacement for the app health check.

For this stack:
- **Kuma** = app/database uptime via `/api/health`
- **Netdata** = host resource visibility

## Install
On Ubuntu:
```bash
wget -O /tmp/netdata-kickstart.sh https://my-netdata.io/kickstart.sh
sh /tmp/netdata-kickstart.sh --stable-channel
```

## Lock Netdata to localhost
This is mandatory.

Edit:
```bash
sudo editor /etc/netdata/netdata.conf
```

Set:
```ini
[web]
    bind to = 127.0.0.1:19999
```

Restart:
```bash
sudo systemctl restart netdata
```

Verify:
```bash
sudo ss -ltnp | grep 19999
```
Expected:
```text
127.0.0.1:19999
```

## Validate the API locally
```bash
curl http://127.0.0.1:19999/api/v1/info
```

This should return JSON.

## Access the dashboard safely
Use an SSH tunnel from your local machine:
```bash
ssh -L 19999:127.0.0.1:19999 deploy@bookmyclass-prod
```

Then open:
```text
http://localhost:19999
```

On the welcome screen:
- click **Skip and use the dashboard anonymously**
- do not sign in to Netdata Cloud for beta

## What to Monitor

### CPU
Watch:
- CPU usage
- Load average

Thresholds:
- sustained CPU above `85%` = investigate
- load average above `2` for a 2-core server = investigate

### RAM
Watch:
- RAM used
- available memory

Thresholds:
- available memory below `500 MB` = warning
- sustained RAM above `85%` = investigate

### Swap
If swap is added later:
- swap should stay near `0`
- any steady increase = investigate

### Disk
Watch:
- `/` usage

Thresholds:
- above `80%` = action
- above `90%` = urgent

### Processes
Watch:
- Node/PM2 process
- postgres process if local

Useful when debugging slowdowns or leaks.

## Check Current Alarms
```bash
curl -s http://127.0.0.1:19999/api/v1/alarms | jq '.alarms | to_entries[] | select(.value.status != "CLEAR")'
```

Example warning already seen:
- `system_post_update_reboot_status` = server needs reboot after package updates

## Useful Commands

### Netdata service status
```bash
systemctl status netdata
```

### Current CPU / memory / disk baseline
```bash
top -b -n 1 | head -n 20
free -h
df -h
```

### Safe CPU live test
```bash
yes > /dev/null &
yes > /dev/null &
```
Then stop it:
```bash
pkill yes
```

Do **not** run aggressive RAM stress tests on production.

## What Not To Do
- Do not expose Netdata publicly
- Do not add Netdata Cloud now
- Do not proxy Netdata publicly through nginx
- Do not add Prometheus/Grafana for beta
- Do not add app-level CPU/RAM endpoints

## Production Notes
- Netdata is for visibility, not your primary uptime monitor
- Keep `/api/health` in Kuma as the main availability signal
- Review CPU, RAM, and disk quickly once per day during beta
