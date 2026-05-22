import { afterEach, describe, expect, it, vi } from "vitest";

describe("AUTH_SECRET hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws from auth secret resolver when AUTH_SECRET is missing", async () => {
    vi.stubEnv("AUTH_SECRET", "");

    const { getRequiredAuthSecret } = await import("@/lib/auth/auth-secret");
    expect(() => getRequiredAuthSecret()).toThrow("Missing required env var: AUTH_SECRET");
  });

  it("fails client abuse service module load without AUTH_SECRET", async () => {
    vi.stubEnv("AUTH_SECRET", "");

    await expect(import("@/lib/auth/client-login-abuse-service")).rejects.toThrow(
      "Missing required env var: AUTH_SECRET",
    );
  });

  it("fails password service module load without AUTH_SECRET", async () => {
    vi.stubEnv("AUTH_SECRET", "");

    await expect(import("@/lib/auth/password-service")).rejects.toThrow("Missing required env var: AUTH_SECRET");
  });
});
