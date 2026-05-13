import { execSync } from "node:child_process";
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
  execSync("npx prisma migrate deploy", {
    cwd: resolve(process.cwd()),
    env: process.env,
    stdio: "ignore",
  });

  globalForTestSetup.__integrationDbReady = true;
}
