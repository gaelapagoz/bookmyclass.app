# Database Setup Guide (Docker-Based Production Server)

This guide explains the correct setup for the **database on the server when PostgreSQL runs in Docker**, and how to access it safely with Prisma and Prisma Studio.

---

## Overview

This production setup uses:

- **PostgreSQL inside a Docker container**
- **App running on the server**
- **Prisma migrations applied from the app**
- **Prisma Studio accessed only through SSH tunnel**

This keeps the database private and consistent with the current hosting architecture.

---

## 1. Verify Docker Is Installed

```bash
docker --version
docker compose version
```

If Docker is missing, install Docker first before continuing.

---

## 2. Create Persistent Storage for PostgreSQL

Create a directory for DB persistence:

```bash
mkdir -p ~/bookmyclass/postgres-data
```

This ensures DB data survives container restarts and deployments.

---

## 3. Add PostgreSQL Service to Docker Compose

Use a dedicated PostgreSQL container in your server `docker-compose.yml` or `compose.yml`.

Example:

```yaml
services:
  postgres:
    image: postgres:16
    container_name: bookmyclass-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: bookmyclass
      POSTGRES_USER: bookmyclass_user
      POSTGRES_PASSWORD: CHANGE_THIS_STRONG_PASSWORD
    volumes:
      - ~/bookmyclass/postgres-data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
```

### Why this is the correct setup
- Data is persistent
- DB restarts automatically
- Port is bound to `127.0.0.1`, not public internet
- Works with your current Docker-based hosting

---

## 4. Start the Database Container

```bash
docker compose up -d postgres
```

Check that it is running:

```bash
docker ps
```

You should see the `bookmyclass-postgres` container up.

---

## 5. Configure the App DATABASE_URL

In the app `.env` on the server:

```env
DATABASE_URL="postgresql://bookmyclass_user:CHANGE_THIS_STRONG_PASSWORD@localhost:5432/bookmyclass"
```

### Important
Use `localhost:5432` on the server because Docker exposes the container port to loopback only.

---

## 6. Validate Database Connectivity

From the server, test access:

```bash
docker exec -it bookmyclass-postgres psql -U bookmyclass_user -d bookmyclass
```

If this opens `psql`, the DB is working.

Exit with:

```bash
\q
```

---

## 7. Apply Prisma Migrations

From the app project root on the server:

```bash
npx prisma migrate deploy
```

### Rule
Use `migrate deploy` in production.  
Do **not** use `prisma migrate dev` on production.

---

## 8. Generate Prisma Client

```bash
npx prisma generate
```

This ensures the app uses the current schema.

---

## 9. Start Prisma Studio on the Server

From the app project root:

```bash
npx prisma studio --port 51212 --hostname 127.0.0.1
npx prisma studio --browser none
```

### Why this matters
- Runs Prisma Studio on a known port
- Binds it only to local server access
- Prevents public exposure

---

## 10. Access Prisma Studio From Your Local Machine

Open the SSH tunnel from your local machine:

```bash
ssh -L 51212:localhost:51212 deploy@46.62.208.152
```

Then open in your local browser:

```text
http://localhost:51212
```

---

## 11. Access PostgreSQL From Your Local Machine

Open the DB tunnel:

```bash
ssh -L 5432:localhost:5432 deploy@46.62.208.152
```

Then connect from your DB client with:

- Host: `localhost`
- Port: `5432`
- Database: `bookmyclass`
- User: `bookmyclass_user`
- Password: the PostgreSQL password

---

## 12. Useful Docker Commands

### See running containers
```bash
docker ps
```

### View DB logs
```bash
docker logs bookmyclass-postgres
```

### Restart DB container
```bash
docker restart bookmyclass-postgres
```

### Open psql inside the container
```bash
docker exec -it bookmyclass-postgres psql -U bookmyclass_user -d bookmyclass
```

---

## 13. Production Safety Rules

- Do not expose PostgreSQL publicly
- Do not expose Prisma Studio publicly
- Bind DB to `127.0.0.1`
- Use SSH tunnels for all admin access
- Use `prisma migrate deploy` only in production
- Keep DB credentials in environment variables, not hardcoded in app code

---

## 14. Quick Checklist

- [ ] Docker is installed
- [ ] PostgreSQL container exists
- [ ] Persistent volume is configured
- [ ] DB port is bound only to `127.0.0.1`
- [ ] `DATABASE_URL` is correct
- [ ] Prisma migrations applied
- [ ] Prisma Studio started on `127.0.0.1:51212`
- [ ] SSH tunnel works locally

---

## Key Principle

> Keep PostgreSQL private, Dockerized, and persistent.  
> Use Prisma migrations as the only schema change path.
