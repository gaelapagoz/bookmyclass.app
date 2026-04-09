import { BookingIntent, BookingStatus, Prisma, StudioSessionStatus } from "@prisma/client";
import { prisma } from "../db";
import { createBookingNoteMessage } from "../client-messages/client-message-service";
import { getPublicTeacherName } from "../public-content/teacher-display";
import { formatSessionDateTime } from "./format-session-date-time";

const BOOKING_DRAFT_HOLD_WINDOW_MINUTES = (() => {
  const raw = process.env.BOOKING_DRAFT_HOLD_WINDOW_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : 15;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 15;
})();

function getBookingDraftExpirationCutoff(now = new Date()) {
  return new Date(now.getTime() - BOOKING_DRAFT_HOLD_WINDOW_MINUTES * 60_000);
}

export function bookingDraftActiveBookingFilter(now = new Date()): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: BookingStatus.CONFIRMED },
      {
        status: BookingStatus.PENDING,
        createdAt: {
          gt: getBookingDraftExpirationCutoff(now),
        },
      },
    ],
  };
}

export type BookingDraftPayload = {
  bookingIntent: BookingIntent;
  consentPrivacyAccepted: boolean;
  consentTermsAccepted: boolean;
  customerEmail: string;
  customerMessage?: string;
  customerName: string;
  customerPhone: string;
  serviceSlug: string;
  sessionId: string;
};

export type BookingSessionSummary = {
  availableSpots: number;
  capacity: number;
  classTitle: string;
  dateTime: string;
  place: string;
  serviceId: string;
  serviceSlug: string;
  sessionId: string;
  teacher: string;
};

type BookingDraftCreationResult = {
  bookingId: string;
  created: boolean;
  redirectTo: string;
  status: BookingStatus;
};

type DraftErrorCode =
  | "AUTH_REQUIRED"
  | "CONSENT_REQUIRED"
  | "DUPLICATE_BOOKING"
  | "FULL_SESSION"
  | "BOOKING_CONTENTION"
  | "INVALID_SESSION"
  | "PAST_SESSION"
  | "UNAVAILABLE_SESSION";

export class BookingDraftError extends Error {
  constructor(
    public readonly code: DraftErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type SessionWithBookings = {
  bookings: Array<{ id: string }>;
  capacity: number;
  classType: { id: string; name: string; slug: string };
  endsAt: Date;
  id: string;
  isPublished: boolean;
  location: string | null;
  startsAt: Date;
  status: StudioSessionStatus;
  teacher: {
    firstName: string | null;
    lastName: string | null;
    name: string;
  };
};

type ExistingActiveBooking = {
  id: string;
  status: BookingStatus;
};

async function getSessionForDraft(params: { serviceSlug: string; sessionId: string }) {
  const { serviceSlug, sessionId } = params;

  return prisma.studioSession.findFirst({
    where: {
      id: sessionId,
      classType: {
        slug: serviceSlug,
      },
    },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      status: true,
      isPublished: true,
      classType: {
        select: {
          id: true,
          slug: true,
          name: true,
        },
      },
      teacher: {
        select: {
          firstName: true,
          lastName: true,
          name: true,
        },
      },
      location: true,
      bookings: {
        where: bookingDraftActiveBookingFilter(),
        select: {
          id: true,
        },
      },
    },
  });
}

function getAvailableSpots(session: SessionWithBookings): number {
  return Math.max(0, session.capacity - session.bookings.length);
}

function toSessionSummary(session: SessionWithBookings): BookingSessionSummary {
  return {
    sessionId: session.id,
    serviceId: session.classType.id,
    serviceSlug: session.classType.slug,
    classTitle: session.classType.name,
    dateTime: formatSessionDateTime({
      startsAt: session.startsAt,
      endsAt: session.endsAt,
    }),
    teacher: getPublicTeacherName(session.teacher),
    place: session.location?.trim() || "To be confirmed",
    capacity: session.capacity,
    availableSpots: getAvailableSpots(session),
  };
}

function toDraftCreationResult(input: {
  bookingId: string;
  created: boolean;
  serviceSlug: string;
  status: BookingStatus;
}): BookingDraftCreationResult {
  return {
    bookingId: input.bookingId,
    created: input.created,
    status: input.status,
    redirectTo: `/book-a-class/${input.serviceSlug}/payment?bookingId=${input.bookingId}`,
  };
}

function assertSessionAvailable(session: SessionWithBookings) {
  if (session.status !== StudioSessionStatus.SCHEDULED || !session.isPublished) {
    throw new BookingDraftError("UNAVAILABLE_SESSION", "This session is not available for booking.");
  }

  if (session.startsAt <= new Date()) {
    throw new BookingDraftError("PAST_SESSION", "Only future sessions can be booked.");
  }

  if (getAvailableSpots(session) < 1) {
    throw new BookingDraftError("FULL_SESSION", "This session is full.");
  }
}

function getP2034RetryDelay(attempt: number): number {
  const baseDelayMs = 20 * 2 ** attempt;
  const jitterMs = Math.floor(Math.random() * 20);
  return Math.min(200, baseDelayMs + jitterMs);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object" || !("message" in error)) {
    return "";
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function getErrorMeta(error: unknown): unknown {
  if (!error || typeof error !== "object" || !("meta" in error)) {
    return null;
  }

  return (error as { meta?: unknown }).meta ?? null;
}

function getErrorCause(error: unknown): unknown {
  if (!error || typeof error !== "object" || !("cause" in error)) {
    return null;
  }

  return (error as { cause?: unknown }).cause ?? null;
}

function collectPotentialSqlStateValues(value: unknown, depth = 0): string[] {
  if (depth > 3 || value == null) {
    return [];
  }

  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPotentialSqlStateValues(entry, depth + 1));
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.includes("code") || normalizedKey.includes("sqlstate") || normalizedKey.includes("state")) {
        return [String(entry)];
      }

