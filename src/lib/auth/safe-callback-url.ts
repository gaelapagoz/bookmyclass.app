import type { Role } from "@prisma/client";

const DEFAULT_AUTH_CALLBACK_PATH = "/dashboard";
const LOCALHOST_CALLBACK_PATTERN = /(?:https?:)?\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i;

function decodeCallbackCandidate(value: string): string {
  let current = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        return current;
      }
      current = decoded;
    } catch {
      return current;
    }
  }

  return current;
}

function containsLocalhostCallback(value: string): boolean {
  return LOCALHOST_CALLBACK_PATTERN.test(decodeCallbackCandidate(value));
}

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

  if (containsLocalhostCallback(candidate)) {
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
