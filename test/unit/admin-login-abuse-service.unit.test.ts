import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbMockState } = vi.hoisted(() => ({
  dbMockState: {
    prisma: {} as unknown,
  },
}));

vi.mock("@/lib/db", () => ({
  get prisma() {
    return dbMockState.prisma;
  },
  get default() {
    return dbMockState.prisma;
  },
}));

vi.mock("../../src/lib/db", () => ({
  get prisma() {
    return dbMockState.prisma;
  },
  get default() {
    return dbMockState.prisma;
  },
}));

const FIXED_NOW = new Date("2026-01-15T12:00:00.000Z");
const DEFAULT_ABUSE_HASH_SECRET = "test-admin-login-abuse-secret";
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_CAPTCHA_THRESHOLD = 3;
const ADMIN_LOGIN_LOCKOUT_THRESHOLD = 6;

function hashAdminLoginBucketKey(value: string): string {
  return createHash("sha256").update(`${DEFAULT_ABUSE_HASH_SECRET}:${value}`).digest("hex");
}

function expectedBucketBranches(input: { ip: string; normalizedEmail: string }) {
  return [
    {
      keyType: "IP",
      keyHash: hashAdminLoginBucketKey(input.ip),
    },
    {
      keyType: "EMAIL",
      keyHash: hashAdminLoginBucketKey(input.normalizedEmail),
    },
    {
      keyType: "IP_EMAIL",
      keyHash: hashAdminLoginBucketKey(`${input.ip}:${input.normalizedEmail}`),
    },
  ];
}

async function importAdminLoginAbuseService() {
  return import("@/lib/auth/admin-login-abuse-service");
}

function setPrismaMock(prisma: unknown) {
  dbMockState.prisma = prisma;
}

