import { describe, expect, it } from "vitest";
import { getTrustedClientIpFromHeaders } from "@/lib/security/rate-limit";

describe("getTrustedClientIpFromHeaders", () => {
  it("prefers cf-connecting-ip over all other headers", () => {
    const headers = new Headers({
      "cf-connecting-ip": "198.51.100.10",
      "x-real-ip": "198.51.100.11",
      "x-forwarded-for": "198.51.100.12",
    });

    expect(getTrustedClientIpFromHeaders(headers)).toBe("198.51.100.10");
  });

  it("falls back to x-real-ip when cf-connecting-ip is unavailable", () => {
    const headers = new Headers({
      "x-real-ip": "198.51.100.11",
      "x-forwarded-for": "198.51.100.12",
    });

    expect(getTrustedClientIpFromHeaders(headers)).toBe("198.51.100.11");
  });

  it("returns unknown when only x-forwarded-for exists and fallback is disabled", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.12",
    });

    expect(getTrustedClientIpFromHeaders(headers)).toBe("unknown");
  });

  it("uses first x-forwarded-for value only when explicitly allowed", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.12, 198.51.100.44",
    });

    expect(getTrustedClientIpFromHeaders(headers, { allowForwardedFor: true })).toBe("198.51.100.12");
  });
});
