import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCsrfTokenFromHeaders,
  getCsrfFieldName,
  validateCsrfTokenFromHeadersAndFormData,
} from "../../src/lib/security/csrf-token";

function createHeaders(host = "uat.bookmyclass.app"): Headers {
  return new Headers({
    "x-forwarded-host": host,
    "x-forwarded-proto": "https",
  });
}

describe("csrf token validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a valid token for the same origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "test-auth-secret");
    vi.stubEnv("APP_URL", "https://uat.bookmyclass.app");

    const issuedAt = new Date("2026-01-01T10:00:00.000Z");
    const token = createCsrfTokenFromHeaders(createHeaders(), issuedAt);
    expect(token).toBeTruthy();

    const formData = new FormData();
    formData.set(getCsrfFieldName(), token ?? "");

    const result = validateCsrfTokenFromHeadersAndFormData(
      createHeaders(),
      formData,
      new Date("2026-01-01T10:10:00.000Z"),
    );

    expect(result.ok).toBe(true);
  });

  it("rejects token mismatch for different origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "test-auth-secret");
    vi.stubEnv("APP_URL", "https://evil.example");

    const issuedAt = new Date("2026-01-01T10:00:00.000Z");
    const token = createCsrfTokenFromHeaders(createHeaders("uat.bookmyclass.app"), issuedAt);
    expect(token).toBeTruthy();

    const formData = new FormData();
    formData.set(getCsrfFieldName(), token ?? "");

    const result = validateCsrfTokenFromHeadersAndFormData(
      createHeaders("evil.example"),
      formData,
      new Date("2026-01-01T10:10:00.000Z"),
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("mismatch");
  });

  it("rejects expired token", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "test-auth-secret");
    vi.stubEnv("APP_URL", "https://uat.bookmyclass.app");

    const issuedAt = new Date("2026-01-01T10:00:00.000Z");
    const token = createCsrfTokenFromHeaders(createHeaders(), issuedAt);
    expect(token).toBeTruthy();

    const formData = new FormData();
    formData.set(getCsrfFieldName(), token ?? "");

    const result = validateCsrfTokenFromHeadersAndFormData(
      createHeaders(),
      formData,
      new Date("2026-01-01T12:00:00.000Z"),
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("throws when AUTH_SECRET is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("APP_URL", "https://uat.bookmyclass.app");

    expect(() => createCsrfTokenFromHeaders(createHeaders())).toThrow("Missing required env var: AUTH_SECRET");
  });
});