describe("admin login abuse service", () => {
  beforeEach(() => {
    setPrismaMock({});
    vi.unstubAllEnvs();
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_SECRET", DEFAULT_ABUSE_HASH_SECRET);
    vi.stubEnv("ADMIN_LOGIN_ABUSE_HASH_SECRET", DEFAULT_ABUSE_HASH_SECRET);
    vi.doUnmock("@prisma/client");
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    setPrismaMock({});
    vi.doUnmock("@prisma/client");
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("returns neutral abuse state when Prisma abuse delegate is unavailable", async () => {
    setPrismaMock({
      // Delegate intentionally missing to emulate stale/generated-client runtime.
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const module = await importAdminLoginAbuseService();

    await expect(
      module.getAdminLoginAbuseState({
        ip: "203.0.113.1",
        normalizedEmail: "admin@example.test",
      }),
    ).resolves.toEqual({
      isLocked: false,
      requiresCaptcha: false,
      retryAfterMs: null,
    });

    await expect(
      module.recordAdminLoginFailure({
        ip: "203.0.113.1",
        normalizedEmail: "admin@example.test",
        reason: "invalid_password",
      }),
    ).resolves.toEqual({
      isLocked: false,
      requiresCaptcha: false,
      retryAfterMs: null,
    });

    await expect(
      module.resetAdminLoginFailureCounters({
        ip: "203.0.113.1",
        normalizedEmail: "admin@example.test",
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
  });

  it("uses delegate reads when Prisma abuse delegate is available", async () => {
    const input = {
      ip: "203.0.113.2",
      normalizedEmail: "admin2@example.test",
    };
    const lockedUntil = new Date(FIXED_NOW.getTime() + 60_000);
    const captchaRequiredUntil = new Date(FIXED_NOW.getTime() + 120_000);
    const firstFailedAt = new Date(FIXED_NOW.getTime() - 60_000);
    const lastFailedAt = new Date(FIXED_NOW.getTime() - 1_000);
    const rows = [
      {
        keyType: "IP",
        keyHash: hashAdminLoginBucketKey(input.ip),
        failedAttempts: ADMIN_LOGIN_LOCKOUT_THRESHOLD,
        firstFailedAt,
        lastFailedAt,
        lockedUntil,
        captchaRequiredUntil,
      },
    ];
    const findManyMock = vi.fn(async () => rows);

    setPrismaMock({
      adminLoginAbuseCounter: {
        findMany: findManyMock,
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      $transaction: vi.fn(),
    });

    const module = await importAdminLoginAbuseService();

    const result = await module.getAdminLoginAbuseState(input);

    expect(rows[0].failedAttempts).toBeGreaterThanOrEqual(ADMIN_LOGIN_CAPTCHA_THRESHOLD);
    expect(rows[0].failedAttempts).toBeGreaterThanOrEqual(ADMIN_LOGIN_LOCKOUT_THRESHOLD);
    expect(rows[0].firstFailedAt.getTime()).toBeGreaterThanOrEqual(FIXED_NOW.getTime() - ADMIN_LOGIN_WINDOW_MS);
    expect(rows[0].lastFailedAt.getTime()).toBeGreaterThanOrEqual(FIXED_NOW.getTime() - ADMIN_LOGIN_WINDOW_MS);
    expect(rows[0].lockedUntil.getTime()).toBeGreaterThan(FIXED_NOW.getTime());
    expect(rows[0].captchaRequiredUntil.getTime()).toBeGreaterThan(FIXED_NOW.getTime());
    expect(result).toEqual({
      isLocked: true,
      requiresCaptcha: true,
      retryAfterMs: 60_000,
    });

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const findManyArgs = findManyMock.mock.calls[0]?.[0];
    expect(findManyArgs.where.OR).toEqual(expectedBucketBranches(input));
    expect(findManyArgs.select).toMatchObject({
      keyType: true,
      keyHash: true,
      failedAttempts: true,
      firstFailedAt: true,
      lastFailedAt: true,
      lockedUntil: true,
      captchaRequiredUntil: true,
    });
  });

  it("returns neutral state for expired delegate rows", async () => {
    const input = {
      ip: "203.0.113.3",
      normalizedEmail: "expired-admin@example.test",
    };
    const expiredAt = new Date(FIXED_NOW.getTime() - 1_000);
    const outsideWindow = new Date(FIXED_NOW.getTime() - ADMIN_LOGIN_WINDOW_MS - 1_000);
    const rows = [
      {
        keyType: "EMAIL",
        keyHash: hashAdminLoginBucketKey(input.normalizedEmail),
        failedAttempts: ADMIN_LOGIN_LOCKOUT_THRESHOLD,
        firstFailedAt: outsideWindow,
        lastFailedAt: outsideWindow,
        lockedUntil: expiredAt,
        captchaRequiredUntil: expiredAt,
      },
    ];
    const findManyMock = vi.fn(async () => rows);

    setPrismaMock({
      adminLoginAbuseCounter: {
        findMany: findManyMock,
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      $transaction: vi.fn(),
    });

    const module = await importAdminLoginAbuseService();
    const result = await module.getAdminLoginAbuseState(input);

    expect(rows[0].lastFailedAt.getTime()).toBeLessThan(FIXED_NOW.getTime() - ADMIN_LOGIN_WINDOW_MS);
    expect(rows[0].lockedUntil.getTime()).toBeLessThan(FIXED_NOW.getTime());
    expect(rows[0].captchaRequiredUntil.getTime()).toBeLessThan(FIXED_NOW.getTime());
    expect(result).toEqual({
      isLocked: false,
      requiresCaptcha: false,
      retryAfterMs: null,
    });
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(findManyMock.mock.calls[0]?.[0].where.OR).toEqual(expectedBucketBranches(input));
  });

  it("fails closed in production when abuse delegate is unavailable and break-glass is inactive", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "prod-auth-secret");
    vi.stubEnv("ADMIN_LOGIN_ABUSE_HASH_SECRET", "prod-abuse-secret");
    vi.stubEnv("ADMIN_LOGIN_ABUSE_BREAK_GLASS_UNTIL", "");

    setPrismaMock({});

    const module = await importAdminLoginAbuseService();

    expect(process.env.NODE_ENV).toBe("production");
    expect(module.getAdminLoginAbuseGuardReadiness()).toMatchObject({
      ready: false,
      degraded: false,
      reason: "ADMIN_LOGIN_ABUSE_UNAVAILABLE",
    });

    await expect(
      module.getAdminLoginAbuseState({
        ip: "203.0.113.9",
        normalizedEmail: "prod-admin@example.test",
      }),
    ).rejects.toThrow("ADMIN_LOGIN_ABUSE_UNAVAILABLE");
  });

  it("allows temporary neutral fallback in production only when break-glass TTL is active", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "prod-auth-secret");
    vi.stubEnv("ADMIN_LOGIN_ABUSE_HASH_SECRET", "prod-abuse-secret");
    vi.stubEnv("ADMIN_LOGIN_ABUSE_BREAK_GLASS_UNTIL", "2099-01-01T00:00:00.000Z");
    vi.stubEnv("ADMIN_LOGIN_ABUSE_BREAK_GLASS_REASON", "incident-123");

    setPrismaMock({});

    const module = await importAdminLoginAbuseService();

    await expect(
      module.getAdminLoginAbuseState({
        ip: "203.0.113.10",
        normalizedEmail: "prod-breakglass@example.test",
      }),
    ).resolves.toEqual({
      isLocked: false,
      requiresCaptcha: false,
      retryAfterMs: null,
    });

    expect(module.getAdminLoginAbuseGuardReadiness()).toMatchObject({
      ready: true,
      degraded: true,
      breakGlassActive: true,
    });
  });
});
