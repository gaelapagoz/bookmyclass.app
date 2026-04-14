import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAdminLoginCaptchaSiteKey, verifyAdminLoginCaptcha } from "../../src/lib/auth/admin-login-captcha";

describe("admin-login-captcha", () => {
  const originalSecret = process.env.ADMIN_LOGIN_CAPTCHA_SECRET_KEY;
  const originalSiteKey = process.env.ADMIN_LOGIN_CAPTCHA_SITE_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.ADMIN_LOGIN_CAPTCHA_SECRET_KEY = originalSecret;
    process.env.ADMIN_LOGIN_CAPTCHA_SITE_KEY = originalSiteKey;
  });

  it("returns true when captcha secret is not configured", async () => {
    process.env.ADMIN_LOGIN_CAPTCHA_SECRET_KEY = "";
    await expect(verifyAdminLoginCaptcha({ token: null, ip: "127.0.0.1" })).resolves.toBe(true);
  });

  it("returns false when token is missing while captcha is enabled", async () => {
    process.env.ADMIN_LOGIN_CAPTCHA_SECRET_KEY = "captcha-secret";
    await expect(verifyAdminLoginCaptcha({ token: "   ", ip: "127.0.0.1" })).resolves.toBe(false);
  });

  it("returns false when provider returns non-ok response", async () => {
    process.env.ADMIN_LOGIN_CAPTCHA_SECRET_KEY = "captcha-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ success: false }) })) as unknown as typeof fetch,
    );

    await expect(verifyAdminLoginCaptcha({ token: "tok", ip: "127.0.0.1" })).resolves.toBe(false);
  });

  it("returns provider success payload as boolean", async () => {
    process.env.ADMIN_LOGIN_CAPTCHA_SECRET_KEY = "captcha-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })) as unknown as typeof fetch,
    );

    await expect(verifyAdminLoginCaptcha({ token: "tok", ip: "127.0.0.1" })).resolves.toBe(true);
  });

  it("returns null site key when not configured", () => {
    process.env.ADMIN_LOGIN_CAPTCHA_SITE_KEY = "";
    expect(getAdminLoginCaptchaSiteKey()).toBeNull();
  });

  it("returns configured site key", () => {
    process.env.ADMIN_LOGIN_CAPTCHA_SITE_KEY = "site-key";
    expect(getAdminLoginCaptchaSiteKey()).toBe("site-key");
  });
});
