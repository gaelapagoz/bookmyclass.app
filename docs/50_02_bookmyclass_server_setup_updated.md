# 🚀 Server Application Setup – BookMyClass (Run App + Bootstrap)

> Procedural guide only. Canonical deployment/runtime facts live in docs/00_02_deployment_baseline.md. If this file conflicts with baseline docs, follow 00_02_deployment_baseline.md and 00_01_system_baseline.md.

Scope: application runtime bootstrap only (Node, PM2, DB container start, env, build, nginx, SSL).


This document starts **after** base server setup (SSH, firewall, etc.).

---

## 1. Goal

Set up production runtime:

- Node.js
- PM2
- PostgreSQL (Docker)
- App deployment
- Environment variables
- Prisma (migrations + seed)
- Nginx
- SSL
- Validation

---

## 2. Install Base Packages

```bash
apt update && apt upgrade -y
apt install -y curl git unzip build-essential nginx
```

---

## 3. Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
npm -v
```

---

## 4. Install PM2

```bash
npm install -g pm2
pm2 -v
```

---

## 5. Install Docker

```bash
apt install -y docker.io
systemctl enable docker
systemctl start docker
```

---

## 6. Create App User

```bash
adduser deploy
usermod -aG sudo deploy
usermod -aG docker deploy
mkdir -p /var/www/bookmyclass
chown -R deploy:deploy /var/www/bookmyclass
```

Then:

```bash
su - deploy
```

---

## 7. Start PostgreSQL

```bash
docker run -d   --name <db-container-from-deployment-baseline>   --restart unless-stopped   -e POSTGRES_DB=<db-name-from-deployment-baseline>   -e POSTGRES_USER=<db-user-from-deployment-baseline>   -e POSTGRES_PASSWORD='bookmyclass-app-password'   -p 5432:5432   -v pgdata:/var/lib/postgresql/data   postgres:16
```

Validate:

```bash
docker ps
docker logs <db-container-from-deployment-baseline> --tail 50
```

---

## 8. Clone App

```bash
cd /var/www/bookmyclass
git clone YOUR_REPO .
```

---

## 9. Create .env

```bash
nano /var/www/bookmyclass/.env
chmod 600 /var/www/bookmyclass/.env
```

Example:

```env
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://<db-user-from-deployment-baseline>:<db-password>@localhost:5432/<db-name-from-deployment-baseline>?schema=public

AUTH_SECRET=xxx
NEXTAUTH_URL=https://bookmyclass.app

STRIPE_SECRET_KEY=xxx
STRIPE_WEBHOOK_SECRET=xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=xxx

STRIPE_PRICE_ID_COLLECTIVE_DROP_IN=price_xxx
STRIPE_PRICE_ID_COLLECTIVE_5_PACK=price_xxx
STRIPE_PRICE_ID_COLLECTIVE_10_PACK=price_xxx
STRIPE_PRICE_ID_MONTHLY_UNLIMITED_COLLECTIVE=price_xxx
STRIPE_PRICE_ID_PRIVATE_5_PACK=price_xxx
STRIPE_PRICE_ID_PRIVATE_10_PACK=price_xxx
STRIPE_PRICE_ID_STORE_GIFT_CARD_25_EUR=price_xxx
STRIPE_PRICE_ID_STORE_GIFT_CARD_50_EUR=price_xxx
STRIPE_PRICE_ID_STORE_GIFT_CARD_100_EUR=price_xxx
STRIPE_PRICE_ID_STORE_MERCH_YOGA_MAT=price_xxx
STRIPE_PRICE_ID_STORE_MERCH_RESISTANCE_BANDS=price_xxx
STRIPE_PRICE_ID_STORE_MERCH_STUDIO_TOTE=price_xxx

UPLOADS_DIR=/var/lib/bookmyclass/uploads
PUBLIC_UPLOADS_BASE_PATH=/uploads
```

---

## 9.5 Persistent uploaded media

Uploaded Store product images must live outside `/var/www/bookmyclass` so tag
checkouts, builds, and restarts do not erase them.

Create the persistent media root as root or a sudo-capable operator:

```bash
mkdir -p /var/lib/bookmyclass/uploads
chown -R deploy:deploy /var/lib/bookmyclass
chmod 750 /var/lib/bookmyclass /var/lib/bookmyclass/uploads
```

Then verify from the checked-out app directory after `.env` is present:

```bash
cd /var/www/bookmyclass
npm run verify:media-runtime
```

Backups and restores must include `/var/lib/bookmyclass/uploads` together with
the database. Restoring only the database may leave product image paths pointing
at files that are no longer present.

---

## 10. Install Dependencies

```bash
npm ci
```

---

## 11. Prisma

```bash
npx prisma generate
npx prisma migrate deploy
```

---

## 11.5 Seed

```bash
npx prisma db seed
```

---

## 11.6 Validate DB

```bash
docker exec -it <db-container-from-deployment-baseline> psql -U <db-user-from-deployment-baseline> -d <db-name-from-deployment-baseline> -c "\\dt"
```

---

## 12. Build

```bash
npm run build
```

---

## 13. PM2

```bash
pm2 start npm --name "bookmyclass-app" -- start
pm2 save
pm2 startup
pm2 status
pm2 logs bookmyclass-app --lines 50
```

---

## 14. Local Check

```bash
curl -I http://127.0.0.1:3000
```

---

## 15. Nginx

```bash
nano /etc/nginx/sites-available/bookmyclass
```

```nginx
server {
    listen 80;
    server_name bookmyclass.app www.bookmyclass.app;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /uploads/ {
        alias /var/lib/bookmyclass/uploads/;
        access_log off;
        expires 30d;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/bookmyclass /etc/nginx/sites-enabled/bookmyclass
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

---

## 16. SSL

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d bookmyclass.app -d www.bookmyclass.app
```

---

## 17. Update Flow

```bash
cd /var/www/bookmyclass
git fetch --all --tags
git checkout vX.Y.Z
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart bookmyclass-app --update-env
npm run verify:media-runtime
```

---

## ✅ Done

- DB seeded
- App running
- Nginx working
- HTTPS working
- Stripe working






## Server deploy command order

For UAT and Production, after checking out the release tag, use this command order:

```bash
git fetch --all --tags
git checkout vX.Y.Z
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart bookmyclass-app --update-env
npm run verify:media-runtime
```

### Command meaning

* `git fetch --all --tags` pulls latest remote refs and tags
* `git checkout vX.Y.Z` switches the server to the exact release version
* `npm ci` installs dependencies exactly from `package-lock.json`
* `npx prisma migrate deploy` applies committed migrations to the target database
* `npx prisma generate` regenerates Prisma client artifacts for the checked out version
* `npm run build` builds the Next.js application
* `pm2 restart bookmyclass-app --update-env` restarts the app with the current environment
* `npm run verify:media-runtime` confirms persistent upload storage is writable and returns `/uploads/...` paths

### Rules

* Always deploy from a tag, never from `main`
* Always run `npm ci` before build on UAT/Production
* Always run `npx prisma migrate deploy` before `npx prisma generate`
* Always run `npx prisma generate` before `npm run build`
* Always restart PM2 only after a successful build

### Notes

* `prisma migrate deploy` changes the database schema
* `prisma generate` updates the generated Prisma client
* These are different steps and both are required in deployment flow
* This sequence must be used consistently in both UAT and Production
