import { BookingIntent } from "@prisma/client";
import { z } from "zod";
import { auth } from "../../../../auth";
import { BookingDraftError, createPendingBookingDraft } from "../../../../lib/public-booking/booking-draft-service";

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

function toStatusCode(code: BookingDraftError["code"]): number {
  switch (code) {
    case "INVALID_SESSION":
      return 404;
    case "PAST_SESSION":
    case "FULL_SESSION":
    case "UNAVAILABLE_SESSION":
    case "CONSENT_REQUIRED":
      return 400;
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

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
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

  let authenticatedUserId: string | null = null;
  try {
    const session = await auth();
    authenticatedUserId = session?.user?.id ?? null;
  } catch {
    authenticatedUserId = null;
  }

  try {
    const result = await createPendingBookingDraft({
      authenticatedUserId,
      payload: parsed.data,
    });

    return Response.json({ draft: result }, { status: 201 });
  } catch (error) {
    if (error instanceof BookingDraftError) {
      return Response.json({ error: error.message, code: error.code }, { status: toStatusCode(error.code) });
    }

    if (process.env.NODE_ENV !== "production") {
      console.error("[bookings/draft] unexpected error", error);
    }

    return toUnexpectedErrorResponse(error);
  }
}
