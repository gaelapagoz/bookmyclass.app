import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
// NOTE: Environment variables are injected by the test runner (see npm test).
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.test", override: true });

// Stripe keys from .env.local must not leak into integration tests.
// No STRIPE_SECRET_KEY → attemptStorePriceSyncFromEnv returns null → prices stay PENDING.
delete process.env.STRIPE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env.test.");
}

process.env.AUTH_SECRET ??= "test-auth-secret";
process.env.ADMIN_LOGIN_ABUSE_HASH_SECRET ??= process.env.AUTH_SECRET;

if (!process.env.DATABASE_URL.includes("test")) {
  throw new Error("Test DB must contain 'test' in its name.");
}

const globalForTestSetup = globalThis as typeof globalThis & {
  __integrationDbReady?: boolean;
};

if (!globalForTestSetup.__integrationDbReady) {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const markerDir = resolve(tmpdir(), "studio-saas-vitest-db-ready");
  const markerKey = Buffer.from(dbUrl).toString("base64url");
  const markerPath = resolve(markerDir, `${markerKey}.marker`);
  const lockPath = resolve(markerDir, `${markerKey}.lock`);

  mkdirSync(markerDir, { recursive: true });

  function buildMigrationSignature(): string {
    const migrationsDir = resolve(process.cwd(), "prisma", "migrations");
    if (!existsSync(migrationsDir)) {
      return "no-migrations-dir";
    }

    const names = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    return names.join("|");
  }

  const migrationSignature = buildMigrationSignature();

  const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

  const runMigrateDeploy = () => {
    const maxAttempts = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        execSync("npx prisma migrate deploy", {
          cwd: resolve(process.cwd()),
          env: process.env,
          stdio: "pipe",
        });
        writeFileSync(markerPath, JSON.stringify({ at: new Date().toISOString(), migrationSignature }), "utf8");
        return;
      } catch (error) {
        const typed = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
        const stdout = typed.stdout ? typed.stdout.toString("utf8") : "";
        const stderr = typed.stderr ? typed.stderr.toString("utf8") : "";
        lastError = new Error(
          `npx prisma migrate deploy failed (attempt ${attempt}/${maxAttempts}).\nstdout:\n${stdout}\nstderr:\n${stderr}\n${typed.message ?? ""}`,
        );

        if (attempt < maxAttempts) {
          sleep(attempt * 500);
        }
      }
    }

    throw lastError ?? new Error("npx prisma migrate deploy failed with unknown error.");
  };

  let markerIsCurrent = false;
  if (existsSync(markerPath)) {
    const markerRaw = readFileSync(markerPath, "utf8").trim();
    let markerSignature: string | null = null;
    if (markerRaw.startsWith("{")) {
      try {
        const parsed = JSON.parse(markerRaw) as { migrationSignature?: string };
        markerSignature = parsed.migrationSignature ?? null;
      } catch {
        markerSignature = null;
      }
    }

    if (markerSignature === migrationSignature) {
      markerIsCurrent = true;
      globalForTestSetup.__integrationDbReady = true;
    } else {
      if (existsSync(markerPath)) {
        unlinkSync(markerPath);
      }
    }
  }

  if (!markerIsCurrent) {
    let hasLock = false;

    try {
      // Claim lock atomically. If it already exists, another worker/process is running migrations.
      writeFileSync(lockPath, `${process.pid}`, { flag: "wx", encoding: "utf8" });
      hasLock = true;
      runMigrateDeploy();
      globalForTestSetup.__integrationDbReady = true;
    } catch (error) {
      if (hasLock) {
        throw error;
      }

      // Wait for the lock holder to finish and create marker.
      const waitUntil = Date.now() + 120_000;
      while (Date.now() < waitUntil) {
        if (existsSync(markerPath)) {
          globalForTestSetup.__integrationDbReady = true;
          break;
        }

        if (!existsSync(lockPath)) {
          // Lock disappeared without marker; try running migrations ourselves.
          runMigrateDeploy();
          globalForTestSetup.__integrationDbReady = true;
          break;
        }

        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      }

      if (!globalForTestSetup.__integrationDbReady) {
        const lockOwner = existsSync(lockPath) ? readFileSync(lockPath, "utf8").trim() : "(none)";
        throw new Error(`Timed out waiting for integration DB migrate lock. lockPath=${lockPath} owner=${lockOwner}`);
      }
    } finally {
      if (hasLock && existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    }
  }

  globalForTestSetup.__integrationDbReady = true;
}
