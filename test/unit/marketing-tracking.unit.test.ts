import { beforeEach, describe, expect, it, vi } from "vitest";

describe("marketing tracking secret resolution", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.MARKETING_TRACKING_SECRET;
    delete process.env.NEXTAUTH_SECRET;
  });

  it("throws in production when MARKETING_TRACKING_SECRET is missing", async () => {
    process.env.NODE_ENV = "production";

    const module = await import("../../src/lib/marketing/marketing-tracking");

    expect(() => module.createRecipientTrackingToken("recipient-1")).toThrow(
      "Missing required env var: MARKETING_TRACKING_SECRET",
    );
  });

  it("allows non-production fallback when MARKETING_TRACKING_SECRET is missing", async () => {
    process.env.NODE_ENV = "test";
    process.env.NEXTAUTH_SECRET = "nextauth-test-secret";

    const module = await import("../../src/lib/marketing/marketing-tracking");

    const token = module.createRecipientTrackingToken("recipient-1");
    expect(module.parseRecipientTrackingToken(token)).toBe("recipient-1");
  });
});
