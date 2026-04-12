import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildBaseSecurityHeaders, buildContentSecurityPolicy } from "@/lib/security/response-security";

function isHtmlRequest(request: NextRequest): boolean {
  const acceptHeader = request.headers.get("accept") ?? "";
  return acceptHeader.includes("text/html");
}

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

  if (isHtmlRequest(request)) {
    response.headers.set("Content-Security-Policy", buildContentSecurityPolicy({ nonce }));
  }

  return response;
}

export const config = {
  matcher: ["/:path*"],
};

