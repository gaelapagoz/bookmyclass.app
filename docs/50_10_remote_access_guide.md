# Remote Access Guide (SSH Tunnels)

> Procedural guide only. Canonical deployment/runtime facts live in docs/00_02_deployment_baseline.md. If this file conflicts with baseline docs, follow 00_02_deployment_baseline.md and 00_01_system_baseline.md.

Scope: secure remote access and SSH tunnel procedures only.


This document explains how to securely access internal services (database, Prisma Studio, monitoring) on the production server without exposing them publicly.

---

## Overview

All access is done via **SSH tunnels**.

This ensures:
- No public exposure of sensitive services (DB, admin tools)
- Secure debugging and inspection
- Safe production practices for beta

---

## Prerequisites

- SSH access configured
- Private key available (`~/.ssh/bookmyclass_hetzner`)
- Server host/IP: `46.62.208.152` (day-to-day)
- Alternate host/IP seen in existing ops docs: `37.27.192.11`
- If these differ from current infra, confirm and update `docs/00_02_deployment_baseline.md`

---

## 1. Access Prisma Studio

### Command
```bash
ssh -L 51212:localhost:51212 deploy@46.62.208.152
```

### Usage
- Start Prisma Studio on the server:
  ```bash
  npx prisma studio
  ```
- Open in browser:
  http://localhost:51212

### Purpose
- Inspect and edit database records
- Debug application data

---

## 2. Access PostgreSQL Database

### Command
```bash
ssh -L 5432:localhost:5432 deploy@46.62.208.152
```

### Usage
Connect using any database client:
- Host: `localhost`
- Port: `5432`
- Credentials: same as production DB

### Purpose
- Query data
- Debug issues (credits, subscriptions, bookings)

---

## 3. Access Monitoring (Netdata)

### Command
```bash
ssh -L 19999:127.0.0.1:19999 deploy@46.62.208.152
```

### Usage
Open in browser:
http://localhost:19999

### Purpose
- Monitor CPU, memory, disk
- Detect production issues early

---

## 4. Root Server Access (Full Control)

### Command
```bash
ssh -i ~/.ssh/bookmyclass_hetzner root@46.62.208.152
```

### Purpose
- Server configuration
- Deployment fixes
- Infrastructure debugging

### ⚠️ Warning
- Do NOT use root for daily operations
- Prefer `deploy` user for normal tasks

---

## Best Practices

- Always use SSH tunnels for internal services
- Never expose database or admin tools publicly
- Close tunnels when not in use
- Use root access only when strictly necessary

---

## 5. Root Server for Monitoring (Full Control)

### Command
```bash
ssh -i ~/.ssh/bookmyclass_hetzner root@37.27.192.11
```

### Purpose
- Server configuration
- Deploy monitoring system

### ⚠️ Warning
- Do NOT use root for daily operations
- Prefer `deploy` user for normal tasks

---

## Best Practices

- Always use SSH tunnels for internal services
- Never expose database or admin tools publicly
- Close tunnels when not in use
- Use root access only when strictly necessary

## Optional: Run All Tunnels at Once

You can create a script to open all tunnels together.

### Example
```bash
#!/bin/bash

ssh -L 51212:localhost:51212 \
    -L 5432:localhost:5432 \
    -L 19999:127.0.0.1:19999 \
    deploy@46.62.208.152
```

---

## Summary

| Service         | Local URL / Port        | Purpose                     |
|----------------|-------------------------|-----------------------------|
| Prisma Studio  | http://localhost:51212  | DB UI inspection            |
| PostgreSQL     | localhost:5432          | Direct DB access            |
| Netdata        | http://localhost:19999  | Server monitoring           |
| Root SSH       | SSH login               | Full server control         |
| Root SSH       | SSH login               | Full server control         |

---

## Key Principle

> Keep all sensitive services private.  
> Use SSH tunnels as the only access layer.


---

## 1. Configuring Raspberry Pi

### Purpose

The Raspberry Pi acts as:

* Monitoring node (Uptime Kuma, Netdata)
* Secure access hub (Tailscale)
* Lightweight utility node

### Base Setup

