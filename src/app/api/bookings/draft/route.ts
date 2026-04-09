import { BookingIntent } from "@prisma/client";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { auth } from "../../../../auth";
import { BookingDraftError, createPendingBookingDraft } from "../../../../lib/public-booking/booking-draft-service";
import { createRateLimiter, getClientIpFromHeaders } from "../../../../lib/security/rate-limit";

const draftSchema = z.object({
  serviceSlug: z.string().min(1).max(120),
  sessionId: z.string().min(1).max(120),
  customerName: z.string().trim().min(1).max(120),
  customerEmail: z.string().trim().email().max(180),
  customerPhone: z.string().trim().min(4).max(40),
  customerMessage: z.string().trim().max(1000).optional(),
  bookingIntent: z.nativeEnum(BookingIntent),
  consentTermsAccepted: z.literal(true),
  consentPrivacyAccepted: z.literal(true),
});

function parsePositiveIntegerEnv(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${envName}='${raw}'. Expected a positive integer.`,
    );
  }

  return parsed;
}

export function resolveBookingDraftUserRateLimitConfig() {
  return {
    maxAttempts: parsePositiveIntegerEnv("BOOKING_DRAFT_USER_MAX_ATTEMPTS", 8),
    windowMs: parsePositiveIntegerEnv("BOOKING_DRAFT_USER_WINDOW_MS", 60 * 1000),
    blockDurationMs: parsePositiveIntegerEnv("BOOKING_DRAFT_USER_BLOCK_DURATION_MS", 5 * 60 * 1000),
  };
}

const bookingDraftUserRateLimiter = createRateLimiter({
  ...resolveBookingDraftUserRateLimitConfig(),
});

export function resolveBookingDraftIpRateLimitConfig() {
  return {
    maxAttempts: parsePositiveIntegerEnv("BOOKING_DRAFT_IP_MAX_ATTEMPTS", 20),
    windowMs: parsePositiveIntegerEnv("BOOKING_DRAFT_IP_WINDOW_MS", 60 * 1000),
    blockDurationMs: parsePositiveIntegerEnv("BOOKING_DRAFT_IP_BLOCK_DURATION_MS", 5 * 60 * 1000),
  };
}

const bookingDraftIpRateLimiter = createRateLimiter({
  ...resolveBookingDraftIpRateLimitConfig(),
});

function toStatusCode(code: BookingDraftError["code"]): number {
  switch (code) {
    case "AUTH_REQUIRED":
      return 401;
    case "INVALID_SESSION":
      return 404;
    case "PAST_SESSION":
    case "FULL_SESSION":
    case "UNAVAILABLE_SESSION":
    case "CONSENT_REQUIRED":
      return 400;
    case "BOOKING_CONTENTION":
      return 503;
    case "DUPLICATE_BOOKING":
      return 409;
    default:
      return 400;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function toUnexpectedErrorResponse(error: unknown) {
  const message = getErrorMessage(error);
  const prismaCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;

  if (prismaCode === "P2022") {
    return Response.json(
      {
        error:
          "Database schema is out of date for booking drafts. Run Prisma migrations on your local database and try again.",
        code: prismaCode,
        ...(process.env.NODE_ENV !== "production" ? { details: message } : {}),
      },
      { status: 500 },
    );
  }

  return Response.json(
    {
      error: "Unexpected error while creating booking draft.",
      ...(process.env.NODE_ENV !== "production" ? { details: message } : {}),
    },
    { status: 500 },
  );
}

function captureBookingRateLimitTriggered(input: { userId: string; ip: string }) {
  Sentry.withScope((scope) => {
    scope.setTag("event", "rate_limit_triggered");
    scope.setExtra("route", "/api/bookings/draft");
    scope.setExtra("userId", input.userId);
    scope.setExtra("ip", input.ip);
    Sentry.captureMessage("rate_limit_triggered");
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    Sentry.captureException(error);
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid draft booking payload.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const session = await auth();
  const authenticatedUserId = session?.user?.id ?? null;
  if (!authenticatedUserId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const ipAddress = getClientIpFromHeaders(request.headers);
  const userKey = `user:${authenticatedUserId}`;
  const ipKey = `ip:${ipAddress}`;

  const userLimit = bookingDraftUserRateLimiter.checkLimit(userKey);
  const ipLimit = bookingDraftIpRateLimiter.checkLimit(ipKey);

  if (!userLimit.allowed || !ipLimit.allowed) {
    captureBookingRateLimitTriggered({
      userId: authenticatedUserId,
      ip: ipAddress,
    });

    const retryAfter = Math.max(userLimit.retryAfter ?? 0, ipLimit.retryAfter ?? 0);

    return Response.json(
      {
        error: "Too many booking attempts. Please try again later.",
        retryAfter,
      },
      { status: 429 },
    );
  }

  bookingDraftUserRateLimiter.recordFailure(userKey);
  bookingDraftIpRateLimiter.recordFailure(ipKey);

  try {
    const result = await createPendingBookingDraft({
      authenticatedUserId,
      payload: parsed.data,
    });

    return Response.json({ draft: result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof BookingDraftError) {
      Sentry.captureException(error);
      return Response.json({ error: error.message, code: error.code }, { status: toStatusCode(error.code) });
    }

    Sentry.captureException(error);
    if (process.env.NODE_ENV !== "production") {
      console.error("[bookings/draft] unexpected error", error);
    }

    return toUnexpectedErrorResponse(error);
  }
}
