# Database Setup Guide (Production Server)

This guide explains how to set up the PostgreSQL database from scratch on the server and how to run Prisma Studio safely.

---

## Overview

Goal:
- Clean database setup
- Prisma connected correctly
- Safe access via SSH tunnel

---

## 1. Install PostgreSQL (if not installed)

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib -y
```

Start service:
```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

---

## 2. Create Database and User

Login as postgres:
```bash
sudo -u postgres psql
```

Create DB + user:
```sql
CREATE DATABASE bookmyclass;
CREATE USER bookmyclass_user WITH PASSWORD 'strong_password';
ALTER ROLE bookmyclass_user SET client_encoding TO 'utf8';
ALTER ROLE bookmyclass_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE bookmyclass_user SET timezone TO 'UTC';
GRANT ALL PRIVILEGES ON DATABASE bookmyclass TO bookmyclass_user;
```

Exit:
```bash
\q
```

---

## 3. Configure Connection URL

In your `.env`:

```env
DATABASE_URL="postgresql://bookmyclass_user:strong_password@localhost:5432/bookmyclass"
```

---

## 4. Run Prisma Migrations

From project root:

```bash
npx prisma migrate deploy
```

If first setup (no migrations yet):

```bash
npx prisma migrate dev --name init
```

---

## 5. Generate Prisma Client

```bash
npx prisma generate
```

---

## 6. Verify DB Connection

```bash
npx prisma db pull
```

If this works → DB is correctly connected

---

## 7. Run Prisma Studio (Server)

```bash
npx prisma studio
```

By default runs on:
```
http://localhost:5555
```

---

## 8. Access Prisma Studio (From Local)

Open SSH tunnel:

```bash
ssh -L 5555:localhost:5555 deploy@46.62.208.152
```

Then open:
```
http://localhost:5555
```

---

## 9. Production Safety Rules

- Never expose port 5432 publicly
- Never expose Prisma Studio publicly
- Always use SSH tunnels
- Use strong DB passwords
- Do NOT run `migrate dev` in production (only `deploy`)

---

## 10. Quick Checklist

- [ ] PostgreSQL installed
- [ ] DB + user created
- [ ] `.env` configured
- [ ] Migrations applied
- [ ] Prisma client generated
- [ ] Prisma Studio accessible via tunnel

---

## Key Principle

> Database is the source of truth.  
> Never bypass migrations or manual consistency rules.
