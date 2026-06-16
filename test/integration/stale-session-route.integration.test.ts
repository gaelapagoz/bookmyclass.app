import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET as handleStaleSession } from "../../src/app/auth/stale-session/route";

function getSetCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };

  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const singleValue = headers.get("set-cookie");
  return singleValue ? [singleValue] : [];
}

describe("GET /auth/stale-session", () => {
  it("clears auth cookies and redirects to sign-in with callbackUrl", async () => {
    const request = new NextRequest(
      "http://localhost:3000/auth/stale-session?callbackUrl=%2Fdashboard%2Fbookings",
    );

    const response = await handleStaleSession(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/sign-in?callbackUrl=%2Fdashboard%2Fbookings");

    const setCookieHeaders = getSetCookieHeaders(response);
    const setCookieText = setCookieHeaders.join("\n");

    expect(setCookieText).toContain("__Secure-authjs.session-token=;");
    expect(setCookieText).toContain("authjs.session-token=;");
    expect(setCookieText).toContain("__Secure-next-auth.session-token=;");
    expect(setCookieText).toContain("next-auth.session-token=;");
    expect(setCookieText).toContain("Max-Age=0");
  });

  it("uses safe fallback callback when callbackUrl is invalid", async () => {
    const request = new NextRequest(
      "http://localhost:3000/auth/stale-session?callbackUrl=https%3A%2F%2Fevil.example",
    );

    const response = await handleStaleSession(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/sign-in?callbackUrl=%2Fdashboard");
  });
});
