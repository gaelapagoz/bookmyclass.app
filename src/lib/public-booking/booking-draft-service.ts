import { BookingIntent, BookingStatus, StudioSessionStatus } from "@prisma/client";
import { prisma } from "../db";
import { STUDIO_TIMEZONE, getStudioDateKey, getStudioTimeLabel } from "../public-catalogue/timezone";

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
  date: string;
  endTime: string;
  serviceId: string;
  serviceSlug: string;
  serviceTitle: string;
  sessionId: string;
  startTime: string;
  timezone: string;
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
  startsAt: Date;
  status: StudioSessionStatus;
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
    serviceTitle: session.classType.name,
    date: getStudioDateKey(session.startsAt),
    startTime: getStudioTimeLabel(session.startsAt),
    endTime: getStudioTimeLabel(session.endsAt),
    capacity: session.capacity,
    availableSpots: getAvailableSpots(session),
    timezone: STUDIO_TIMEZONE,
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
  const session = await getSessionForDraft({
    serviceSlug: payload.serviceSlug,
    sessionId: payload.sessionId,
  });

  if (!session) {
    throw new BookingDraftError("INVALID_SESSION", "Selected session is invalid.");
  }

  assertSessionAvailable(session);

  if (!payload.consentPrivacyAccepted || !payload.consentTermsAccepted) {
    throw new BookingDraftError("CONSENT_REQUIRED", "Required consents must be accepted.");
  }

  const existingBooking = await prisma.booking.findFirst({
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

  const booking = await prisma.booking.create({
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

  return {
    bookingId: booking.id,
    status: booking.status,
    redirectTo: `/book-a-class/${payload.serviceSlug}/payment?bookingId=${booking.id}`,
  };
}
