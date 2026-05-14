# GitHub Actions CD with Cloudflare Access SSH

**Purpose:** Explain the complete GitHub Actions continuous deployment setup for Book my Class UAT and PROD environments, including Cloudflare Access SSH tunnel configuration, GitHub secrets/variables/environments, server-side setup, and troubleshooting history.

**Current Status:** UAT is operational for operator-run manual validation.
UAT checks are triggered by the operator when release scope requires them; they
are not automatic release gates.
During the current demo stage, `UAT_*` GitHub Actions secrets may intentionally
point to the same production/demo server values. The UAT workflow must make that
visible with a warning, but it must not fail solely because the UAT alias targets
the prod/demo topology.

**Scope:** GitHub-hosted runners → Cloudflare Access SSH → private servers over SSH with strict host key checking, PM2 deployments, and post-deploy validation.

**Canonical Source Priority:**
- `docs/00_02_deployment_baseline.md` for canonical runtime and release facts
- This file for CD architecture and configuration procedures
- `.github/workflows/uat-release.yml`, `.github/workflows/prod-release.yml`, `.github/workflows/uat-ssh-connectivity.yml`, `.github/workflows/prod-ssh-connectivity.yml` for exact execution patterns
- `docs/40_03_release_process.md` for deployment command ordering
- `scripts/uat-deploy-tag.sh`, `scripts/prod-deploy-tag.sh` for remote execution details

---

## 1. Purpose

This document explains how Book my Class deploys to UAT and production environments using:
1. **GitHub-hosted runners** (not self-hosted) as the CD orchestrator
2. **Cloudflare Access SSH** as the bridge from public GitHub-hosted runners to private server networks
3. **SSH keys and known_hosts** for Linux authentication and host key verification
4. **PM2** for application process management
5. **Git tag-based promotion** with production approval

The key insight: **GitHub runners run in public AWS/Azure environments and cannot directly reach private 100.x.x.x addresses.** Cloudflare Access SSH solves the network reachability problem. SSH keys solve the Linux login problem. These are separate concerns.

---

## 2. Why Cloudflare Access SSH is Required in This Project

### Network Problem
- Private servers are behind non-routable IPs (or private networks not directly accessible from GitHub-hosted runners)
- GitHub-hosted runners are ephemeral, public AWS/Azure instances
- Direct SSH to private servers is not possible without tunneling

### Solution
- Cloudflare tunnel connector runs on the target server (always has outbound connectivity)
- Cloudflare public hostname (e.g., `ssh-uat.bookmyclass.app`) is public DNS
- GitHub runner resolves `ssh-uat.bookmyclass.app` and reaches the tunnel via Cloudflare's backbone
- Cloudflare Access policies gate SSH to authorized tokens only
- End result: GitHub runner can SSH to the private server as if it were public

### Why Not Self-Hosted Runners?
- Self-hosted runners require dedicated infrastructure and long-running agents
- GitHub-hosted runners are ephemeral, stateless, and require no long-term maintenance
- Cost is lower per-deployment
- Security context is isolated per run

---

## 3. High-Level Architecture of the CD Path

```
┌─────────────────────────────────────────────────────────────────────┐
│ Developer                                                           │
│  Create tag v1.2.3 → push origin                                    │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ GitHub                                                              │
│  Detect tag → Trigger workflow `uat-release`                       │
│   Job 1: regression (unit/integration tests)                      │
│   Job 2: e2e (Playwright against test DB)                        │
│   Job 3: deploy_uat (SSH via Cloudflare to UAT server)           │
│   Job 4: smoke_uat (public HTTP smoke tests)                      │
│   Job 5: e2e_uat (deployed Playwright against live UAT)          │
│   Job 6: k6_smoke_uat (load test smoke)                         │
│   Job 7: zap_uat (security baseline)                             │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
      ┌──────────────────────────────────────────────────────┐
      │ Cloudflare Tunnel (SSH gateway)                      │
      │  ssh-uat.bookmyclass.app → private UAT server       │
      │  (cloudflared connector running on UAT server)      │
      └──────────────────────────────┬──────────────────────┘
                                 │
                                 ▼
      ┌──────────────────────────────────────────────────────┐
      │ UAT Server                                           │
      │  Execute remote shell script from GitHub workflow    │
      │  - git checkout vX.Y.Z                              │
      │  - npm ci && build                                  │
      │  - prisma migrate deploy                           │
      │  - pm2 restart bookmyclass-app-uat                 │
      │  - Verify with health endpoint                      │
      └──────────────────────────────┬──────────────────────┘
                                 │
                                 ▼
      ┌──────────────────────────────────────────────────────┐
      │ GitHub Actions (continued)                          │
      │  If UAT tests pass:                                 │
      │   → Store proof of successful tag in repo           │
      │   → Ready for manual production promotion           │
      └──────────────────────────────┬──────────────────────┘
                                 │
                                 ▼
      ┌──────────────────────────────────────────────────────┐
      │ GitHub (production promotion - manual)              │
      │  Workflow: `prod-release` (workflow_dispatch)       │
      │  Input: exact tag to promote (e.g., v1.2.3)        │
      │  Environment protection: GitHub approval            │
      │  Job 1: deploy_prod (SSH via Cloudflare to PROD)   │
      │  Job 2: smoke_prod (public HTTP smoke tests)        │
      └──────────────────────────────┬──────────────────────┘
                                 │
                                 ▼
      ┌──────────────────────────────────────────────────────┐
      │ Cloudflare Tunnel (PROD SSH gateway)                │
      │  ssh-prod.bookmyclass.app → private PROD server     │
      │  (cloudflared connector running on PROD server)     │
      └──────────────────────────────┬──────────────────────┘
                                 │
                                 ▼
      ┌──────────────────────────────────────────────────────┐
      │ Production Server                                   │
      │  Execute remote shell script from GitHub workflow    │
      │  - git checkout vX.Y.Z                              │
      │  - npm ci && build                                  │
      │  - prisma migrate deploy                           │
      │  - pm2 restart bookmyclass-app                      │
      │  - Verify with health endpoint                      │
      └──────────────────────────────────────────────────────┘
```

---

## 4. UAT and PROD Deployment Model

### UAT Deployment
- **Trigger:** Tag push (e.g., `git tag -a v1.2.3 && git push origin v1.2.3`)
- **Workflow:** `.github/workflows/uat-release.yml`
- **Automatic:** No; the operator runs UAT validation manually when needed
- **Gate:** Operator-approved manual validation
- **Environment:** `uat` (GitHub Environment)
- **Demo-stage host mapping:** `UAT_*` secrets may point at the production/demo
  server when the operator intentionally uses PROD as UAT. Keep the `UAT_*`
  secret names and log a warning; do not block this configuration.
- **Post-deploy validations:**
  - Smoke tests (HTTP health checks)
  - Playwright e2e against deployed UAT
  - k6 load test smoke
  - OWASP ZAP security baseline
  - Homesite HTML and screenshot assets are published to
    `/var/www/bookmyclass-homesite`; image assets are copied from
    `public/images/homesite` to
    `/var/www/bookmyclass-homesite/images/homesite` and verified with a real
    image URL.

### Production Deployment
- **Trigger:** Manual via `workflow_dispatch` + exact tag input
- **Workflow:** `.github/workflows/prod-release.yml`
- **Automatic:** No, requires explicit trigger
- **Gate:** GitHub Environment approval (configured in repo settings)
- **Environment:** `production` (GitHub Environment)
- **Post-deploy validations:**
  - Production smoke tests (HTTP health checks)
  - Optional operator-run validation on prod

### The Rule
- **UAT** is operational for operator-run manual validation
- **Production** is manual; operators promote an exact validated tag
- **Never deploy from `main`; always deploy from a tag**
- **Do not treat UAT as an automatic release gate**

---

## 5. What is Configured in Cloudflare

Cloudflare handles the SSH tunnel that bridges GitHub runners (public) to private servers.

### 5.1 Tunnel Connector (on Target Server)

**Location:** Target server (UAT and PROD)

**Install cloudflared on the server:**

```bash
# Download latest release
curl -L -o /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo install -m 0755 /tmp/cloudflared /usr/bin/cloudflared
/usr/bin/cloudflared version
```

**Create systemd service** (`/etc/systemd/system/cloudflared-tunnel.service`):

```ini
[Unit]
Description=Cloudflare Tunnel for SSH
After=network.target

[Service]
Type=notify
User=root
WorkingDirectory=/root
ExecStart=/usr/bin/cloudflared tunnel run --token <TUNNEL_TOKEN>
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
```

**Enable and start:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudflared-tunnel
sudo systemctl start cloudflared-tunnel
sudo systemctl status cloudflared-tunnel

# View logs
sudo journalctl -u cloudflared-tunnel -f
```

**Verify tunnel is active:**

```bash
/usr/bin/cloudflared tunnel list
```

---

### 5.2 Tunnel Configuration (Cloudflare Dashboard)

In Cloudflare Zero Trust dashboard (`https://one.dash.cloudflare.com/`):

