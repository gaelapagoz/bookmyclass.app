import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function importAdminLoginAbuseService() {
  return import("@/lib/auth/admin-login-abuse-service");
}

describe("admin login abuse service", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/db");
    vi.doUnmock("../../src/lib/db");
    vi.doUnmock("@prisma/client");
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock("@/lib/db");
    vi.doUnmock("../../src/lib/db");
    vi.doUnmock("@prisma/client");
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns neutral abuse state when Prisma abuse delegate is unavailable", async () => {
    vi.doMock("@/lib/db", () => ({
      prisma: {
        // Delegate intentionally missing to emulate stale/generated-client runtime.
      },
    }));

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
    const lockedUntil = new Date(Date.now() + 60_000);
    const captchaRequiredUntil = new Date(Date.now() + 120_000);
    const findManyMock = vi.fn(async () => [
      {
        keyType: "IP",
        keyHash: "hashed-ip",
        failedAttempts: 6,
        firstFailedAt: new Date(Date.now() - 60_000),
        lastFailedAt: new Date(),
        lockedUntil,
        captchaRequiredUntil,
      },
    ]);

    vi.doMock("@/lib/db", () => ({
      prisma: {
        adminLoginAbuseCounter: {
          findMany: findManyMock,
          updateMany: vi.fn(async () => ({ count: 0 })),
          findUnique: vi.fn(),
          upsert: vi.fn(),
        },
        $transaction: vi.fn(),
      },
    }));

    const module = await importAdminLoginAbuseService();

    const result = await module.getAdminLoginAbuseState({
      ip: "203.0.113.2",
      normalizedEmail: "admin2@example.test",
    });

    expect(result).toMatchObject({
      isLocked: true,
      requiresCaptcha: true,
    });
    expect(result.retryAfterMs).toBeGreaterThan(0);

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const findManyArgs = findManyMock.mock.calls[0]?.[0];
    expect(findManyArgs.where.OR).toHaveLength(3);
    expect(findManyArgs.where.OR.map((item: { keyType: string }) => item.keyType)).toEqual([
      "IP",
      "EMAIL",
      "IP_EMAIL",
    ]);
  });

  it("fails closed in production when abuse delegate is unavailable and break-glass is inactive", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "prod-auth-secret");
    vi.stubEnv("ADMIN_LOGIN_ABUSE_HASH_SECRET", "prod-abuse-secret");
    vi.stubEnv("ADMIN_LOGIN_ABUSE_BREAK_GLASS_UNTIL", "");

    vi.doMock("@/lib/db", () => ({
      prisma: {},
    }));

    const module = await importAdminLoginAbuseService();

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

    vi.doMock("@/lib/db", () => ({
      prisma: {},
    }));

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
