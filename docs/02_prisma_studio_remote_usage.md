# 🔍 Prisma Studio – Remote Access (Safe Usage for Testing)

This guide explains how to run **Prisma Studio on your production server** and access it safely from your local machine.

---

## 🎯 Goal

- Inspect database data (users, bookings, catalog, etc.)
- Debug issues during beta
- Do NOT expose database publicly

---

## ⚠️ Security Rule

Never expose Prisma Studio to the internet.

❌ Do NOT use:
```bash
npx prisma studio --hostname 0.0.0.0
```

Always use SSH tunnel.

---

## 🧠 How It Works

- Prisma Studio runs on the server at `localhost`
- SSH tunnel forwards that port to your local machine
- Your browser connects securely through SSH

---

## ✅ Step-by-Step Setup

### 1. Start Prisma Studio on the server

SSH into your server and run:

```bash
cd /var/www/bookmyclass
BROWSER=none npx prisma studio --port 5555
```

You should see:

```text
Prisma Studio is running at http://localhost:5555
```

Leave this terminal open.

---

### 2. Open SSH tunnel from your local machine

On your LOCAL computer (not the server), run:

```bash
ssh -i ~/.ssh/bookmyclass_hetzner -L 5555:localhost:5555 deploy@YOUR_SERVER_IP
```

Example:

```bash
ssh -i ~/.ssh/bookmyclass_hetzner -L 5555:localhost:5555 deploy@46.62.208.152
```

Leave this terminal open.

---

### 3. Open Prisma Studio in browser

On your local machine, open:

```text
http://localhost:5555
```

You should now see your database.

---

## 🧪 What to Check

- Users table
- Bookings
- Sessions
- Subscriptions
- Catalog / pricing data

---

## 🔧 Troubleshooting

### Studio not opening

Check server:

```bash
ss -ltnp | grep 5555
```

If nothing shows → Prisma Studio not running

---

### Port already in use

Use a different local port:

Server:
```bash
BROWSER=none npx prisma studio --port 5555
```

Local:
```bash
ssh -L 5556:localhost:5555 deploy@YOUR_SERVER_IP
```

Browser:
```text
http://localhost:5556
```

---

### Empty database

Run:

```bash
npx prisma migrate deploy
npx prisma db seed
```

---

## 🧠 Mental Model

| Component | Runs where |
|----------|-----------|
| Prisma Studio | Server |
| SSH Tunnel | Local machine |
| Browser | Local machine |

---

## ✅ Done When

- Prisma Studio loads in browser
- Tables are visible
- Data reflects real app state
- No public exposure

---

## 🚀 Usage Tips

- Use only for debugging
- Do not keep it running permanently
- Always close tunnel when done
