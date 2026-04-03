import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("admin login abuse service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock("@/lib/db");
    vi.doUnmock("@prisma/client");
    vi.resetModules();
  });

  it("returns neutral abuse state when Prisma abuse delegate is unavailable", async () => {
    vi.doMock("@/lib/db", () => ({
      prisma: {
        // Delegate intentionally missing to emulate stale/generated-client runtime.
      },
    }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const module = await import("../../src/lib/auth/admin-login-abuse-service");

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
    const findManyMock = vi.fn(async () => []);

    vi.doMock("@/lib/db", () => ({
      prisma: {
        adminLoginAbuseCounter: {
          findMany: findManyMock,
          updateMany: vi.fn(async () => ({ count: 0 })),
        },
        $transaction: vi.fn(),
      },
    }));

    const module = await import("../../src/lib/auth/admin-login-abuse-service");

    await expect(
      module.getAdminLoginAbuseState({
        ip: "203.0.113.2",
        normalizedEmail: "admin2@example.test",
      }),
    ).resolves.toEqual({
      isLocked: false,
      requiresCaptcha: false,
      retryAfterMs: null,
    });

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const findManyArgs = findManyMock.mock.calls[0]?.[0];
    expect(findManyArgs.where.OR).toHaveLength(3);
    expect(findManyArgs.where.OR.map((item: { keyType: string }) => item.keyType)).toEqual([
      "IP",
      "EMAIL",
      "IP_EMAIL",
    ]);
  });
});
