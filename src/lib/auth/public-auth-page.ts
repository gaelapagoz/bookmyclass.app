import type { Session } from "next-auth";

import { getPostSignInRedirectUrl, getSafeCallbackPath } from "@/lib/auth/safe-callback-url";
import { getVerifiedCustomerState } from "@/lib/auth/verified-customer-state";

type ResolvePublicAuthPageRedirectOptions = {
  session: Session | null;
  callbackUrl?: string | null;
  fallbackCallbackUrl?: string;
};

export async function resolvePublicAuthPageRedirect({
  session,
  callbackUrl,
  fallbackCallbackUrl = "/dashboard",
}: ResolvePublicAuthPageRedirectOptions): Promise<string | null> {
  const safeCallbackUrl = getSafeCallbackPath(callbackUrl, fallbackCallbackUrl);
  const state = await getVerifiedCustomerState(session);

  switch (state.kind) {
    case "signed-out":
      return null;
    case "stale-session":
      return `/auth/stale-session?callbackUrl=${encodeURIComponent(safeCallbackUrl)}`;
    case "email-verification-required":
      return `/verify-email?blocked=1&email=${encodeURIComponent(state.email)}&callbackUrl=${encodeURIComponent(safeCallbackUrl)}`;
    case "verified":
      return state.session.user.role === "CLIENT"
        ? safeCallbackUrl
        : getPostSignInRedirectUrl(state.session.user.role);
    default:
      return null;
  }
}
