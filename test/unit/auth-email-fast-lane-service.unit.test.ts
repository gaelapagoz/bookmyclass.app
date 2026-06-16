import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAppUrl } from "@/lib/config/app-url";

describe("auth email fast lane app url validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires APP_URL when generating absolute links", () => {
    delete process.env.APP_URL;
    expect(() => resolveAppUrl()).toThrow("APP_URL is required when generating absolute URLs.");
  });

  it("normalizes APP_URL to its origin", () => {
    expect(resolveAppUrl("https://bookmyclass.app/dashboard?tab=bookings")).toBe(
      "https://bookmyclass.app",
    );
  });

  it("rejects IPv6 loopback host in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => resolveAppUrl("http://[::1]:3000")).toThrow(
      "APP_URL must be configured to a non-localhost URL in production.",
    );
  });

  it("rejects private-network hosts in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => resolveAppUrl("http://192.168.1.10:3000")).toThrow(
      "APP_URL must not use a private-network host in production.",
    );
  });

  it("rejects internal hostnames in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => resolveAppUrl("https://studio.internal")).toThrow(
      "APP_URL must use a public hostname in production.",
    );
  });

  it("accepts non-loopback host in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveAppUrl("https://bookmyclass.app")).toBe("https://bookmyclass.app");
  });
});
