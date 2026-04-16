import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("kiosk exit auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock("@/lib/auth/kiosk-exit-auth-deps");
    vi.doUnmock("@/lib/security/rate-limit");
    vi.resetModules();
  });

  it("returns false when no authenticated session", async () => {
    vi.doMock("@/lib/auth/kiosk-exit-auth-deps", () => ({
      getSessionForKioskExit: vi.fn().mockResolvedValue(null),
      authorizeKioskExitCredentials: vi.fn(),
    }));

    vi.doMock("@/lib/security/rate-limit", () => ({
      createRateLimiter: vi.fn().mockReturnValue({
        checkLimit: vi.fn().mockReturnValue({ allowed: true }),
        recordFailure: vi.fn(),
        reset: vi.fn(),
      }),
    }));

    const module = await import("../../src/lib/auth/kiosk-exit-auth");
    const result = await module.verifyPasswordForKioskExit("password");

    expect(result).toBe(false);
  });

  it("returns false when session has no user id or email", async () => {
    vi.doMock("@/lib/auth/kiosk-exit-auth-deps", () => ({
      getSessionForKioskExit: vi.fn().mockResolvedValue({
        user: { id: undefined, email: undefined },
      }),
      authorizeKioskExitCredentials: vi.fn(),
    }));

    vi.doMock("@/lib/security/rate-limit", () => ({
      createRateLimiter: vi.fn().mockReturnValue({
        checkLimit: vi.fn().mockReturnValue({ allowed: true }),
        recordFailure: vi.fn(),
        reset: vi.fn(),
      }),
    }));

    const module = await import("../../src/lib/auth/kiosk-exit-auth");
    const result = await module.verifyPasswordForKioskExit("password");

    expect(result).toBe(false);
  });

  it("returns false when password verification fails", async () => {
    vi.doMock("@/lib/auth/kiosk-exit-auth-deps", () => ({
      getSessionForKioskExit: vi.fn().mockResolvedValue({
        user: { id: "user-id", email: "user@example.com" },
      }),
      authorizeKioskExitCredentials: vi.fn().mockResolvedValue(null),
    }));

    vi.doMock("@/lib/security/rate-limit", () => ({
      createRateLimiter: vi.fn().mockReturnValue({
        checkLimit: vi.fn().mockReturnValue({ allowed: true }),
        recordFailure: vi.fn(),
        reset: vi.fn(),
      }),
    }));

    const module = await import("../../src/lib/auth/kiosk-exit-auth");
    const result = await module.verifyPasswordForKioskExit("wrong-password");

    expect(result).toBe(false);
  });

  it("returns true when password verification succeeds", async () => {
    vi.doMock("@/lib/auth/kiosk-exit-auth-deps", () => ({
      getSessionForKioskExit: vi.fn().mockResolvedValue({
        user: { id: "user-id", email: "user@example.com" },
      }),
      authorizeKioskExitCredentials: vi.fn().mockResolvedValue({
        id: "user-id",
        email: "user@example.com",
        role: "TEACHER",
      }),
    }));

    vi.doMock("@/lib/security/rate-limit", () => ({
      createRateLimiter: vi.fn().mockReturnValue({
        checkLimit: vi.fn().mockReturnValue({ allowed: true }),
        recordFailure: vi.fn(),
        reset: vi.fn(),
      }),
    }));

    const module = await import("../../src/lib/auth/kiosk-exit-auth");
    const result = await module.verifyPasswordForKioskExit("correct-password");

    expect(result).toBe(true);
  });

  it("throws RATE_LIMITED error when rate limit exceeded", async () => {
    vi.doMock("@/lib/auth/kiosk-exit-auth-deps", () => ({
      getSessionForKioskExit: vi.fn().mockResolvedValue({
        user: { id: "user-id", email: "user@example.com" },
      }),
      authorizeKioskExitCredentials: vi.fn(),
    }));

    vi.doMock("@/lib/security/rate-limit", () => ({
      createRateLimiter: vi.fn().mockReturnValue({
        checkLimit: vi.fn().mockReturnValue({ allowed: false }),
        recordFailure: vi.fn(),
        reset: vi.fn(),
      }),
    }));

    const module = await import("../../src/lib/auth/kiosk-exit-auth");
    await expect(
      module.verifyPasswordForKioskExit("password", {
        rateLimiter: {
          checkLimit: vi.fn().mockReturnValue({ allowed: false }),
          recordFailure: vi.fn(),
          reset: vi.fn(),
        },
      }),
    ).rejects.toThrow("RATE_LIMITED");
  });
});