* Raspberry Pi OS installed
* SSH enabled
* System updated:

  * `sudo apt update && sudo apt upgrade -y`

### Installed Components

* Docker (for Uptime Kuma)
* PM2 (if used for any node processes)
* Nginx (optional, not required for monitoring)
* Git (for repo access)

### Notes

* Keep Pi lightweight (4GB RAM constraint)
* Do not run heavy workloads
* This node must remain stable and always-on

---

## 2. Configuring Netdata

### Purpose

* Monitor host-level metrics:

  * CPU
  * Memory
  * Disk
  * Network

### Installation

* Installed via official kickstart script:

  * `curl -fsSL https://my-netdata.io/kickstart.sh | sudo bash -s -- --install-type any --non-interactive`

### Security Configuration (CRITICAL)

Edit:

* `/etc/netdata/netdata.conf`

Set:

* `bind to = 127.0.0.1`

### Reason

* Netdata must NOT be publicly exposed
* Access is only allowed via SSH tunnel or Tailscale

### Service Management

* Restart:

  * `sudo systemctl restart netdata`

### Validation

* `curl http://localhost:19999` returns HTML

---

## 3. Configuring Uptime Kuma

### Purpose

* External uptime monitoring (application-level)

### Deployment

* Runs via Docker:

```bash
docker run -d \
  --name uptime-kuma \
  -p 3001:3001 \
  -v uptime-kuma:/app/data \
  --restart=always \
  louislam/uptime-kuma
```

### Access

* Initially via:

  * `http://<pi-ip>:3001`

### Monitors Configured

* PROD API: `/api/health`
* PROD Homepage
* UAT API

### Alerts

* Telegram notifications configured

---

## 4. Configuring Tailscale

### Purpose

* Private network between:

  * Raspberry Pi
  * PROD server
  * UAT server
  * Developer machine

### Installation

* `curl -fsSL https://tailscale.com/install.sh | sh`

### Activation

* `sudo tailscale up`
* Authenticate via browser

### Verification

* `tailscale status`

Expected nodes:

* bookmyclass-monitor (Pi)
* bookmyclass-prod
* bookmyclass-uat
* developer machine

### Result

* Each node gets a private IP (100.x.x.x)
* All communication is encrypted
* No public exposure required

---

## 5. SSH Configuration over Tailscale

### SSH Config (local machine)

Example `~/.ssh/config`:

```sshconfig
Host bookmyclass-prod
  HostName <tailscale-ip-prod>
  User root
  IdentityFile ~/.ssh/bookmyclass_hetzner

Host bookmyclass-uat
  HostName <tailscale-ip-uat>
  User root
  IdentityFile ~/.ssh/bookmyclass_hetzner

Host bookmyclass-monitor
  HostName <tailscale-ip-pi>
  User bookmyclass-monitor
  IdentityFile ~/.ssh/id_ed25519_pi
```

### Access

* `ssh bookmyclass-prod`
* `ssh bookmyclass-uat`
* `ssh bookmyclass-monitor`

---

## 6. SSH Hardening (Applied)

On PROD and UAT:

Edit:

* `/etc/ssh/sshd_config`

Set:

* `PasswordAuthentication no`
* `PermitRootLogin prohibit-password`

Restart:

* `sudo systemctl restart ssh`

### Result

* No password login
* Only SSH key authentication
* Protection against brute-force attacks

---

## 7. Accessing Netdata

### Current Mode (Secure)

Netdata is bound to localhost.

Access via SSH tunnel:

```bash
ssh -L 19999:localhost:19999 bookmyclass-prod
```

Then open:

* `http://localhost:19999`

### Notes

* This ensures Netdata is never publicly exposed
* Alternative (future): expose via Tailscale only

---

## 8. Architecture Summary

* Public layer:

  * Cloudflare -> application only

* Private layer (Tailscale):

  * SSH access
  * Netdata
  * internal services

* Monitoring:

  * Netdata -> server metrics
  * Uptime Kuma -> uptime checks

---

Do NOT:

* Expose Netdata publicly
* Add unnecessary services on Pi
* Introduce clustering or complex monitoring stacks

Keep the system:

* simple
* observable
* secure



