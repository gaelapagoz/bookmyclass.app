import { BookingIntent, BookingStatus, Prisma, StudioSessionStatus } from "@prisma/client";
import { prisma } from "../db";
import { createBookingNoteMessage } from "../client-messages/client-message-service";
import { getPublicTeacherName } from "../public-content/teacher-display";
import { formatSessionDateTime } from "./format-session-date-time";

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

type DraftErrorCode =
  | "AUTH_REQUIRED"
  | "CONSENT_REQUIRED"
  | "DUPLICATE_BOOKING"
  | "FULL_SESSION"
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
        where: {
          status: {
            in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
          },
        },
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
}) {
  const { authenticatedUserId, payload } = params;
  if (!payload.consentPrivacyAccepted || !payload.consentTermsAccepted) {
    throw new BookingDraftError("CONSENT_REQUIRED", "Required consents must be accepted.");
  }

  const MAX_TRANSACTION_RETRIES = 2;
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
                where: {
                  status: {
                    in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
                  },
                },
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

          const existingBooking = await tx.booking.findFirst({
            where: {
              clientId: authenticatedUserId,
              studioSessionId: session.id,
              status: {
                in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
              },
            },
            select: { id: true },
          });

          if (existingBooking) {
            throw new BookingDraftError(
              "DUPLICATE_BOOKING",
              "You already have an active booking draft or booking for this session.",
            );
          }

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
        throw new BookingDraftError(
          "DUPLICATE_BOOKING",
          "You already have an active booking draft or booking for this session.",
        );
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        if (attempt < MAX_TRANSACTION_RETRIES) {
          continue;
        }
        throw new BookingDraftError("FULL_SESSION", "This session is full.");
      }

      throw error;
    }
  }

  if (!booking) {
    throw new BookingDraftError("FULL_SESSION", "This session is full.");
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

  return {
    bookingId: booking.id,
    status: booking.status,
    redirectTo: `/book-a-class/${payload.serviceSlug}/payment?bookingId=${booking.id}`,
  };
}
