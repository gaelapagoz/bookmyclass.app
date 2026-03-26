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

