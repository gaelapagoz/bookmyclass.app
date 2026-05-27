import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  buildBaseSecurityHeaders,
  buildContentSecurityPolicy,
  getCspHeaderName,
  resolveEffectiveCspMode,
  shouldAttachContentSecurityPolicy,
} from "@/lib/security/response-security";

function createNonce(): string {
  const random = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of random) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const nonce = createNonce();
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  for (const { key, value } of buildBaseSecurityHeaders({
    appUrl: process.env.APP_URL,
    forwardedProto: request.headers.get("x-forwarded-proto"),
    requestProtocol: request.nextUrl.protocol,
  })) {
    response.headers.set(key, value);
  }

  if (shouldAttachContentSecurityPolicy(request.nextUrl.pathname)) {
    const isUatHost = request.nextUrl.hostname.toLowerCase().includes("uat.");
    const allowReportOnlyInUat = process.env.ALLOW_CSP_REPORT_ONLY_IN_UAT === "1" && isUatHost;
    // Precedence: production => enforce, unless UAT override is explicitly enabled and mode=report-only.
    const cspMode = resolveEffectiveCspMode(process.env.CSP_HEADER_MODE, {
      isProduction: process.env.NODE_ENV === "production",
      allowReportOnlyInProduction: allowReportOnlyInUat,
    });
    response.headers.set(getCspHeaderName(cspMode), buildContentSecurityPolicy({ nonce }));
  }

  return response;
}

export const config = {
  matcher: ["/:path*"],
};
