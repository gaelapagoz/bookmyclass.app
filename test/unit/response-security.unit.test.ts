import { describe, expect, it } from "vitest";

import { buildBaseSecurityHeaders, buildContentSecurityPolicy } from "../../src/lib/security/response-security";

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
});

