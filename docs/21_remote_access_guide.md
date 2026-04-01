# Remote Access Guide (SSH Tunnels)

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
- Server IP: `46.62.208.152`

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