1. **Create Tunnel**
   - Name: `bookmyclass-uat-tunnel` (UAT) or `bookmyclass-prod-tunnel` (PROD)
   - Connector installed on server
   - Generate tunnel token

2. **Public Hostname (Routing)**
   - Public hostname: `ssh-uat.bookmyclass.app` (UAT) or `ssh-prod.bookmyclass.app` (PROD)
   - Protocol: SSH
   - Origin: `127.0.0.1:22` (localhost SSH port on server)
   - TLS: No verification needed (internal SSH)

3. **Verify DNS**
   - Cloudflare will automatically create a CNAME or A record pointing to the tunnel
   - `ssh-uat.bookmyclass.app` resolves to Cloudflare's edge
   - Verify with `dig ssh-uat.bookmyclass.app`

**Important:** The public hostname must exist in the Cloudflare tunnel UI **before** DNS can resolve it. If you attempt to SSH before the hostname is added, you'll get connection timeout.

---

### 5.3 Access Applications and Service Tokens

Cloudflare Access gates SSH to authorized identities only.

#### Create Access Application

1. Go to **Access** → **Applications**
2. Create new application:
   - Name: `BookMyClass UAT SSH` (or PROD)
   - Application type: SSH
   - Application Domain: `ssh-uat.bookmyclass.app` (UAT) or `ssh-prod.bookmyclass.app` (PROD)
   - Subdomain: auto-populated

3. Configure policy:
   - Rule: Service Token authentication
   - Grant: Allow
   - Service Token: (create in next step)

#### Create Access Service Token

**Key Difference:** Cloudflare has two token types:
- **API Token** (generic, for Cloudflare API operations) — do NOT use for SSH
- **Service Token** (specific to Access applications, for automated/programmatic access) — use THIS

Steps to create Service Token:

1. Go to **Access** → **Service Tokens**
2. Create new token:
   - Name: `github-actions-uat-ssh` (or PROD)
   - Scope: Select the Access application created above
   - Generate

3. You will see:
   - `Client ID` (long alphanumeric string)
   - `Client Secret` (long alphanumeric string)
   - **Save both immediately; the secret is not shown again**

Store these securely:
- `CLOUDFLARE_ACCESS_CLIENT_ID` → GitHub secret (UAT or PROD)
- `CLOUDFLARE_ACCESS_CLIENT_SECRET` → GitHub secret (UAT or PROD)

---

### 5.4 Access Policy

In the Access Application → **Policies** tab:

1. Create a policy:
   - Action: **Allow**
   - Session Duration: 4 hours
   - Rules:
     - Service Token: `github-actions-uat-ssh` (or PROD)
   - OR (optional): Email domain if developers need interactive access

2. Save policy

This allows the GitHub Actions runner (using the service token) and optionally developers (using email) to authenticate.

---

## 6. What is Configured on the Server

The target server (UAT or PROD) needs:
1. Cloudflared tunnel connector (already covered above)
2. SSH server (standard on Linux)
3. Public key for deployment user in `authorized_keys`
4. Application directory and GitHub repository
5. PM2 with app configuration
6. PostgreSQL (for database)
7. nginx (optional, for public routing)

---

### 6.1 SSH Server and Keys

**Ensure SSH is running:**

```bash
sudo systemctl status ssh
sudo systemctl enable ssh
```

**Add deployment user's public key to authorized_keys:**

```bash
# As root or deploy user:
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Append public key to authorized_keys
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF..." >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

**Test local SSH (on server):**

```bash
ssh localhost 'hostname && whoami'
```

---

### 6.2 Application Directory and Git Access

**Ensure app directory exists and is owned by deploy user:**

```bash
sudo chown -R deploy:deploy /var/www/bookmyclass
cd /var/www/bookmyclass
```

**Ensure GitHub repository is accessible from the server:**

```bash
# The deployment script will call: git fetch --all --tags && git checkout vX.Y.Z
# For this to work, the server must have SSH access to GitHub

# Option A: SSH key-based access (recommended)
# Generate SSH key on server (if not present):
ssh-keygen -t ed25519 -f ~/.ssh/github -C "deploy@server"

# Add to GitHub repository deployment keys (Settings → Deploy Keys)
# or to a bot account with repo access

# Test access:
ssh -i ~/.ssh/github -T git@github.com
```

**Verify git config:**

```bash
cd /var/www/bookmyclass
git remote -v
# Should show: origin https://github.com/your-org/your-repo.git (or git@github.com:...:)
```

**Critical Issue (Troubleshooting History):**
- GitHub Actions workflow connects to the server over Cloudflare SSH ✓
- But the server itself must also connect to GitHub to fetch tags ✓
- These are **separate** connection paths
- If the server cannot reach GitHub, the deploy script will fail at `git fetch --all --tags`
- Verify server → GitHub connectivity independently

---

### 6.3 PM2 Configuration

**Verify PM2 is installed:**

```bash
pm2 -v
pm2 status
```

**For UAT, create a separate app entry:**

UAT PM2 app name: `bookmyclass-app-uat` (confirmed in deployment baseline)

```bash
# On UAT server, in /var/www/bookmyclass:
pm2 start npm --name bookmyclass-app-uat -- start -- --port 3000

# Or via ecosystem config (recommended):
# cat > ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "bookmyclass-app-uat",
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
# pm2 start ecosystem.config.js
```

**For Production, use standard app name:**

PROD PM2 app name: `bookmyclass-app` (confirmed in deployment baseline)

```bash
pm2 start npm --name bookmyclass-app -- start -- --port 3000
```

**Save PM2 state and enable auto-restart:**

```bash
pm2 save
pm2 startup
# Follow system-specific instructions to enable PM2 auto-restart on boot
```

**Verify PM2 status:**

```bash
pm2 status
pm2 describe bookmyclass-app-uat     # UAT
pm2 describe bookmyclass-app         # PROD
pm2 logs bookmyclass-app-uat --lines 50 --nostream
```

**Critical:** The deployment script will call `pm2 restart <APP_NAME> --update-env`. This must match the exact app name registered in PM2. If PM2 knows the app as `bookmyclass-app-uat` but the script tries `bookmyclass-app`, restart will fail.

**How to verify the correct app name:**

```bash
pm2 status
# Output will show the exact name used
```

---

### 6.4 PostgreSQL Database Container (Docker)

**Start PostgreSQL container:**

```bash
docker run -d \
  --name bookmyclass-uat-postgres \
  --restart unless-stopped \
  -e POSTGRES_DB=bookmyclass_uat \
  -e POSTGRES_USER=bookmyclass_user \
  -e POSTGRES_PASSWORD='<secure-password>' \
  -p 5432:5432 \
  -v pgdata_uat:/var/lib/postgresql/data \
  postgres:16
```

**Verify:**

```bash
docker ps
docker logs bookmyclass-uat-postgres --tail 20
```

**For Production, replace prefixes:**

- Container name: `bookmyclass-postgres` (or confirmed value)
- Database name: `bookmyclass` (or confirmed value)
- Database user: `bookmyclass_user` (or confirmed value)

**Verify container is accessible to the app:**

```bash
psql -h localhost -U bookmyclass_user -d bookmyclass_uat -c "SELECT version();"
```

---

### 6.5 Environment Variables and .env File

**Location:** `/var/www/bookmyclass/.env`

**Permissions:**

```bash
chmod 600 /var/www/bookmyclass/.env
```

**Required variables (exact names):**

```env
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://bookmyclass_user:<password>@localhost:5432/bookmyclass_uat?schema=public

# Auth
AUTH_SECRET=<random-secret>
NEXTAUTH_URL=https://uat.bookmyclass.app

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# Email
RESEND_API_KEY=<key>
EMAIL_FROM=BookMyClass <noreply@bookmyclass.app>

# Sentry
SENTRY_ORG=...
SENTRY_PROJECT=...
SENTRY_AUTH_TOKEN=...
```

**How PM2 picks up env variables:**

When deployment script calls `pm2 restart bookmyclass-app-uat --update-env`, PM2 will:
1. Re-read the `.env` file
2. Load variables into the process
3. Restart the app with new environment

**Verify current environment (on server):**

```bash
pm2 describe bookmyclass-app-uat | grep -A 20 "env:"
```

---

### 6.6 Nginx Configuration (Public Routing)

**Optional but typical:** Nginx sits in front of the app on port 80/443 and reverse-proxies to port 3000.

**Example nginx config** (`/etc/nginx/sites-enabled/bookmyclass-uat`):

```nginx
upstream bookmyclass_uat {
  server 127.0.0.1:3000;
}

