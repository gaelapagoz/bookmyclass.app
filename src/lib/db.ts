import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { isE2ETestModeEnabled } from "@/lib/e2e/e2e-test-guard";

const globalForPrisma = globalThis as unknown as {
  adapter?: PrismaPg;
  prisma?: PrismaClient;
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected a positive integer.`);
  }

  return parsed;
}

function resolvePgPoolMaxConnections(): number {
  const defaultPoolMax = process.env.NODE_ENV === "test" || isE2ETestModeEnabled()
    ? 1
    : 10;
  return parsePositiveIntEnv("PRISMA_PG_POOL_MAX", defaultPoolMax);
}

function resolvePgPoolConnectionTimeoutMs(): number {
  const defaultTimeout = process.env.NODE_ENV === "test" || isE2ETestModeEnabled()
    ? 60_000
    : 30_000;
  return parsePositiveIntEnv("PRISMA_PG_POOL_CONNECTION_TIMEOUT_MS", defaultTimeout);
}

function resolvePgPoolIdleTimeoutMs(): number {
  return parsePositiveIntEnv("PRISMA_PG_POOL_IDLE_TIMEOUT_MS", 60_000);
}

function resolvePgPoolMaxLifetimeSeconds(): number {
  const defaultLifetimeSeconds = process.env.NODE_ENV === "test" || isE2ETestModeEnabled()
    ? 1_800
    : 300;
  return parsePositiveIntEnv("PRISMA_PG_POOL_MAX_LIFETIME_SECONDS", defaultLifetimeSeconds);
}

function getOrCreateAdapter(): PrismaPg {
  if (globalForPrisma.adapter) {
    return globalForPrisma.adapter;
  }

  const isTestRuntime = process.env.NODE_ENV === "test" || isE2ETestModeEnabled();
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    // Integration/E2E paths create bursty parallel queries during fixture setup.
    // Keep a bounded pool, but avoid starvation from an undersized max.
    max: resolvePgPoolMaxConnections(),
    connectionTimeoutMillis: resolvePgPoolConnectionTimeoutMs(),
    idleTimeoutMillis: resolvePgPoolIdleTimeoutMs(),
    keepAlive: !isTestRuntime,
    keepAliveInitialDelayMillis: 0,
    maxLifetimeSeconds: resolvePgPoolMaxLifetimeSeconds(),
  });
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.adapter = adapter;
  }
  return adapter;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter: getOrCreateAdapter() });
}

const prisma =
  globalForPrisma.prisma
    ? globalForPrisma.prisma
    : createPrismaClient();

export { prisma };
export default prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
