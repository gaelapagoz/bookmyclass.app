import { describe, expect, it } from "vitest";

import {
  buildBaseSecurityHeaders,
  buildContentSecurityPolicy,
  getCspHeaderName,
  resolveCspMode,
  resolveEffectiveCspMode,
  shouldAttachContentSecurityPolicy,
} from "../../src/lib/security/response-security";

function toHeaderMap(headers: Array<{ key: string; value: string }>) {
  return new Map(headers.map((header) => [header.key, header.value]));
}

describe("response security headers", () => {
  it("builds CSP without unsafe-inline directives", () => {
    const csp = buildContentSecurityPolicy({ nonce: "abc123" });

    expect(csp).toContain("script-src 'self' 'nonce-abc123' https://challenges.cloudflare.com");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it("includes required low-finding headers", () => {
    const headerMap = toHeaderMap(
      buildBaseSecurityHeaders({
        requestProtocol: "https:",
        isProduction: true,
      }),
    );

    expect(headerMap.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headerMap.get("Permissions-Policy")).toContain("camera=()");
    expect(headerMap.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headerMap.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(headerMap.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("does not emit HSTS for explicit http requests", () => {
    const headerMap = toHeaderMap(
      buildBaseSecurityHeaders({
        requestProtocol: "http:",
        isProduction: true,
      }),
    );

    expect(headerMap.has("Strict-Transport-Security")).toBe(false);
  });

  it("attaches CSP for document and metadata routes", () => {
    expect(shouldAttachContentSecurityPolicy("/")).toBe(true);
    expect(shouldAttachContentSecurityPolicy("/about/studio")).toBe(true);
    expect(shouldAttachContentSecurityPolicy("/sign-in")).toBe(true);
    expect(shouldAttachContentSecurityPolicy("/sign-up")).toBe(true);
    expect(shouldAttachContentSecurityPolicy("/subscription")).toBe(true);
    expect(shouldAttachContentSecurityPolicy("/book-a-class")).toBe(true);
    expect(shouldAttachContentSecurityPolicy("/book-a-class/success")).toBe(true);
    expect(shouldAttachContentSecurityPolicy("/dashboard")).toBe(true);
    expect(shouldAttachContentSecurityPolicy("/sitemap.xml")).toBe(true);
    expect(shouldAttachContentSecurityPolicy("/robots.txt")).toBe(true);
    expect(shouldAttachContentSecurityPolicy("/_next/image")).toBe(true);
  });

  it("does not attach CSP for API and static assets", () => {
    expect(shouldAttachContentSecurityPolicy("/api/health")).toBe(false);
    expect(shouldAttachContentSecurityPolicy("/_next/static/chunks/app.js")).toBe(false);
    expect(shouldAttachContentSecurityPolicy("/_next/static/media/font.woff2")).toBe(false);
  });

  it("resolves CSP mode with enforce fallback", () => {
    expect(resolveCspMode("report-only")).toBe("report-only");
    expect(resolveCspMode("REPORT-ONLY")).toBe("report-only");
    expect(resolveCspMode("enforce")).toBe("enforce");
    expect(resolveCspMode("unexpected")).toBe("enforce");
    expect(resolveCspMode(undefined)).toBe("enforce");
  });

  it("maps CSP mode to the correct response header", () => {
    expect(getCspHeaderName("report-only")).toBe("Content-Security-Policy-Report-Only");
    expect(getCspHeaderName("enforce")).toBe("Content-Security-Policy");
  });

  it("forces enforce mode in production context", () => {
    expect(resolveEffectiveCspMode("report-only", { isProduction: true })).toBe("enforce");
    expect(resolveEffectiveCspMode("report-only", { isProduction: false })).toBe("report-only");
    expect(
      resolveEffectiveCspMode("report-only", {
        isProduction: true,
        allowReportOnlyInProduction: true,
      }),
    ).toBe("report-only");
  });
});
