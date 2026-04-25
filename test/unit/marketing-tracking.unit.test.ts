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

  it("throws in non-production environments when MARKETING_TRACKING_SECRET is missing", async () => {
    process.env.NODE_ENV = "test";

    const module = await import("../../src/lib/marketing/marketing-tracking");

    expect(() => module.createRecipientTrackingToken("recipient-1")).toThrow(
      "Missing required env var: MARKETING_TRACKING_SECRET",
    );
  });

  it("returns a valid token when MARKETING_TRACKING_SECRET is set", async () => {
    process.env.NODE_ENV = "test";
    process.env.MARKETING_TRACKING_SECRET = "test-secret-value";

    const module = await import("../../src/lib/marketing/marketing-tracking");

    const token = module.createRecipientTrackingToken("recipient-1");
    expect(module.parseRecipientTrackingToken(token)).toBe("recipient-1");
  });
});
