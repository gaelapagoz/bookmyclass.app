import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSafeCallbackPath } from "@/lib/auth/safe-callback-url";

const STALE_SESSION_COOKIE_NAMES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
  "__Secure-authjs.callback-url",
  "authjs.callback-url",
  "__Secure-next-auth.callback-url",
  "next-auth.callback-url",
  "__Host-authjs.csrf-token",
  "authjs.csrf-token",
  "__Host-next-auth.csrf-token",
  "next-auth.csrf-token",
  "__Secure-authjs.pkce.code_verifier",
  "authjs.pkce.code_verifier",
  "__Secure-next-auth.pkce.code_verifier",
  "next-auth.pkce.code_verifier",
  "__Secure-authjs.state",
  "authjs.state",
  "__Secure-next-auth.state",
  "next-auth.state",
] as const;

export async function GET(request: NextRequest) {
  const callbackPath = getSafeCallbackPath(request.nextUrl.searchParams.get("callbackUrl"));
  const destination = new URL(
    `/sign-in?callbackUrl=${encodeURIComponent(callbackPath)}`,
    request.url,
  );
  const response = NextResponse.redirect(destination);

  for (const cookieName of STALE_SESSION_COOKIE_NAMES) {
    response.cookies.set({
      name: cookieName,
      value: "",
      maxAge: 0,
      path: "/",
    });
  }

  return response;
}