      return collectPotentialSqlStateValues(entry, depth + 1);
    });
  }

  return [];
}

function isRetryableSerializationError(error: unknown, depth = 0): boolean {
  if (depth > 2 || !error) {
    return false;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return true;
  }

  const code = getErrorCode(error);
  if (code === "40001") {
    return true;
  }

  const metaValues = collectPotentialSqlStateValues(getErrorMeta(error));
  if (metaValues.includes("40001")) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  if (
    message.includes("could not serialize access") ||
    message.includes("write conflict") ||
    message.includes("deadlock") ||
    message.includes("transaction might succeed if retried")
  ) {
    return true;
  }

  return isRetryableSerializationError(getErrorCause(error), depth + 1);
}

async function findExistingActiveBooking(params: {
  clientId: string;
  now: Date;
  sessionId: string;
}): Promise<ExistingActiveBooking | null> {
  return prisma.booking.findFirst({
    where: {
      clientId: params.clientId,
      studioSessionId: params.sessionId,
      ...bookingDraftActiveBookingFilter(params.now),
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      status: true,
    },
  });
}

export async function getBookingSessionSummary(params: {
  serviceSlug: string;
  sessionId: string;
}): Promise<BookingSessionSummary | null> {
  const session = await getSessionForDraft(params);

  if (!session) {
    return null;
  }

  try {
    assertSessionAvailable(session);
  } catch {
    return null;
  }

  return toSessionSummary(session);
}