server {
  listen 80;
  server_name uat.bookmyclass.app;

  location / {
    proxy_pass http://bookmyclass_uat;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

**Enable and test:**

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl enable nginx
sudo systemctl status nginx
```

**Verify public URL:**

```bash
curl -I https://uat.bookmyclass.app
# Should return 200 if app is running
```

---

## 7. What is Configured on the Local Machine

A developer's or operator's local machine needs to be able to:
1. Generate SSH keys for the deployment user
2. Create local SSH aliases for testing
3. Collect `known_hosts` entries via Cloudflare tunnels
4. Test SSH connectivity before running GitHub Actions
5. Debug SSH issues

---

### 7.1 Generate Deploy SSH Keys

**Generate an Ed25519 key pair (recommended):**

```bash
ssh-keygen -t ed25519 -f ~/.ssh/bookmyclass_deploy -C "deploy@bookmyclass-uat"
```

Output:
- Public key: `~/.ssh/bookmyclass_deploy.pub`
- Private key: `~/.ssh/bookmyclass_deploy` (must be kept secret)

**Show the private key (for GitHub secret storage):**

```bash
cat ~/.ssh/bookmyclass_deploy
```

Output example (copy the **entire** block including header/footer):

```
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUtbm9uZS1ub25lAAAAhQAAAII...
(many lines)
-----END OPENSSH PRIVATE KEY-----
```

**Show the public key (for server authorized_keys):**

```bash
cat ~/.ssh/bookmyclass_deploy.pub
```

Output example:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID123...xyz== deploy@bookmyclass-uat
```

---

### 7.2 Local SSH Config

**Add local aliases** for testing before pushing to GitHub Actions:

File: `~/.ssh/config`

```ssh-config
# UAT via Cloudflare Access SSH
Host uat-cf
  HostName ssh-uat.bookmyclass.app
  Port 22
  User root
  IdentityFile ~/.ssh/bookmyclass_deploy
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile ~/.ssh/known_hosts
  ProxyCommand cloudflared access ssh --hostname %h

# Production via Cloudflare Access SSH
Host prod-cf
  HostName ssh-prod.bookmyclass.app
  Port 22
  User root
  IdentityFile ~/.ssh/bookmyclass_deploy
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile ~/.ssh/known_hosts
  ProxyCommand cloudflared access ssh --hostname %h
```

**Explanation of each line:**
- `Host uat-cf`: SSH alias name (use as `ssh uat-cf`)
- `HostName ssh-uat.bookmyclass.app`: Public hostname of tunnel
- `Port 22`: SSH port on server (standard)
- `User root`: Linux user on server (or `deploy` if available)
- `IdentityFile ~/.ssh/bookmyclass_deploy`: Private key to use
- `IdentitiesOnly yes`: Only use the specified key (don't try others)
- `StrictHostKeyChecking yes`: Verify host key (fail if not in known_hosts)
- `UserKnownHostsFile ~/.ssh/known_hosts`: Check fingerprint against this file
- `ProxyCommand cloudflared access ssh --hostname %h`: Use Cloudflare Access tunnel

---

### 7.3 Install cloudflared on Local Machine

**macOS:**

```bash
brew install cloudflare/cloudflare/cloudflared
cloudflared --version
cloudflared update
```

**Linux (Debian/Ubuntu):**

```bash
curl -L -o /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo install -m 0755 /tmp/cloudflared /usr/local/bin/cloudflared
cloudflared --version
```

**Windows:**

```bash
# Via scoop:
scoop install cloudflare/cloudflare/cloudflared

# Or download from GitHub and add to PATH
# https://github.com/cloudflare/cloudflared/releases
```

---

### 7.4 Testing SSH Through Cloudflare

**Step 1: Export Cloudflare Access tokens**

Before attempting SSH, you must authenticate to Cloudflare Access.

```bash
export CLOUDFLARE_ACCESS_CLIENT_ID="your-service-token-client-id"
export CLOUDFLARE_ACCESS_CLIENT_SECRET="your-service-token-client-secret"
```

These are the service tokens created in Cloudflare Access dashboard (see section 5.3).

**Step 2: Test connectivity (without known_hosts yet)**

This will likely fail with a host key warning, which is expected:

```bash
ssh uat-cf 'hostname && whoami'
```

Expected output (first time):
```
Host key verification failed.
The authenticity of host 'ssh-uat.bookmyclass.app' can't be established.
ED25519 key fingerprint is SHA256:abc1234567890xyz...
```

**Step 3: Manually accept and capture known_hosts**

Option A (if you trust the connection):

```bash
ssh-keyscan -t ed25519 ssh-uat.bookmyclass.app 2>/dev/null | tee -a ~/.ssh/known_hosts
```

Option B (interactive): Answer `yes` when prompted, which auto-adds to `known_hosts`:

```bash
ssh uat-cf 'hostname && whoami'
# When prompted: type 'yes'
# SSH will add to known_hosts
```

**Step 4: Verify known_hosts entry exists**

```bash
grep ssh-uat.bookmyclass.app ~/.ssh/known_hosts
```

Expected output:
```
ssh-uat.bookmyclass.app ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDa9s...
```

**Step 5: Test SSH again (now with known_hosts)**

```bash
ssh uat-cf 'hostname && whoami && pm2 status'
```

Should succeed and show:
```
uat-server
root
┌─────────────────────┬──────┬──────────┬──────────┐
│ Name                │ PID  │ Mode     │ Status   │
├─────────────────────┼──────┼──────────┼──────────┤
│ bookmyclass-app-uat │ 1234 │ fork     │ online   │
└─────────────────────┴──────┴──────────┴──────────┘
```

---

### 7.5 Collecting known_hosts for GitHub Secrets

The `known_hosts` entry must be stored in GitHub secrets so the GitHub Actions runner can verify the host key.

**Get the known_hosts line for UAT:**

```bash
grep ssh-uat.bookmyclass.app ~/.ssh/known_hosts
```

Output example:
```
ssh-uat.bookmyclass.app ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDa9s1b2c3d4e...
```

**Copy that entire line and store as GitHub secret `UAT_SSH_KNOWN_HOSTS`** (see section 8.2).

**Repeat for Production:**

```bash
grep ssh-prod.bookmyclass.app ~/.ssh/known_hosts
```

Store as GitHub secret `PROD_SSH_KNOWN_HOSTS`.

---

### 7.6 Troubleshooting SSH Issues

**Problem: "Permission denied (publickey)"**

- Verify private key exists and has correct permissions: `ls -la ~/.ssh/bookmyclass_deploy` (should be 600)
- Verify public key is in server's `~/.ssh/authorized_keys`
- Verify correct user: SSH config says `User root` or `User deploy`, but server may only have one
- Test with verbose output: `ssh -vvv uat-cf 'whoami'`

**Problem: "The authenticity of host cannot be established"**

- First time connecting; you need to capture `known_hosts`
- Use `ssh-keyscan` or accept interactively (answer `yes`)
- Verify fingerprint matches between local and GitHub (should be the same for same server)

**Problem: "Proxy command failed: Cannot find Cloudflare Access"**

- Cloudflare Access tokens are not exported: `export CLOUDFLARE_ACCESS_CLIENT_ID=...`
- Cloudflared is not installed: `cloudflared --version` should work
- Service token is wrong or no longer valid; regenerate in Cloudflare dashboard
- Access policy blocks your identity; check Cloudflare Access logs

**Problem: ProxyCommand times out**

- Tunnel connector on server is not running: `ssh deploy@server-direct 'systemctl status cloudflared-tunnel'`
- Public hostname not added to tunnel: check Cloudflare tunnel UI for the hostname
- Cloudflare account or zone issue; log in to Cloudflare dashboard and inspect tunnel

**Problem: "Host key mismatch"**

- The key fingerprint in `known_hosts` does not match what server presents
- This can happen if server is replaced or key is regenerated
- Delete old entry: `ssh-keygen -R ssh-uat.bookmyclass.app`
- Re-scan: `ssh-keyscan -t ed25519 ssh-uat.bookmyclass.app 2>/dev/null | tee -a ~/.ssh/known_hosts`

---

## 8. What is Configured in GitHub

GitHub must be configured with:
1. Environments (UAT and PROD)
2. Secrets (SSH keys, Cloudflare tokens, etc.)
3. Variables (non-secret values like SSH host, app directory)
4. Approval protection (for production)

---

### 8.1 GitHub Environments

Go to repository **Settings → Environments**.

#### Create UAT Environment

1. **Name:** `uat`
2. **Deployment protection rules:**
   - Optional: Require reviewers (usually not needed for UAT)
3. **Create**

#### Create Production Environment

1. **Name:** `production`
2. **Deployment protection rules:**
   - ✓ **Require reviewers** (minimum 1, recommend matching your org policy)
   - Reviewers can be: individual users or CODEOWNERS
3. **Create**

**Why separate environments?** Each environment has its own set of secrets and protection rules. This ensures UAT secrets don't leak to production and vice versa.

---

### 8.2 GitHub Secrets

Secrets are stored per environment and are encrypted.

#### UAT Secrets

In **Settings → Environments → uat → Add secret**, create:

| Secret Name | Value | Notes |
|---|---|---|
| `UAT_SSH_HOST` | `ssh-uat.bookmyclass.app` | Public hostname from Cloudflare tunnel |
| `UAT_SSH_PORT` | `22` | SSH port |
| `UAT_SSH_USER` | `root` | Linux user (or `deploy` if available) |
| `UAT_SSH_PRIVATE_KEY` | (entire private key from `cat ~/.ssh/bookmyclass_deploy`) | Must include `-----BEGIN` and `-----END` lines |
| `UAT_SSH_KNOWN_HOSTS` | (entire known_hosts line from `grep ssh-uat.bookmyclass.app ~/.ssh/known_hosts`) | Single line, exact format |
| `UAT_CLOUDFLARE_ACCESS_CLIENT_ID` | (Service token Client ID from Cloudflare) | From Cloudflare Access → Service Tokens |
| `UAT_CLOUDFLARE_ACCESS_CLIENT_SECRET` | (Service token Client Secret from Cloudflare) | From Cloudflare Access → Service Tokens |
| `UAT_BASE_URL` | `https://uat.bookmyclass.app` | Public URL for smoke tests |
| `UAT_APP_DIR` | `/var/www/bookmyclass` | Application directory on server |
| `UAT_PM2_APP_NAME` | `bookmyclass-app-uat` | Exact PM2 app name (confirmed in deployment baseline) |

#### Production Secrets

In **Settings → Environments → production → Add secret**, create:

| Secret Name | Value | Notes |
|---|---|---|
| `PROD_SSH_HOST` | `ssh-prod.bookmyclass.app` | Public hostname from Cloudflare tunnel |
| `PROD_SSH_PORT` | `22` | SSH port |
| `PROD_SSH_USER` | **Operator confirmation required** | Use `root` unless confirmed otherwise; see section 10 on how to verify |
| `PROD_SSH_PRIVATE_KEY` | (entire private key) | Must include `-----BEGIN` and `-----END` lines |
| `PROD_SSH_KNOWN_HOSTS` | (entire known_hosts line) | Single line, exact format |
| `PROD_CLOUDFLARE_ACCESS_CLIENT_ID` | (Service token Client ID from Cloudflare) | From Cloudflare Access → Service Tokens |
| `PROD_CLOUDFLARE_ACCESS_CLIENT_SECRET` | (Service token Client Secret from Cloudflare) | From Cloudflare Access → Service Tokens |
| `PROD_BASE_URL` | `https://bookmyclass.app` | Public URL for smoke tests |

---

### 8.3 GitHub Variables

Variables are non-secret and visible in workflow runs. Use for values that are safe to display.

#### UAT Variables (optional, can also be secrets)

In **Settings → Environments → uat → Add variable**, create:

| Variable Name | Value | Notes |
|---|---|---|
| `UAT_APP_DIR` | `/var/www/bookmyclass` | Can be secret or variable |
| `UAT_PM2_APP_NAME` | `bookmyclass-app-uat` | Can be secret or variable |

#### Production Variables (must use this for PROD since APP_DIR/PM2_APP_NAME need confirmation)

In **Settings → Environments → production → Add variable**, create:

| Variable Name | Value | Notes |
|---|---|---|
| `PROD_APP_DIR` | **(Operator confirmation required)** | See section 10 on how to verify |
| `PROD_PM2_APP_NAME` | **(Operator confirmation required)** | See section 10 on how to verify |

---

### 8.4 Difference Between Secrets, Variables, and Environment Settings

| Type | Visibility | Use Case | Example |
|---|---|---|---|
| Repository Secret | Hidden from logs | Sensitive data that applies to all workflows | GitHub token, API keys |
| Environment Secret | Hidden from logs | Sensitive data specific to one environment (UAT/PROD) | SSH private keys, API keys per env |
| Environment Variable | Visible in logs | Non-sensitive config specific to one environment | URLs, directory paths |
| Environment Protection Rules | N/A | Block/require approvals before deploy | Production approval gate |

**Best Practice:** Use **environment secrets** for deployment credentials, not repository secrets. This way, UAT keys and PROD keys are separated and reviewers can audit which secret is used where.

---

### 8.5 GitHub Environment Approvals

**For Production Only:**

Go to **Settings → Environments → production → Deployment protection rules**.

Enable:
- ✓ **Require reviewers** (minimum 1)
- Optional: **Restrict deployments to a subset of users, teams, or roles**

**Effect:** When `.github/workflows/prod-release.yml` runs with `environment: production`, it will pause and wait for a reviewer to approve before executing the job. This prevents accidental production deploys.

**Approval workflow:**
1. Developer triggers production promotion workflow
2. GitHub shows "Waiting for approval" in Actions
3. Reviewer clicks "Review deployments" and selects "Approve and deploy"
4. Workflow resumes and runs the deployment

---

## 9. Exact Required UAT Values

**All confirmed, ready to use:**

| Item | Value | Status |
|---|---|---|
| GitHub Environment Name | `uat` | ✓ Confirmed |
| Cloudflare Public Hostname | `ssh-uat.bookmyclass.app` | ✓ Confirmed |
| SSH Host | `ssh-uat.bookmyclass.app` | ✓ Confirmed |
| SSH Port | `22` | ✓ Confirmed |
| SSH User | `root` | ✓ Confirmed |
| Base URL (public) | `https://uat.bookmyclass.app` | ✓ Confirmed |
| App Directory | `/var/www/bookmyclass` | ✓ Confirmed |
| PM2 App Name | `bookmyclass-app-uat` | ✓ Confirmed |
| Database Container | `bookmyclass-uat-postgres` | ✓ Confirmed |
| Database Name | `bookmyclass_uat` | ✓ Confirmed |
| Database User | `bookmyclass_user` | ✓ Confirmed |
| App Port (localhost) | `3000` | ✓ Confirmed |
| Health Check Endpoint | `/api/health` | ✓ Confirmed |

### Cloudflare UAT Service Token (Generate Steps)

1. Go to Cloudflare Zero Trust → Access → Service Tokens
2. Create token:
   - Name: `github-actions-uat-ssh`
   - Scope: Select the `BookMyClass UAT SSH` Access application
3. Copy:
   - `Client ID` → GitHub secret `UAT_CLOUDFLARE_ACCESS_CLIENT_ID`
   - `Client Secret` → GitHub secret `UAT_CLOUDFLARE_ACCESS_CLIENT_SECRET`

### SSH Key for UAT (Generate Steps)

1. On local machine:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/bookmyclass-deploy-uat -C "deploy@bookmyclass-uat"
   ```

2. Copy private key:
   ```bash
   cat ~/.ssh/bookmyclass-deploy-uat
   ```
   → GitHub secret `UAT_SSH_PRIVATE_KEY`

3. Copy public key:
   ```bash
   cat ~/.ssh/bookmyclass-deploy-uat.pub
   ```
   → Add to UAT server's `~/.ssh/authorized_keys` for the SSH user (root)

### Known Hosts for UAT (Collect Steps)

1. On local machine, with Cloudflare authentication:
   ```bash
   export CLOUDFLARE_ACCESS_CLIENT_ID="..."
   export CLOUDFLARE_ACCESS_CLIENT_SECRET="..."
   ssh-keyscan -t ed25519 ssh-uat.bookmyclass.app 2>/dev/null | tee -a ~/.ssh/known_hosts
   ```

2. Extract the line:
   ```bash
   grep ssh-uat.bookmyclass.app ~/.ssh/known_hosts
   ```
   → GitHub secret `UAT_SSH_KNOWN_HOSTS`

---

## 10. Exact Required PROD Values

**Status: Operator confirmation required for several values.**

The following must be verified on the production server by someone with direct access:

| Item | Current Value | Status | How to Verify |
|---|---|---|---|
| GitHub Environment Name | `production` | ✓ Confirmed in code | Defined in `.github/workflows/prod-release.yml` |
| Cloudflare Public Hostname | `ssh-prod.bookmyclass.app` | ✓ Confirmed in code | Defined in workflows |
| SSH Host | `ssh-prod.bookmyclass.app` | ✓ Confirmed in code | Defined in workflows |
| SSH Port | `22` | ✓ Confirmed (standard) | Standard SSH port |
| SSH User | **Operator confirmation required** | ⚠ Unknown | See step A below |
| Base URL (public) | `https://bookmyclass.app` | ✓ Confirmed in code | Deployed application public URL |
| App Directory | **Operator confirmation required** | ⚠ Unknown | See step B below |
| PM2 App Name | `bookmyclass-app` | ⚠ Likely but not confirmed | See step C below |
| Database Container | **Operator confirmation required** | ⚠ Unknown | See step D below |
| Database Name | **Operator confirmation required** | ⚠ Unknown | See step D below |
| Database User | **Operator confirmation required** | ⚠ Unknown | See step D below |
| App Port (localhost) | `3000` | ✓ Confirmed | Standard app port |
| Health Check Endpoint | `/api/health` | ✓ Confirmed | Built-in Next.js health route |

---

### 10.1 How to Obtain Unknown PROD Values (Operator Steps)

Run these commands on the production server directly (requires root or sudo access):

#### Step A: Verify SSH User

```bash
# Check which users can SSH (who can deploy)
grep -E "^(root|deploy)" /etc/passwd

# Most common: 'root' or 'deploy'
# Recommended: 'deploy' (less risky than root)
```

**Action:** If deploying as `deploy`, ensure `deploy` user exists and can run PM2 restart:

```bash
sudo -u deploy pm2 status
```

If this returns an error, the app is running under a different user. Use that user.

#### Step B: Verify Application Directory

```bash
# Check where the app is deployed
ls -la /var/www/bookmyclass/
cd /var/www/bookmyclass && pwd
git remote -v  # Confirm it's the right repo
ls -la .env   # Confirm env file exists
```

Standard location: `/var/www/bookmyclass` (likely same as UAT).

#### Step C: Verify PM2 App Name

```bash
pm2 status
# Output will show exact registered app names
# Look for the app that is serving production; note its exact name
```

Expected output:
```
┌─────────────────────┬──────┬──────────┬──────────┐
│ Name                │ PID  │ Mode     │ Status   │
├─────────────────────┼──────┼──────────┼──────────┤
│ bookmyclass-app     │ 1234 │ fork     │ online   │
└─────────────────────┴──────┴──────────┴──────────┘
```

If the name is different (e.g., `my-app` or `bmc-prod`), use that exact name.

#### Step D: Verify Database Configuration

```bash
# Check Docker containers
docker ps
# Look for the PostgreSQL container; note its name

# Check database from inside the container
docker exec <container-name> psql -U postgres -l
# Shows list of databases; note the production database name and user

# Or check from app's environment
cat /var/www/bookmyclass/.env | grep DATABASE_URL
# Extract: database name, user, container name
```

Expected pattern:
```
postgresql://<db-user>:<password>@localhost:5432/<db-name>?schema=public
```

---

### 10.2 After Verification, Update PROD GitHub Secrets

Once you've verified the production values by running the above commands, create the production GitHub secrets and variables:

**Production Secrets** (Settings → Environments → production → Add secret):

| Secret Name | Value |
|---|---|
| `PROD_SSH_USER` | (from step A) |
| `PROD_SSH_PRIVATE_KEY` | (same key as UAT, or new one if PROD uses different user) |
| `PROD_SSH_KNOWN_HOSTS` | (collect via `ssh-keyscan ssh-prod.bookmyclass.app`) |
| `PROD_CLOUDFLARE_ACCESS_CLIENT_ID` | (from Cloudflare) |
| `PROD_CLOUDFLARE_ACCESS_CLIENT_SECRET` | (from Cloudflare) |
| `PROD_BASE_URL` | `https://bookmyclass.app` |

**Production Variables** (Settings → Environments → production → Add variable):

| Variable Name | Value |
|---|---|
| `PROD_APP_DIR` | (from step B) |
| `PROD_PM2_APP_NAME` | (from step C) |

---

## 11. Workflow Implementation Pattern

Both UAT and PROD workflows follow the same core pattern. Here's what happens inside each deploy job:

### 11.1 UAT Workflow Pattern (`.github/workflows/uat-release.yml`)

Trigger: Git tag push (e.g., `git push origin v1.2.3`)

**Steps in `deploy_uat` job:**

1. **Install cloudflared**
   ```bash
   curl -L -o /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
   sudo install -m 0755 /tmp/cloudflared /usr/bin/cloudflared
   ```

2. **Write SSH private key to disk**
   ```bash
   printf '%s\n' "${{ secrets.UAT_SSH_PRIVATE_KEY }}" > ~/.ssh/id_ed25519
   chmod 600 ~/.ssh/id_ed25519
   ```

3. **Write known_hosts**
   ```bash
   printf '%s\n' "${{ secrets.UAT_SSH_KNOWN_HOSTS }}" > ~/.ssh/known_hosts
   chmod 600 ~/.ssh/known_hosts
   ```

4. **Create SSH config with ProxyCommand**
   ```bash
   cat > ~/.ssh/config <<EOF
   Host deploy-target
     HostName ${{ secrets.UAT_SSH_HOST }}
     Port ${{ secrets.UAT_SSH_PORT }}
     User ${{ secrets.UAT_SSH_USER }}
     IdentityFile ~/.ssh/id_ed25519
     IdentitiesOnly yes
     StrictHostKeyChecking yes
     UserKnownHostsFile ~/.ssh/known_hosts
     ProxyCommand /usr/bin/cloudflared access ssh --hostname %h
   EOF
   chmod 600 ~/.ssh/config
   ```

5. **Export Cloudflare Access credentials**
   ```bash
   export CLOUDFLARE_ACCESS_CLIENT_ID="${{ secrets.UAT_CLOUDFLARE_ACCESS_CLIENT_ID }}"
   export CLOUDFLARE_ACCESS_CLIENT_SECRET="${{ secrets.UAT_CLOUDFLARE_ACCESS_CLIENT_SECRET }}"
   ```

6. **Test SSH connectivity**
   ```bash
   ssh deploy-target 'hostname && whoami && pm2 status'
   ```

7. **Execute remote deploy script**
   ```bash
   bash scripts/uat-deploy-tag.sh "${{ github.ref_name }}"
   ```

8. **Post-deploy validations** (separate jobs)
   - `smoke_uat`: health checks and API tests
   - `e2e_uat`: Playwright e2e against deployed app
   - `k6_smoke_uat`: load test smoke
   - `zap_uat`: OWASP ZAP security scan

---

### 11.2 Production Workflow Pattern (`.github/workflows/prod-release.yml`)

Trigger: Manual via `workflow_dispatch` with tag input

**Steps in `deploy_prod` job:**

1-7. **Same as UAT**, but using `production` environment and `PROD_*` secrets/variables

8. **Environment approval gate**
   - Workflow pauses and waits for reviewer approval before continuing

9. **Execute remote deploy script**
   ```bash
   bash scripts/prod-deploy-tag.sh "${{ inputs.tag }}"
   ```

10. **Post-deploy validations**
    - `smoke_prod`: health checks and API tests

---

### 11.3 Remote Deploy Script (executed on server via SSH)

**File:** `scripts/uat-deploy-tag.sh` (for UAT) or `scripts/prod-deploy-tag.sh` (for PROD)

**Flow (inside remote script, running on the server):**

```bash
set -euo pipefail  # Fail fast on any error

# Arguments passed from GitHub Actions
TARGET_TAG="$1"           # e.g., v1.2.3
APP_DIR="$2"              # /var/www/bookmyclass
APP_NAME="$3"             # bookmyclass-app-uat

# Navigate to app directory
cd "$APP_DIR"

# Fetch latest tags from origin
git fetch --all --tags

# Checkout exact tag
git checkout "$TARGET_TAG"

# Install production dependencies
npm ci

# Apply pending database migrations
npx prisma migrate deploy

# Regenerate Prisma client
npx prisma generate

# Build Next.js application
npm run build

# Restart PM2 app with updated environment
pm2 restart "$APP_NAME" --update-env

# Verify tag is deployed
git describe --tags --exact-match

# Show PM2 status
pm2 status

# Health check loop (30 attempts, 2 seconds apart = 60 second timeout)
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
    echo "Local health check passed"
    break
  fi
  if [[ ${attempt} -eq 30 ]]; then
    echo "Health check failed after 60 seconds" >&2
    exit 1
  fi
  sleep 2
done

# Show public health endpoint
curl -sSf -w "code=%{http_code} time=%{time_total}s\n" "$BASE_URL/api/health"
```

**Critical Rules:**
- `set -euo pipefail`: Exit immediately on error, no partial deployments
- `npm ci`: Use exact dependencies from lock file
- `prisma migrate deploy`: Apply migrations **before** build
- `pm2 restart ... --update-env`: Pick up new `.env` variables
- Health check delays are needed because PM2 restart takes time to become ready

---

## 12. Standalone SSH Connectivity Workflow Pattern

Before running a real deploy, test whether SSH through Cloudflare works end-to-end.

**Use these dedicated workflows to verify connectivity without deploying:**

- `.github/workflows/uat-ssh-connectivity.yml` (manual trigger)
- `.github/workflows/prod-ssh-connectivity.yml` (manual trigger)

**How to run:**

1. Go to GitHub → Actions
2. Select `uat-ssh-connectivity` or `prod-ssh-connectivity`
3. Click **Run workflow**
4. Wait for job to complete

**What it does:**

1. Install cloudflared
2. Write SSH key, known_hosts, SSH config
3. Export Cloudflare Access credentials
4. Run SSH command: `ssh deploy-target 'hostname && whoami && pm2 status'`

**Expected output on success:**

```
uat-server
root
┌─────────────────────┬──────┬──────────┬──────────┐
│ Name                │ PID  │ Mode     │ Status   │
├─────────────────────┼──────┼──────────┼──────────┤
│ bookmyclass-app-uat │ 1234 │ fork     │ online   │
└─────────────────────┴──────┴──────────┴──────────┘
```

**If this fails:** Your Cloudflare tunnel, SSH key, or Cloudflare Access token is misconfigured. Debug locally before running the full deploy workflow.

---

## 13. Validation Order

**Required order to bring up CD safely:**

### Phase 1: Local Setup (on your machine)

- [ ] Generate SSH deployment key
- [ ] Add public key to server's authorized_keys
- [ ] Install cloudflared locally
- [ ] Test local SSH through Cloudflare (with tokens exported)
- [ ] Collect known_hosts for both UAT and PROD

### Phase 2: Cloudflare Configuration

- [ ] Create tunnel connector on UAT server (systemd service)
- [ ] Create tunnel connector on PROD server (systemd service)
- [ ] Verify tunnels are active (`cloudflared tunnel list`)
- [ ] Add public hostname for UAT (`ssh-uat.bookmyclass.app`)
- [ ] Add public hostname for PROD (`ssh-prod.bookmyclass.app`)
- [ ] Create Access application for UAT SSH
- [ ] Create Access application for PROD SSH
- [ ] Create Service Token for UAT (save Client ID and Secret)
- [ ] Create Service Token for PROD (save Client ID and Secret)
- [ ] Create Access policy for each application (Service Token access)

### Phase 3: GitHub Configuration

- [ ] Create GitHub environment `uat`
- [ ] Create GitHub environment `production`
- [ ] Add UAT secrets to environment (see section 8.2)
- [ ] Add UAT variables to environment (see section 8.3)
- [ ] Verify UAT secrets by clicking "eye" icon (don't copy; just verify they're set)
- [ ] Add PROD secrets to environment
- [ ] Add PROD variables to environment
- [ ] Enable approval protection on `production` environment
- [ ] Test approval gate on PROD by manually triggering (don't complete)

### Phase 4: Standalone SSH Connectivity Testing

- [ ] Trigger `uat-ssh-connectivity` workflow manually
- [ ] Verify workflow succeeds (shows hostname, whoami, pm2 status)
- [ ] If it fails, debug Cloudflare/SSH issues before proceeding
- [ ] Trigger `prod-ssh-connectivity` workflow manually
- [ ] Verify workflow succeeds

### Phase 5: Create a Release Tag and Test UAT Deploy

- [ ] Create a test release tag (e.g., `git tag -a v0.1.0-cd-test`)
- [ ] Push tag to GitHub
- [ ] Go to Actions and monitor `uat-release` workflow
- [ ] Verify all jobs complete: regression, e2e, deploy_uat, smoke_uat, e2e_uat, k6_smoke_uat, zap_uat
- [ ] If any job fails, check logs and fix the issue
- [ ] On success, UAT is running the test tag

### Phase 6: Test Production Approval and Deploy

- [ ] Go to Actions → `prod-release`
- [ ] Click **Run workflow**
- [ ] Enter the same tag that was tested on UAT (e.g., `v0.1.0-cd-test`)
- [ ] Workflow starts and pauses at "Waiting for approval"
- [ ] Go to **Actions** and click "Review deployments"
- [ ] Approve the deployment
- [ ] Workflow continues and deploys to production
- [ ] Verify production is running the tag

### Phase 7: Cleanup

- [ ] Delete test tag (optional): `git tag -d v0.1.0-cd-test && git push origin :v0.1.0-cd-test`
- [ ] Or leave for reference

---

## 14. Troubleshooting and Lessons Learned

This section captures real issues encountered during setup and deployment.

### Lesson 1: Cloudflare API Token vs. Access Service Token

**Mistake:** Trying to use a Cloudflare API Token for Access SSH authentication.

**Result:** Workflow fails with "authentication failed" or "not authorized".

**Fix:** Use **Access Service Token** (not API Token). These are different:
- **API Token** → for calling Cloudflare's REST API
- **Access Service Token** → for authenticating to Cloudflare Zero Trust Access applications

**Check:** Go to **Cloudflare Zero Trust → Access → Service Tokens**. You should see tokens listed. If empty, you haven't created one yet.

---

### Lesson 2: Tunnel Connector Must Run on Target Server, Not Local Machine

**Mistake:** Attempting to run the tunnel connector on a local developer's machine.

**Result:** The tunnel can't reach the private server; connection times out.

**Why:** The tunnel establishes an **outbound** connection from the server to Cloudflare's backbone. The server must always be the initiator. A local machine can't proxy traffic to the server; that's backwards.

**Fix:** Verify cloudflared is:
1. Installed on the target server (UAT or PROD)
2. Running as a systemd service on the server
3. Using the correct tunnel token for that server

**Check:**
```bash
# On the server:
systemctl status cloudflared-tunnel
journalctl -u cloudflared-tunnel -n 20
/usr/bin/cloudflared tunnel list
```

---

### Lesson 3: Public Hostname Must Exist in Tunnel Before DNS Resolves

**Mistake:** Trying to SSH to `ssh-uat.bookmyclass.app` before the public hostname is added to the Cloudflare tunnel config.

**Result:** DNS resolves, but connection times out or refuses after connecting.

**Why:** Cloudflare's edge rejects traffic to a hostname with no tunnel routing defined.

**Fix:** Verify in Cloudflare dashboard:
1. Go to **Tunnels**
2. Select the tunnel (`bookmyclass-uat-tunnel`)
3. Go to **Public Hostname** tab
4. Verify the hostname is listed:
   - `ssh-uat.bookmyclass.app` → `127.0.0.1:22` (Origin)

If not listed, add it. The tunnel should then accept connections.

---

### Lesson 4: Local SSH Alias Must Be Configured on Local Machine, Not Server

**Mistake:** Trying to add SSH config entries on the remote server.

**Result:** Local SSH command doesn't recognize the alias; "Host not found".

**Why:** SSH config is client-side only. Each client (local machine, GitHub runner) has its own SSH config.

**Fix:** Verify SSH config is in your local `~/.ssh/config`:

```bash
cat ~/.ssh/config | grep -A 10 "Host uat-cf"
```

Should show the ProxyCommand pointing to cloudflared. The server doesn't need this config; it only needs to run cloudflared tunnel service.

---

### Lesson 5: ssh-keyscan May Not Work Cleanly Through Access-Protected SSH

**Mistake:** Running `ssh-keyscan ssh-uat.bookmyclass.app` and it hangs or returns no output.

**Result:** Can't collect known_hosts entry; workflow fails on first SSH attempt.

**Why:** `ssh-keyscan` is a raw SSH protocol scanner. It may not work well through Cloudflare Access tunnels or may require special authentication.

**Fix:** Use one of these alternatives:

**Option A:** Accept interactively and then extract:
```bash
# First SSH attempt (you'll be prompted):
ssh uat-cf 'whoami'
# Answer 'yes' when asked about authenticity
# SSH adds to ~/.ssh/known_hosts

# Then extract:
grep ssh-uat.bookmyclass.app ~/.ssh/known_hosts
```

**Option B:** Use ssh-keyscan but ensure Cloudflare tokens are in environment:
```bash
export CLOUDFLARE_ACCESS_CLIENT_ID="..."
export CLOUDFLARE_ACCESS_CLIENT_SECRET="..."
ssh-keyscan -t ed25519 ssh-uat.bookmyclass.app 2>/dev/null | tee -a ~/.ssh/known_hosts
```

**Best practice:** Option A is most reliable. Accept the connection once interactively, then extract from known_hosts.

---

### Lesson 6: GitHub Workflow Had No ProxyCommand, Used Direct SSH

**Mistake:** First version of workflow had:
```ssh-config
Host deploy-target
  HostName ${{ secrets.REMOTE_HOST }}
  # ... but NO ProxyCommand
```

**Result:** GitHub runner tried direct SSH to private server IP; connection failed.

**Why:** Without ProxyCommand, SSH tries to connect directly. The server is not reachable from public GitHub runners without a tunnel.

**Fix:** Add ProxyCommand:
```ssh-config
Host deploy-target
  HostName ${{ secrets.UAT_SSH_HOST }}
  ProxyCommand /usr/bin/cloudflared access ssh --hostname %h
```

**Lesson:** ProxyCommand is **required** for Cloudflare Access SSH to work. Without it, SSH falls back to direct connection.

---

### Lesson 7: GitHub Environment Name Mismatch Breaks Secret Resolution

**Mistake:** Workflow references `secrets.PROD_SSH_HOST` but the environment is named `prod` (not `production`).

**Result:** GitHub can't find the secret; undefined variable or empty value.

**Why:** GitHub Environment secrets are scoped to that environment. If the environment name doesn't match the secret's environment, GitHub can't resolve it.

**Fix:** Ensure environment name is exact:
- Workflow: `environment: production`
- Secrets stored in: **Settings → Environments → production**

Check in GitHub:
1. Go to **Settings → Environments**
2. Verify environment name matches workflows
3. Verify secrets are in the correct environment (not repository-wide)

---

### Lesson 8: PROD_SSH_KNOWN_HOSTS / UAT_SSH_KNOWN_HOSTS Must Be Exact known_hosts Line

**Mistake:** Storing only the hostname or fingerprint, not the full known_hosts line.

**Result:** Workflow fails with "host key verification failed".

**Why:** SSH expects the exact format: `<hostname> <keytype> <keydata>`

**Correct format:**
```
ssh-uat.bookmyclass.app ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDa9s...
```

**Wrong formats (don't use):**
```
ssh-uat.bookmyclass.app
AAAAC3NzaC1lZDI1NTE5AAAAIDa9s...
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDa9s...
```

**Fix:** Extract the entire line:
```bash
grep ssh-uat.bookmyclass.app ~/.ssh/known_hosts
```

Copy the **entire output**, including hostname, key type, and key data.

---

### Lesson 9: QUIC Failed on Production cloudflared; Forcing HTTP/2 Fixed Tunnel

**Mistake:** Default cloudflared transport on PROD used QUIC (UDP), which failed.

**Result:** Cloudflared tunnel connector couldn't connect to Cloudflare backbone; tunnel was offline.

**Symptoms:**
```bash
journalctl -u cloudflared-tunnel
# Messages like: "Quic transport failed" or "Connection refused"
```

**Fix:** Force HTTP/2 transport in cloudflared config or service:

**Option A:** Edit systemd service (`/etc/systemd/system/cloudflared-tunnel.service`):
```ini
ExecStart=/usr/bin/cloudflared tunnel run --transport http2 --token <TOKEN>
```

**Option B:** Create config file (`/etc/cloudflared/config.yml`):
```yaml
tunnel: <tunnel-uuid>
credentials-file: /root/.cloudflared/<tunnel-uuid>.json
transport: http2
```

**Then reload and restart:**
```bash
systemctl daemon-reload
systemctl restart cloudflared-tunnel
systemctl status cloudflared-tunnel
```

**Verify tunnel is online:**
```bash
/usr/bin/cloudflared tunnel list
# Status should show "HEALTHY" or "RUNNING"
```

---

### Lesson 10: GitHub Workflow Succeeded Falsely When Errors Piped Through tee Without pipefail

**Mistake:** Deploy script had:
```bash
bash scripts/uat-deploy-tag.sh 2>&1 | tee /tmp/deploy.log
```

**Result:** If the script failed, the workflow didn't see the exit code because `tee`'s exit code (0) was returned instead of the script's exit code.

**Why:** Without `set -o pipefail`, the exit code of a pipeline is the exit code of the last command (`tee`), not intermediate failures.

**Fix:** Add `set -o pipefail` at the top of any job that uses pipes:

```bash
set -euo pipefail
# ... then later:
bash scripts/uat-deploy-tag.sh 2>&1 | tee /tmp/deploy.log
# Now if the script fails, the pipeline fails and workflow sees it
```

Or use `pipefail` explicitly:

```yaml
- name: Deploy
  run: |
    set -o pipefail
    bash scripts/uat-deploy-tag.sh 2>&1 | tee /tmp/deploy.log
```

**Pattern:** Always use `set -euo pipefail` at the start of shell scripts and workflows that use pipes.

---

### Lesson 11: UAT Post-Restart Health Check Failed Because App Wasn't Ready

**Mistake:** Health check ran immediately after PM2 restart, before the app was actually ready.

**Result:** Health check returned 503 or connection refused; deploy marked as failed even though app was starting.

**Fix:** Add retry loop with delay:

```bash
# Retry loop: 30 attempts, 2 seconds apart = 60 second timeout
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
    echo "Local health check passed"
    break
  fi
  if [[ ${attempt} -eq 30 ]]; then
    echo "Health check failed after 60 seconds" >&2
    exit 1
  fi
  sleep 2
done
```

This gives the app time to boot before declaring success.

---

### Lesson 12: Production Deploy Failed Because Server Couldn't git fetch origin GitHub

**Mistake:** GitHub Actions workflow could SSH to the server, but the server itself couldn't reach GitHub to `git fetch --all --tags`.

**Result:** Deploy script failed at `git fetch` step even though SSH to server worked fine.

**Why:** SSH from GitHub runner to server (Cloudflare tunnel) ≠ SSH from server to GitHub. These are separate network connections.

**Lesson:** SSH between runner and server is **not** the same as server's access to GitHub. Verify both:
- [ ] GitHub runner can SSH to server (Cloudflare tunnel) — tested by connectivity workflow
- [ ] Server can reach GitHub (or has SSH keys set up) — test: `ssh -i ~/.ssh/github -T git@github.com`

**Fix:** Ensure server has SSH keys for GitHub or can access via HTTPS:

```bash
# Option A: SSH key on server
ssh-keygen -t ed25519 -f ~/.ssh/github
# Add public key to GitHub deployment keys

# Option B: HTTPS access (if using URL like https://github.com/...)
# Usually works without extra setup if repo is public

# Verify:
cd /var/www/bookmyclass
git fetch --all --tags
```

---

### Lesson 13: PM2 Process Ownership and App Names Must Not Be Guessed

**Mistake:** Deployment script tried to restart `pm2 restart bookmyclass-app-uat` but PM2 was running as `deploy` user under a different name.

**Result:** PM2 couldn't find the app; restart failed.

**Fix:** Verify the exact PM2 app name and user before deploying:

```bash
# Check as root:
pm2 status
# Shows all processes

# Check as deploy user:
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 status
# Shows processes under deploy user
```

**Get the exact deployed info:**
```bash
# Before running workflows, get production details:
pm2 describe bookmyclass-app
# Shows name, script, args, uid, cwd, environment
```

**Store in GitHub secrets/variables** (see section 8):
- UAT: `UAT_PM2_APP_NAME=bookmyclass-app-uat` ✓ confirmed
- PROD: `PROD_PM2_APP_NAME=bookmyclass-app` (MUST be verified on server)

---

## 15. Security Notes

### SSH Key Management

- **Private keys** should be kept in GitHub secrets, not in the repository
- **Public keys** must be added to server `authorized_keys` for the deployment user
- Rotate keys regularly (e.g., annually or if leaked)
- Use separate keys for UAT and PROD if possible (recommended)

### Cloudflare Access Tokens

- **Service tokens** should be stored in GitHub secrets, never in code
- Service tokens grant access to the Access application; choose a minimal scope
- Set token expiration in Cloudflare (e.g., 6-12 months) and monitor for rotation
- If token leaks, revoke immediately in Cloudflare dashboard

### Workflow Logs

- GitHub Actions logs are visible to repo members (check privacy settings)
- Secrets are masked in logs (not shown to avoid leaking tokens)
- Consider restricting workflow access to only necessary teams
- Regularly audit workflow runs for suspicious activity

### Approvals and Audit Trail

- Production deployments require GitHub Environment approval (cannot be automated)
- Each approval is logged with approver username and timestamp
- Review approval logs to ensure authorized personnel are promoting to production
- Use CODEOWNERS to restrict who can approve (optional but recommended)

---

## 16. Production-Safety Notes

### Never Skip Testing

- UAT is operational for operator-run manual validation.
- Current releases use local/CI validation plus operator-run UAT/manual release validation.
- Store manual evidence at `test-results/manual_test_<YYYY-MM-DD>.md`.
- Demo-stage UAT may target the production/demo server when `UAT_*` secrets are
  intentionally set to those values. This must be logged as a warning, not
  treated as a failure.
- Never wire UAT workflow steps directly to `PROD_*` secrets.
- Never deploy directly to production from main or from an unvalidated commit.

### Approval Gate is Mandatory

- Production deploy workflow requires manual approval
- Do not bypass or auto-approve production deployments
- Have a second person review and approve (recommend 2-person rule)
- Check that the tag being deployed is the exact validated tag.

### Database Migrations

- Always run `npx prisma migrate deploy` before the application starts
- Migrations are cumulative and irreversible in production
- Test migrations on UAT first to verify safety
- Have a rollback plan if a migration causes issues (rollback to previous tag, then analyze DB state)

### Rollback Procedure

If production deployment causes issues:

1. SSH to production server (via Cloudflare tunnel)
   ```bash
   git checkout vX.Y.Z-1  # Previous known-good tag
   npm run build
   pm2 restart bookmyclass-app --update-env
   ```
2. Verify health endpoint returns 200
3. Investigate what went wrong with current tag
4. Create a fix branch, test on UAT, then re-promote

### Deployment Windows

- Recommend deploying during business hours (not late night or weekends)
- Have someone on-call to monitor post-deploy health
- Have someone who can rollback if needed
- Avoid Friday afternoon deployments (gives weekend if issues arise)

---

## 17. Final Checklist for UAT

Use this checklist to verify UAT CD is fully operational:

- [ ] **Local machine setup**
  - [ ] SSH key generated (`~/.ssh/bookmyclass-deploy-uat`)
  - [ ] cloudflared installed and working (`cloudflared --version`)
  - [ ] Local SSH config created (`~/.ssh/config` has `Host uat-cf` entry)
  - [ ] SSH to UAT works when Cloudflare tokens exported

- [ ] **Cloudflare configuration**
  - [ ] Tunnel connector running on UAT server (`systemctl status cloudflared-tunnel`)
  - [ ] Tunnel is online (`/usr/bin/cloudflared tunnel list` shows `HEALTHY`)
  - [ ] Public hostname added (`ssh-uat.bookmyclass.app` in tunnel config)
  - [ ] Access application created (`BookMyClass UAT SSH` application exists)
  - [ ] Service token created and saved (Client ID and Secret noted)

- [ ] **GitHub configuration**
  - [ ] Environment `uat` created
  - [ ] All required secrets added to `uat` environment (see section 8.2)
  - [ ] All required variables added to `uat` environment (see section 8.3)
  - [ ] Secrets verified (click "eye" icon shows masked value)
  - [ ] No approval gate needed for UAT (should run automatically)

- [ ] **Server configuration**
  - [ ] SSH server running
  - [ ] Deployment user public key in `~/.ssh/authorized_keys`
  - [ ] PM2 status shows `bookmyclass-app-uat` online
  - [ ] App directory exists (`/var/www/bookmyclass`)
  - [ ] `.env` file exists and is readable by app user
  - [ ] GitHub repository clone is present and `git remote -v` shows correct origin
  - [ ] Database container is running and accessible

- [ ] **Workflow testing**
  - [ ] Run `uat-ssh-connectivity` workflow manually; verify it succeeds
  - [ ] Create a test tag (`git tag -a v0.1.0-test && git push origin v0.1.0-test`)
  - [ ] Verify `uat-release` workflow is triggered automatically
  - [ ] All UAT workflow jobs complete successfully:
    - [ ] `regression` passes
    - [ ] `e2e` passes
    - [ ] `deploy_uat` succeeds (SSH, git checkout, build, PM2 restart)
    - [ ] `smoke_uat` passes
    - [ ] `e2e_uat` passes
    - [ ] `k6_smoke_uat` passes
    - [ ] `zap_uat` completes
  - [ ] UAT server is running the test tag (`git describe --tags --exact-match` shows `v0.1.0-test`)
  - [ ] Health endpoint returns 200 (`curl https://uat.bookmyclass.app/api/health`)

---

## 18. Final Checklist for PROD

Use this checklist to verify PROD CD is fully operational:

- [ ] **PROD values verified on server** (see section 10)
  - [ ] SSH user confirmed (root or deploy)
  - [ ] App directory confirmed (`/var/www/bookmyclass` or alternative)
  - [ ] PM2 app name confirmed (`bookmyclass-app` or alternative)
  - [ ] Database container name confirmed
  - [ ] Database name and user confirmed

- [ ] **Cloudflare configuration**
  - [ ] Tunnel connector running on PROD server (`systemctl status cloudflared-tunnel`)
  - [ ] Tunnel is online (`/usr/bin/cloudflared tunnel list` shows `HEALTHY`)
  - [ ] Forced to HTTP/2 transport if QUIC failed
  - [ ] Public hostname added (`ssh-prod.bookmyclass.app` in tunnel config)
  - [ ] Access application created (`BookMyClass PROD SSH` application exists)
  - [ ] Service token created (separate from UAT token)

- [ ] **GitHub configuration**
  - [ ] Environment `production` created
  - [ ] All required secrets added to `production` environment
  - [ ] All required variables added to `production` environment
  - [ ] Environment approval protection **enabled** (require reviewers)
  - [ ] Reviewers specified (recommend >= 1 person)

- [ ] **Server configuration**
  - [ ] SSH server running
  - [ ] Deployment user public key in `~/.ssh/authorized_keys`
  - [ ] PM2 status shows app online
  - [ ] App directory verified
  - [ ] `.env` file exists with correct production credentials
  - [ ] GitHub repository clone is present and `git remote -v` shows correct origin
  - [ ] Server can reach GitHub (`git fetch --all --tags` from app directory works)
  - [ ] Database container is running
  - [ ] Nginx proxy configured and pointing to app port 3000

- [ ] **Workflow testing**
  - [ ] Run `prod-ssh-connectivity` workflow manually; verify it succeeds
  - [ ] Use a UAT-validated tag (from successful UAT deploy) for PROD test
  - [ ] Trigger `prod-release` workflow manually with that tag
  - [ ] Workflow pauses and waits for approval (check Actions)
  - [ ] Review and approve deployment
  - [ ] Deploy job succeeds
  - [ ] `smoke_prod` job succeeds
  - [ ] PROD server is running the promoted tag
  - [ ] Verify public health endpoint (`curl https://bookmyclass.app/api/health` returns 200)

---

## 19. Appendix: Command Reference

Quick reference for common operations:

### Local Machine

```bash
# Generate SSH key
ssh-keygen -t ed25519 -f ~/.ssh/bookmyclass-deploy-uat -C "deploy@bookmyclass-uat"

# Show private key (for GitHub)
cat ~/.ssh/bookmyclass-deploy-uat

# Show public key (for server)
cat ~/.ssh/bookmyclass-deploy-uat.pub

# Test SSH to UAT
export CLOUDFLARE_ACCESS_CLIENT_ID="..."
export CLOUDFLARE_ACCESS_CLIENT_SECRET="..."
ssh uat-cf 'whoami'

# Collect known_hosts
ssh-keyscan -t ed25519 ssh-uat.bookmyclass.app 2>/dev/null | tee -a ~/.ssh/known_hosts

# Show known_hosts line for GitHub
grep ssh-uat.bookmyclass.app ~/.ssh/known_hosts
```

### Server (UAT or PROD)

```bash
# Check cloudflared tunnel status
systemctl status cloudflared-tunnel
journalctl -u cloudflared-tunnel -f

# List tunnels
/usr/bin/cloudflared tunnel list

# Check SSH authorized_keys
cat ~/.ssh/authorized_keys

# Verify app directory
ls -la /var/www/bookmyclass
cd /var/www/bookmyclass && git remote -v

# Check PM2 status
pm2 status
pm2 describe bookmyclass-app-uat

# Check PM2 logs
pm2 logs bookmyclass-app-uat --lines 50 --nostream

# Restart app manually (if needed)
pm2 restart bookmyclass-app-uat --update-env

# Verify tag currently deployed
cd /var/www/bookmyclass && git describe --tags --exact-match

# Test health endpoint locally
curl -sS http://127.0.0.1:3000/api/health

# Check environment variables loaded by app
pm2 describe bookmyclass-app-uat | grep -A 20 "env:"

# Check database connection
docker exec bookmyclass-uat-postgres psql -U bookmyclass_user -d bookmyclass_uat -c "SELECT version();"

# View nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### GitHub Actions

```bash
# Trigger UAT deployment: push a tag
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3

# Manual trigger for PROD deployment
# Go to GitHub → Actions → prod-release → Run workflow
# Enter tag in prompt and submit

# View workflow logs
# Go to GitHub → Actions → Select workflow run → Click job name
```

### Troubleshooting

```bash
# Local SSH verbose output
ssh -vvv uat-cf 'whoami'

# Server: test git access
cd /var/www/bookmyclass && git fetch --all --tags

# Server: health check
curl -sSf -w "code=%{http_code} time=%{time_total}s\n" http://127.0.0.1:3000/api/health

# Server: check PM2 home directory (if using non-root user)
sudo -u deploy env PM2_HOME=/home/deploy/.pm2 pm2 status
```

---

## Canonical References

- `.github/workflows/uat-release.yml` (UAT automated release workflow)
- `.github/workflows/prod-release.yml` (PROD manual release workflow)
- `.github/workflows/uat-ssh-connectivity.yml` (UAT SSH test workflow)
- `.github/workflows/prod-ssh-connectivity.yml` (PROD SSH test workflow)
- `scripts/uat-deploy-tag.sh` (UAT remote deployment script)
- `scripts/prod-deploy-tag.sh` (PROD remote deployment script)
- `docs/00_02_deployment_baseline.md` (canonical runtime facts)
- `docs/40_03_release_process.md` (release and deployment procedures)
- `docs/50_02_bookmyclass_server_setup_updated.md` (server bootstrap guide)
- `docs/50_10_remote_access_guide.md` (SSH tunnel access guide)

---

**Last Updated:** 2026-04-15  
**Verified By:** [To be filled by operator verification]  
**Next Review:** [To be scheduled]
