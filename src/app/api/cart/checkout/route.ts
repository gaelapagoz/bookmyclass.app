import * as Sentry from "@sentry/nextjs";
import { createHash } from "node:crypto";
import { UserActivationStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import {
  CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX,
  CART_CHECKOUT_MAX_WALLET_AMOUNT_MINOR,
} from "@/lib/cart/cart-contract";
import { computeCartHash } from "@/lib/cart/cart-hash";
import { prisma } from "@/lib/db";
import { createCheckoutSessionForCart } from "@/lib/public-booking/checkout-service";
import { rejectIfNotSameOrigin } from "@/lib/security/same-origin";
import { resolveDeterministicFailureWithIdempotency } from "@/lib/cart/cart-checkout-service";
import { checkAndRecordDbRateLimit } from "@/lib/security/db-rate-limit";

const CART_CHECKOUT_RATE_LIMIT = {
  maxAttempts: 10,
  windowMs: 60 * 1000,
} as const;

const checkoutPayloadSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        priceId: z.string().min(1),
        quantity: z.number().int().min(1),
      }),
    ),
  clientCartVersion: z.string().min(1),
  walletAmountMinor: z.number().int().min(0).max(CART_CHECKOUT_MAX_WALLET_AMOUNT_MINOR).optional(),
  couponCode: z.string().trim().min(1).max(64).optional(),
});
const CART_CHECKOUT_DEBUG = process.env.CART_CHECKOUT_DEBUG === "1";

function debugLog(event: string, payload: Record<string, unknown>) {
  if (!CART_CHECKOUT_DEBUG) {
    return;
  }
  try {
    console.info(`[cart-checkout-debug] route_${event} ${JSON.stringify(payload)}`);
  } catch {
    console.info(`[cart-checkout-debug] route_${event}`, payload);
  }
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, canonicalizeJson(child)] as const);
    return Object.fromEntries(entries);
  }

  return value;
}

function buildDeterministicFailureCartHash(input: {
  rawBody: string;
  parsedPayload: unknown;
}): string {
  const parsed = checkoutPayloadSchema.safeParse(input.parsedPayload);
  if (parsed.success) {
    const walletSuffix =
      (parsed.data.walletAmountMinor ?? 0) > 0
        ? `|walletAmountMinor=${parsed.data.walletAmountMinor}`
        : "";
    const couponSuffix = parsed.data.couponCode
      ? `|couponCode=${parsed.data.couponCode.trim().toUpperCase()}`
      : "";
    return `AUTH_FAILURE_V1|cartHash=${computeCartHash(parsed.data.lines)}|clientCartVersion=${parsed.data.clientCartVersion}${walletSuffix}${couponSuffix}`;
  }

  return `AUTH_FAILURE_V1|rawBodySha256=${sha256Hex(input.rawBody)}`;
}

function buildInvalidJsonCartHash(rawBody: string): string {
  return `INVALID_JSON_V1|rawBodySha256=${sha256Hex(rawBody)}`;
}

function buildInvalidRequestCartHash(input: {
  parsedPayload: unknown;
  rawBody: string;
}): string {
  const canonical = canonicalizeJson(input.parsedPayload);
  const canonicalJson = JSON.stringify(canonical);
  if (canonicalJson === undefined) {
    return `INVALID_REQUEST_V1|rawBodySha256=${sha256Hex(input.rawBody)}`;
  }

  return `INVALID_REQUEST_V1|canonicalPayloadSha256=${sha256Hex(canonicalJson)}`;
}

