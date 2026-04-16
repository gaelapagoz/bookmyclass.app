import type { Role } from "@prisma/client";

const DEFAULT_AUTH_CALLBACK_PATH = "/dashboard";

export function getSafeCallbackPath(
  rawValue: unknown,
  fallback: string = DEFAULT_AUTH_CALLBACK_PATH,
): string {
  if (typeof rawValue !== "string") {
    return fallback;
  }

  const candidate = rawValue.trim();
  if (!candidate.startsWith("/")) {
    return fallback;
  }

  if (candidate.startsWith("//")) {
    return fallback;
  }

  return candidate;
}

/**
 * Determine the post-signin redirect URL based on authenticated user role.
 * Ensures users land in their respective dashboards after login.
 */
export function getPostSignInRedirectUrl(role?: Role): string {
  if (!role) {
    return DEFAULT_AUTH_CALLBACK_PATH;
  }

  switch (role) {
    case "MASTER_ADMIN":
    case "ADMIN":
      return "/admin";
    case "TEACHER":
      return "/teacher";
    case "CLIENT":
    default:
      return DEFAULT_AUTH_CALLBACK_PATH;
  }
}

