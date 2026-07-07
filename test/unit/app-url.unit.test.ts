import { afterEach, describe, expect, it, vi } from "vitest";

import { AppUrlConfigError, buildAppUrl, resolveAppUrl, validateProductionAppUrl } from "@/lib/config/app-url";

describe("app url validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects invalid url text", () => {
    expect(() => resolveAppUrl("not-a-url")).toThrow(AppUrlConfigError);
    expect(() => resolveAppUrl("not-a-url")).toThrow("APP_URL must be an absolute URL.");
  });

  it("rejects unsupported schemes", () => {
    expect(() => resolveAppUrl("ftp://bookmyclass.app")).toThrow(AppUrlConfigError);
    expect(() => resolveAppUrl("ftp://bookmyclass.app")).toThrow("APP_URL must use http or https.");
  });

  it("rejects internal hostnames in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => resolveAppUrl("https://studio.internal")).toThrow(AppUrlConfigError);
    expect(() => resolveAppUrl("https://studio.internal")).toThrow(
      "APP_URL must use a public hostname in production.",
    );
  });

  it("rejects private ipv6 hosts in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => resolveAppUrl("https://[fd00::1]")).toThrow(AppUrlConfigError);
    expect(() => resolveAppUrl("https://[fd00::1]")).toThrow(
      "APP_URL must not use a private-network host in production.",
    );
  });

  it("allows explicit e2e production runtime override to use localhost app urls", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_TEST_MODE", "1");
    vi.stubEnv("E2E_ALLOW_PRODUCTION_RUNTIME", "1");
    vi.stubEnv("APP_URL", "http://localhost:3000");

    expect(() => validateProductionAppUrl()).not.toThrow();
    expect(resolveAppUrl()).toBe("http://localhost:3000");
  });

  it("builds encoded application urls from APP_URL without double slashes", () => {
    expect(
      buildAppUrl({
        appUrl: "https://demo.bookmyclass.app/",
        path: "/verify-email",
        query: {
          registrationToken: "token with spaces",
          email: "client+test@example.com",
        },
      }),
    ).toBe(
      "https://demo.bookmyclass.app/verify-email?registrationToken=token+with+spaces&email=client%2Btest%40example.com",
    );
  });

  it("rejects app url paths without a leading slash", () => {
    expect(() =>
      buildAppUrl({
        appUrl: "https://demo.bookmyclass.app",
        path: "verify-email",
      }),
    ).toThrow("Application URL paths must start with '/'.");
  });
});
