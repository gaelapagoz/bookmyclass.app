import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { headers as nextHeaders } from "next/headers";
import { getRequiredAuthSecret } from "@/lib/auth/auth-secret";

const CSRF_FIELD_NAME = "_csrf";
const CSRF_TOKEN_VERSION = "v2";
const CSRF_TOKEN_TTL_SECONDS = 60 * 60;

type CsrfValidationResult = {
  ok: boolean;
  reason: string;
};

function normalizeValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function normalizeOrigin(value: string | null | undefined): string | null {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).origin.toLowerCase();
  } catch {
    return null;
  }
}

function resolveForwardedValue(rawValue: string | null): string | null {
  return normalizeValue(rawValue?.split(",")[0]);
}

function resolveRequestOrigin(headers: Pick<Headers, "get">): string | null {
  const host = resolveForwardedValue(headers.get("x-forwarded-host")) ?? resolveForwardedValue(headers.get("host"));
  if (!host) {
    return normalizeOrigin(process.env.APP_URL);
  }

  const proto = resolveForwardedValue(headers.get("x-forwarded-proto"));
  const protocol = proto?.toLowerCase() === "http" ? "http" : "https";
  return normalizeOrigin(`${protocol}://${host}`);
}

function signTokenPayload(payload: string): string {
  return createHmac("sha256", getRequiredAuthSecret()).update(payload).digest("base64url");
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

type CsrfTokenPayload = {
  issuedAtSeconds: number;
  nonce: string;
};

function encodeTokenPayload(payload: CsrfTokenPayload): string {
  return Buffer.from(
    JSON.stringify({
      iat: payload.issuedAtSeconds,
      n: payload.nonce,
    }),
  ).toString("base64url");
}

function decodeTokenPayload(rawPayload: string): CsrfTokenPayload | null {
  try {
    const decoded = Buffer.from(rawPayload, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as { iat?: unknown; n?: unknown };
    const issuedAtSeconds = Number.parseInt(String(parsed.iat ?? ""), 10);
    const nonce = typeof parsed.n === "string" ? parsed.n : "";

    if (!Number.isFinite(issuedAtSeconds) || !nonce || nonce.length < 8) {
      return null;
    }

    return {
      issuedAtSeconds,
      nonce,
    };
  } catch {
    return null;
  }
}

function parseToken(rawToken: string): { payload: CsrfTokenPayload; payloadEncoded: string; signature: string } | null {
  const token = normalizeValue(rawToken);
  if (!token) {
    return null;
  }

  const tokenParts = token.split(".");
  if (tokenParts.length !== 3 || tokenParts[0] !== CSRF_TOKEN_VERSION) {
    return null;
  }

  const payloadEncoded = tokenParts[1] ?? "";
  const payload = decodeTokenPayload(payloadEncoded);
  if (!payload) {
    return null;
  }

  const signature = tokenParts[2] ?? "";
  if (!signature) {
    return null;
  }

  return {
    payload,
    payloadEncoded,
    signature,
  };
}

export function getCsrfFieldName(): string {
  return CSRF_FIELD_NAME;
}

export function createCsrfTokenFromHeaders(
  headers: Pick<Headers, "get">,
  issuedAt: Date = new Date(),
): string | null {
  const origin = resolveRequestOrigin(headers);
  if (!origin) {
    return null;
  }

  const payloadEncoded = encodeTokenPayload({
    issuedAtSeconds: Math.floor(issuedAt.getTime() / 1000),
    nonce: randomBytes(8).toString("base64url"),
  });
  const signaturePayload = `${CSRF_TOKEN_VERSION}.${payloadEncoded}.${origin}`;
  const signature = signTokenPayload(signaturePayload);

  return `${CSRF_TOKEN_VERSION}.${payloadEncoded}.${signature}`;
}

export async function createCsrfToken(): Promise<string | null> {
  if (process.env.NODE_ENV === "test") {
    return "test-csrf-token";
  }

  try {
    const headerStore = await nextHeaders();
    return createCsrfTokenFromHeaders(headerStore);
  } catch {
    return null;
  }
}

export function validateCsrfTokenFromHeadersAndFormData(
  headers: Pick<Headers, "get">,
  formData: FormData,
  now: Date = new Date(),
): CsrfValidationResult {
  if (process.env.NODE_ENV === "test") {
    return { ok: true, reason: "CSRF token validation skipped in test mode." };
  }

  const parsedToken = parseToken(String(formData.get(CSRF_FIELD_NAME) ?? ""));
  if (!parsedToken) {
    return {
      ok: false,
      reason: "Missing or malformed CSRF token.",
    };
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (parsedToken.payload.issuedAtSeconds > nowSeconds + 120) {
    return {
      ok: false,
      reason: "CSRF token has an invalid timestamp.",
    };
  }

  if (nowSeconds - parsedToken.payload.issuedAtSeconds > CSRF_TOKEN_TTL_SECONDS) {
    return {
      ok: false,
      reason: "CSRF token expired.",
    };
  }

  const allowedOrigins = new Set<string>();
  const requestOrigin = resolveRequestOrigin(headers);
  if (requestOrigin) {
    allowedOrigins.add(requestOrigin);
  }

  const appUrlOrigin = normalizeOrigin(process.env.APP_URL);
  if (appUrlOrigin) {
    allowedOrigins.add(appUrlOrigin);
  }

  if (allowedOrigins.size < 1) {
    return {
      ok: false,
      reason: "Could not resolve an allowed origin for CSRF validation.",
    };
  }

  for (const origin of allowedOrigins) {
    const signaturePayload = `${CSRF_TOKEN_VERSION}.${parsedToken.payloadEncoded}.${origin}`;
    const expectedSignature = signTokenPayload(signaturePayload);

    if (constantTimeEquals(parsedToken.signature, expectedSignature)) {
      return {
        ok: true,
        reason: "CSRF token validated.",
      };
    }
  }

  return {
    ok: false,
    reason: "CSRF token mismatch.",
  };
}

export async function assertValidCsrfToken(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  const headerStore = await nextHeaders();
  const result = validateCsrfTokenFromHeadersAndFormData(headerStore, formData);
  if (!result.ok) {
    throw new Error(`[csrf] ${result.reason}`);
  }
}
