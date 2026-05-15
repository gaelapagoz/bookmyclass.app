import { headers as nextHeaders } from "next/headers";

const HTTPS_PROTOCOL = "https";
const HTTP_PROTOCOL = "http";

export type SameOriginValidationResult = {
  ok: boolean;
  reason: string;
  providedOrigin: string | null;
  allowedOrigins: string[];
};

export type SameOriginValidationInput = {
  originHeader: string | null;
  refererHeader: string | null;
  forwardedHostHeader: string | null;
  hostHeader: string | null;
  forwardedProtoHeader: string | null;
  appUrl: string | null;
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

function resolveRequestOrigin(input: SameOriginValidationInput): string | null {
  const host = resolveForwardedValue(input.forwardedHostHeader) ?? resolveForwardedValue(input.hostHeader);
  if (!host) {
    return null;
  }

  const protocol = resolveForwardedValue(input.forwardedProtoHeader) ?? HTTP_PROTOCOL;
  const normalizedProtocol = protocol.toLowerCase() === HTTP_PROTOCOL ? HTTP_PROTOCOL : HTTPS_PROTOCOL;
  return normalizeOrigin(`${normalizedProtocol}://${host}`);
}

function resolveProvidedOrigin(input: SameOriginValidationInput): string | null {
  const origin = normalizeOrigin(input.originHeader);
  if (origin) {
    return origin;
  }

  const referer = input.refererHeader;
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin.toLowerCase();
  } catch {
    return null;
  }
}

function resolveAllowedOrigins(input: SameOriginValidationInput): string[] {
  const origins = new Set<string>();

  const requestOrigin = resolveRequestOrigin(input);
  if (requestOrigin) {
    origins.add(requestOrigin);
    const requestUrl = new URL(requestOrigin);
    const alternateProtocol = requestUrl.protocol === "http:" ? "https:" : "http:";
    origins.add(`${alternateProtocol}//${requestUrl.host}`.toLowerCase());
  }

  const appUrlOrigin = normalizeOrigin(input.appUrl);
  if (appUrlOrigin) {
    origins.add(appUrlOrigin);
  }

  return [...origins];
}

export function validateSameOrigin(input: SameOriginValidationInput): SameOriginValidationResult {
  const allowedOrigins = resolveAllowedOrigins(input);
  const providedOrigin = resolveProvidedOrigin(input);

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

export function buildSameOriginValidationInputFromHeaders(
  headers: Pick<Headers, "get">,
  appUrl: string | null = process.env.APP_URL ?? null,
): SameOriginValidationInput {
  return {
    originHeader: headers.get("origin"),
    refererHeader: headers.get("referer"),
    forwardedHostHeader: headers.get("x-forwarded-host"),
    hostHeader: headers.get("host"),
    forwardedProtoHeader: headers.get("x-forwarded-proto"),
    appUrl,
  };
}

export function validateSameOriginFromHeaders(
  headers: Pick<Headers, "get">,
  appUrl: string | null = process.env.APP_URL ?? null,
): SameOriginValidationResult {
  return validateSameOrigin(buildSameOriginValidationInputFromHeaders(headers, appUrl));
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