export async function POST(request: Request) {
  const routeIdempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  debugLog("attempt_start", {
    idempotencyKey: routeIdempotencyKey || null,
    method: request.method,
    path: "/api/cart/checkout",
  });

  const csrfRejection = rejectIfNotSameOrigin(request);
  if (csrfRejection) {
    debugLog("csrf_rejected", {
      idempotencyKey: routeIdempotencyKey || null,
      status: 403,
    });
    return csrfRejection;
  }

  const idempotencyKey = routeIdempotencyKey;
  if (!CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) {
    debugLog("invalid_idempotency_key", {
      idempotencyKey: idempotencyKey || null,
      status: 400,
      code: "INVALID_REQUEST",
    });
    return Response.json(
      {
        code: "INVALID_REQUEST",
        message: "Missing or invalid Idempotency-Key header.",
      },
      { status: 400 },
    );
  }

  const rawBodyForDeterministicHash = await request.clone().text();
  let parsedPayloadFromClone: unknown = null;
  try {
    parsedPayloadFromClone = JSON.parse(rawBodyForDeterministicHash);
  } catch {
    parsedPayloadFromClone = null;
  }
  const deterministicFailureCartHash = buildDeterministicFailureCartHash({
    rawBody: rawBodyForDeterministicHash,
    parsedPayload: parsedPayloadFromClone,
  });

  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    const response = await resolveDeterministicFailureWithIdempotency({
      userId: "__UNAUTHENTICATED__",
      idempotencyKey,
      cartHash: deterministicFailureCartHash,
      status: 401,
      code: "AUTH_REQUIRED",
      message: "Authentication required.",
    });
    debugLog("auth_required", {
      idempotencyKey,
      deterministicFailureCartHash,
      status: response.status,
      code: (response.body as Record<string, unknown>).code ?? null,
      idempotencyState: (response.body as Record<string, unknown>).idempotency
        ? ((response.body as Record<string, unknown>).idempotency as Record<string, unknown>).state
        : null,
    });
    return Response.json(response.body, { status: response.status });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      activationStatus: true,
      emailVerified: true,
    },
  });

  if (!user || user.role !== "CLIENT" || user.activationStatus !== UserActivationStatus.ACTIVE || !user.emailVerified) {
    const response = await resolveDeterministicFailureWithIdempotency({
      userId,
      idempotencyKey,
      cartHash: deterministicFailureCartHash,
      status: 403,
      code: "EMAIL_VERIFICATION_REQUIRED",
      message: "Your account must be active and email-verified before checkout.",
    });
    debugLog("email_verification_required", {
      userId,
      idempotencyKey,
      deterministicFailureCartHash,
      status: response.status,
      code: (response.body as Record<string, unknown>).code ?? null,
      idempotencyState: (response.body as Record<string, unknown>).idempotency
        ? ((response.body as Record<string, unknown>).idempotency as Record<string, unknown>).state
        : null,
    });
    return Response.json(response.body, { status: response.status });
  }

  const rateLimitResult = await checkAndRecordDbRateLimit("cart_checkout", userId, CART_CHECKOUT_RATE_LIMIT);
  if (!rateLimitResult.allowed) {
    return Response.json(
      { code: "RATE_LIMIT_EXCEEDED", message: "Too many checkout attempts. Please wait." },
      { status: 429 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    Sentry.captureException(error);
    const response = await resolveDeterministicFailureWithIdempotency({
      userId,
      idempotencyKey,
      cartHash: buildInvalidJsonCartHash(rawBodyForDeterministicHash),
      status: 400,
      code: "INVALID_REQUEST",
      message: "Invalid JSON payload.",
    });
    debugLog("invalid_json", {
      userId,
      idempotencyKey,
      status: response.status,
      code: (response.body as Record<string, unknown>).code ?? null,
      cartHash: buildInvalidJsonCartHash(rawBodyForDeterministicHash),
    });
    return Response.json(response.body, { status: response.status });
  }

  const parsed = checkoutPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const response = await resolveDeterministicFailureWithIdempotency({
      userId,
      idempotencyKey,
      cartHash: buildInvalidRequestCartHash({
        parsedPayload: payload,
        rawBody: rawBodyForDeterministicHash,
      }),
      status: 400,
      code: "INVALID_REQUEST",
      message: "Invalid checkout payload.",
    });
    debugLog("invalid_payload", {
      userId,
      idempotencyKey,
      status: response.status,
      code: (response.body as Record<string, unknown>).code ?? null,
    });
    return Response.json(response.body, { status: response.status });
  }

  try {
    const result = await createCheckoutSessionForCart({
      userId,
      idempotencyKey,
      lines: parsed.data.lines,
      clientCartVersion: parsed.data.clientCartVersion,
      walletAmountMinor: parsed.data.walletAmountMinor,
      couponCode: parsed.data.couponCode,
    });
    debugLog("checkout_result", {
      userId,
      idempotencyKey,
      status: result.status,
      code: (result.body as Record<string, unknown>).code ?? (result.body as Record<string, unknown>).status ?? null,
      idempotencyState: (result.body as Record<string, unknown>).idempotency
        ? ((result.body as Record<string, unknown>).idempotency as Record<string, unknown>).state
        : null,
    });

    return Response.json(result.body, { status: result.status });
  } catch (error) {
    Sentry.captureException(error);
    if (process.env.NODE_ENV !== "production") {
      console.error("[api/cart/checkout] unexpected error", error);
    }
    debugLog("unexpected_error", {
      userId,
      idempotencyKey,
      status: 500,
      code: "CHECKOUT_CREATE_FAILED",
      errorMessage: error instanceof Error ? error.message : "unknown",
    });

    return Response.json(
      {
        code: "CHECKOUT_CREATE_FAILED",
        message: "Could not start checkout.",
      },
      { status: 500 },
    );
  }
}