export async function createPendingBookingDraft(params: {
  authenticatedUserId: string;
  payload: BookingDraftPayload;
}): Promise<BookingDraftCreationResult> {
  const { authenticatedUserId, payload } = params;
  if (!payload.consentPrivacyAccepted || !payload.consentTermsAccepted) {
    throw new BookingDraftError("CONSENT_REQUIRED", "Required consents must be accepted.");
  }

  const MAX_TRANSACTION_RETRIES = 4;
  const now = new Date();
  const existingActiveBooking = await findExistingActiveBooking({
    clientId: authenticatedUserId,
    sessionId: payload.sessionId,
    now,
  });
  if (existingActiveBooking) {
    if (existingActiveBooking.status === BookingStatus.PENDING) {
      return toDraftCreationResult({
        bookingId: existingActiveBooking.id,
        created: false,
        status: existingActiveBooking.status,
        serviceSlug: payload.serviceSlug,
      });
    }

    throw new BookingDraftError(
      "DUPLICATE_BOOKING",
      "You already have an active booking draft or booking for this session.",
    );
  }

  await prisma.booking.updateMany({
    where: {
      studioSessionId: payload.sessionId,
      status: BookingStatus.PENDING,
      createdAt: {
        lt: getBookingDraftExpirationCutoff(now),
      },
    },
    data: {
      status: BookingStatus.CANCELLED,
      cancelledAt: now,
      cancellationReason: "Expired booking draft",
    },
  });

  let booking:
    | {
        id: string;
        status: BookingStatus;
      }
    | null = null;

  for (let attempt = 0; attempt <= MAX_TRANSACTION_RETRIES; attempt += 1) {
    try {
      booking = await prisma.$transaction(
        async (tx) => {
          const session = await tx.studioSession.findFirst({
            where: {
              id: payload.sessionId,
              classType: {
                slug: payload.serviceSlug,
              },
            },
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              capacity: true,
              status: true,
              isPublished: true,
              classType: {
                select: {
                  id: true,
                  slug: true,
                  name: true,
                },
              },
              teacher: {
                select: {
                  firstName: true,
                  lastName: true,
                  name: true,
                },
              },
              location: true,
              bookings: {
                where: bookingDraftActiveBookingFilter(now),
                select: {
                  id: true,
                },
              },
            },
          });

          if (!session) {
            throw new BookingDraftError("INVALID_SESSION", "Selected session is invalid.");
          }

          assertSessionAvailable(session);

          return tx.booking.create({
            data: {
              clientId: authenticatedUserId,
              studioSessionId: session.id,
              status: BookingStatus.PENDING,
              bookingIntent: payload.bookingIntent,
              customerName: payload.customerName,
              customerEmail: payload.customerEmail,
              customerPhone: payload.customerPhone,
              customerMessage: payload.customerMessage?.trim() || null,
              consentTermsAccepted: payload.consentTermsAccepted,
              consentPrivacyAccepted: payload.consentPrivacyAccepted,
              consentAcceptedAt: new Date(),
            },
            select: {
              id: true,
              status: true,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (error) {
      if (error instanceof BookingDraftError) {
        throw error;
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const duplicateActiveBooking = await findExistingActiveBooking({
          clientId: authenticatedUserId,
          sessionId: payload.sessionId,
          now,
        });
        if (duplicateActiveBooking?.status === BookingStatus.PENDING) {
          return toDraftCreationResult({
            bookingId: duplicateActiveBooking.id,
            created: false,
            status: duplicateActiveBooking.status,
            serviceSlug: payload.serviceSlug,
          });
        }

        throw new BookingDraftError(
          "DUPLICATE_BOOKING",
          "You already have an active booking draft or booking for this session.",
        );
      }

      if (isRetryableSerializationError(error)) {
        if (attempt < MAX_TRANSACTION_RETRIES) {
          await delay(getP2034RetryDelay(attempt));
          continue;
        }
        throw new BookingDraftError(
          "BOOKING_CONTENTION",
          "Booking creation temporarily failed due to concurrent activity. Please try again.",
        );
      }

      throw error;
    }
  }

  if (!booking) {
    throw new BookingDraftError(
      "BOOKING_CONTENTION",
      "Booking creation temporarily failed due to concurrent activity. Please try again.",
    );
  }

  const normalizedMessage = payload.customerMessage?.trim() ?? "";
  if (normalizedMessage) {
    await createBookingNoteMessage({
      bookingId: booking.id,
      userId: authenticatedUserId,
      name: payload.customerName,
      email: payload.customerEmail,
      phone: payload.customerPhone,
      message: normalizedMessage,
    });
  }

  return toDraftCreationResult({
    bookingId: booking.id,
    created: true,
    status: booking.status,
    serviceSlug: payload.serviceSlug,
  });
}
