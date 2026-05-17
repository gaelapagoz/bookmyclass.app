import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAppUrl } from "@/lib/auth/auth-email-fast-lane-service";

describe("auth email fast lane app url validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects IPv6 loopback host in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => resolveAppUrl("http://[::1]:3000")).toThrow(
      "APP_URL must be configured to a non-localhost URL in production.",
    );
  });

  it("accepts non-loopback host in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveAppUrl("https://bookmyclass.app")).toBe("https://bookmyclass.app");
  });
});
