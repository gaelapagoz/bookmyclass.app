import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyPasswordForKioskExit } from "@/lib/auth/kiosk-exit-auth";

function createMockRateLimiter(allowed = true) {
  return {
    checkLimit: vi.fn().mockReturnValue({ allowed }),
    recordFailure: vi.fn(),
    reset: vi.fn(),
  };
}

describe("kiosk exit auth", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when no authenticated session", async () => {
    const rateLimiter = createMockRateLimiter();

    const result = await verifyPasswordForKioskExit("password", {
      getSessionForKioskExit: vi.fn().mockResolvedValue(null),
      authorizeKioskExitCredentials: vi.fn(),
      rateLimiter,
    });

    expect(result).toBe(false);
    expect(rateLimiter.checkLimit).not.toHaveBeenCalled();
  });

  it("returns false when session has no user id or email", async () => {
    const rateLimiter = createMockRateLimiter();

    const result = await verifyPasswordForKioskExit("password", {
      getSessionForKioskExit: vi.fn().mockResolvedValue({
        user: { id: undefined, email: undefined },
      }),
      authorizeKioskExitCredentials: vi.fn(),
      rateLimiter,
    });

    expect(result).toBe(false);
    expect(rateLimiter.checkLimit).not.toHaveBeenCalled();
  });

  it("returns false when password verification fails", async () => {
    const rateLimiter = createMockRateLimiter();

    const result = await verifyPasswordForKioskExit("wrong-password", {
      getSessionForKioskExit: vi.fn().mockResolvedValue({
        user: { id: "user-id", email: "user@example.com" },
      }),
      authorizeKioskExitCredentials: vi.fn().mockResolvedValue(null),
      rateLimiter,
    });

    expect(result).toBe(false);
    expect(rateLimiter.recordFailure).toHaveBeenCalledWith("kiosk-exit:user-id");
    expect(rateLimiter.reset).not.toHaveBeenCalled();
  });

  it("returns true when password verification succeeds", async () => {
    const rateLimiter = createMockRateLimiter();

    const result = await verifyPasswordForKioskExit("correct-password", {
      getSessionForKioskExit: vi.fn().mockResolvedValue({
        user: { id: "user-id", email: "user@example.com" },
      }),
      authorizeKioskExitCredentials: vi.fn().mockResolvedValue({
        id: "user-id",
        email: "user@example.com",
        name: "User",
        role: "TEACHER",
      }),
      rateLimiter,
    });

    expect(result).toBe(true);
    expect(rateLimiter.reset).toHaveBeenCalledWith("kiosk-exit:user-id");
    expect(rateLimiter.recordFailure).not.toHaveBeenCalled();
  });

  it("throws RATE_LIMITED error when rate limit exceeded", async () => {
    await expect(
      verifyPasswordForKioskExit("password", {
        getSessionForKioskExit: vi.fn().mockResolvedValue({
          user: { id: "user-id", email: "user@example.com" },
        }),
        authorizeKioskExitCredentials: vi.fn(),
        rateLimiter: createMockRateLimiter(false),
      }),
    ).rejects.toThrow("RATE_LIMITED");
  });
});
