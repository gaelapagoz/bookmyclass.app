import { headers as nextHeaders } from "next/headers";

const HTTPS_PROTOCOL = "https";

export type SameOriginValidationResult = {
  ok: boolean;
  reason: string;
  providedOrigin: string | null;
  allowedOrigins: string[];
};

function normalizeOrigin(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return null;
  }
}

function resolveForwardedValue(rawValue: string | null): string | null {
  const value = rawValue?.split(",")[0]?.trim();
  return value && value.length > 0 ? value : null;
}

function resolveRequestOrigin(headers: Headers): string | null {
  const host = resolveForwardedValue(headers.get("x-forwarded-host")) ?? resolveForwardedValue(headers.get("host"));
  if (!host) {
    return null;
  }

  const protocol = resolveForwardedValue(headers.get("x-forwarded-proto")) ?? HTTPS_PROTOCOL;
  const normalizedProtocol = protocol.toLowerCase() === "http" ? "http" : HTTPS_PROTOCOL;
  return normalizeOrigin(`${normalizedProtocol}://${host}`);
}

function resolveProvidedOrigin(headers: Headers): string | null {
  const origin = normalizeOrigin(headers.get("origin"));
  if (origin) {
    return origin;
  }

  const referer = headers.get("referer");
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin.toLowerCase();
  } catch {
    return null;
  }
}

function resolveAllowedOrigins(headers: Headers): string[] {
  const origins = new Set<string>();

  const requestOrigin = resolveRequestOrigin(headers);
  if (requestOrigin) {
    origins.add(requestOrigin);
  }

  const appUrlOrigin = normalizeOrigin(process.env.APP_URL);
  if (appUrlOrigin) {
    origins.add(appUrlOrigin);
  }

  return [...origins];
}

export function validateSameOriginFromHeaders(headers: Headers): SameOriginValidationResult {
  const allowedOrigins = resolveAllowedOrigins(headers);
  const providedOrigin = resolveProvidedOrigin(headers);

  if (allowedOrigins.length < 1) {
    return {
      ok: false,
      reason: "No allowed same-origin values could be resolved from request headers or APP_URL.",
      providedOrigin,
      allowedOrigins,
    };
  }

  if (!providedOrigin) {
    return {
      ok: false,
      reason: "Missing both Origin and Referer headers on mutation request.",
      providedOrigin,
      allowedOrigins,
    };
  }

  if (!allowedOrigins.includes(providedOrigin)) {
    return {
      ok: false,
      reason: `Origin mismatch. Received '${providedOrigin}' but expected one of: ${allowedOrigins.join(", ")}`,
      providedOrigin,
      allowedOrigins,
    };
  }

  return {
    ok: true,
    reason: "Origin validated.",
    providedOrigin,
    allowedOrigins,
  };
}

export function rejectIfNotSameOrigin(request: Request): Response | null {
  const result = validateSameOriginFromHeaders(request.headers);
  if (result.ok) {
    return null;
  }

  return Response.json(
    {
      error: "Forbidden: same-origin validation failed.",
      code: "CSRF_ORIGIN_MISMATCH",
    },
    { status: 403 },
  );
}

export async function assertSameOriginServerAction(): Promise<void> {
  const headerStore = await nextHeaders();
  const result = validateSameOriginFromHeaders(headerStore);
  if (!result.ok) {
    throw new Error(`[csrf] ${result.reason}`);
  }
}
