# 🚀 Server Setup – BookMyClass (Hetzner CPX23)

> Procedural guide only. Canonical deployment/runtime facts live in docs/00_02_deployment_baseline.md. If this file conflicts with baseline docs, follow 00_02_deployment_baseline.md and 00_01_system_baseline.md.

Scope: initial host bootstrap only (server creation, SSH, firewall hardening). Application runtime setup is covered in docs/50_02_bookmyclass_server_setup_updated.md.


## 1. Server Creation

* Provider: Hetzner Cloud
* Plan: **CX23 (2 vCPU / 4GB RAM)**
* OS: **Ubuntu 24.04**
* Region: Helsinki
* Architecture: x86

---

## 2. SSH Setup

### Generate key locally

```bash
ssh-keygen -t ed25519 -C "bookmyclass-hetzner" -f ~/.ssh/bookmyclass_hetzner
```

### Add public key to Hetzner

```bash
cat ~/.ssh/bookmyclass_hetzner.pub
```

Paste into Hetzner SSH Keys.

---

### If SSH key injection fails (manual fix)

From Hetzner console:

```bash
mkdir -p /root/.ssh
chmod 700 /root/.ssh
nano /root/.ssh/authorized_keys
```

Paste public key.

```bash
chmod 600 /root/.ssh/authorized_keys
chown -R root:root /root/.ssh
systemctl restart ssh
```

---

## 3. SSH Connection

```bash
ssh -i ~/.ssh/bookmyclass_hetzner root@<canonical-prod-host-from-deployment-baseline>
```

---

## 4. Firewall (Hetzner Cloud)

### Inbound Rules

* Port 22 (SSH) → **YOUR_IP/32 only**
* Port 80 (HTTP) → Anywhere
* Port 443 (HTTPS) → Anywhere

### Outbound

* Allow all

---

## 5. Server Firewall (UFW)

Install:

```bash
apt install -y ufw
```

Configure:

```bash
ufw allow from YOUR_IP to any port 22
ufw allow 80
ufw allow 443
ufw enable
```

Verify:

```bash
ufw status
```

---

## 6. SSH Hardening

Edit config:

```bash
nano /etc/ssh/sshd_config
```

Set:

```text
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
PermitRootLogin prohibit-password
PasswordAuthentication no
```

Restart SSH:

```bash
systemctl restart ssh
```

---

## 7. Security Model

### Layer 1 – Hetzner Firewall

* Blocks all inbound except allowed ports

### Layer 2 – UFW (Server-level)

* Restricts SSH to your IP

### Layer 3 – SSH Config

* Key-based authentication only
* Password login disabled

---

## 8. Validation

* SSH works without password
* SSH fails when VPN IP changes
* Ports 80/443 accessible publicly

---

## 9. Notes

* Do not use volumes at this stage
* Keep setup minimal for beta
* Scale server only when needed

---

## ✅ Current State

* Secure SSH access (key only)
* Dual firewall protection
* Production-ready base server




