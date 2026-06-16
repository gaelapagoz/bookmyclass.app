import { resolveAppUrl } from "@/lib/config/app-url";
import { getStudioTimeLabel } from "@/lib/public-catalogue/timezone";
import { formatSessionDateTime } from "@/lib/public-booking/format-session-date-time";

type SessionEmailPayloadInput = {
  clientName: string;
  location: string | null;
  sessionEndsAt: Date;
  sessionStartsAt: Date;
  sessionTitle: string;
};

export type BookingTemplatePayloadInput = SessionEmailPayloadInput & {
  bookingId: string;
  teacherName: string | null;
};

export type WaitlistTemplatePayloadInput = SessionEmailPayloadInput & {
  deliveryContext: string;
  position: number | null;
  waitlistEntryId: string;
  bookingId?: string;
};

function normalizeLabel(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function resolveDashboardBookingsUrl(): string {
  try {
    return `${resolveAppUrl()}/dashboard/bookings`;
  } catch {
    return "";
  }
}

export function buildBookingTemplatePayload(input: BookingTemplatePayloadInput) {
  const manageUrl = resolveDashboardBookingsUrl();
  const dateTimeLabel = formatSessionDateTime({
    startsAt: input.sessionStartsAt,
    endsAt: input.sessionEndsAt,
  });

  return {
    bookingId: input.bookingId,
    clientName: normalizeLabel(input.clientName, ""),
    sessionTitle: normalizeLabel(input.sessionTitle, ""),
    dateTimeLabel,
    locationLabel: normalizeLabel(input.location, "To be confirmed"),
    "booking.classTitle": normalizeLabel(input.sessionTitle, ""),
    "booking.startAt": dateTimeLabel,
    "booking.endAt": getStudioTimeLabel(input.sessionEndsAt),
    "booking.teacherName": normalizeLabel(input.teacherName, "To be confirmed"),
    "booking.location": normalizeLabel(input.location, "To be confirmed"),
    "booking.manageUrl": manageUrl,
    "booking.cancelUrl": manageUrl,
  };
}

export function buildWaitlistTemplatePayload(input: WaitlistTemplatePayloadInput) {
  const dateTimeLabel = formatSessionDateTime({
    startsAt: input.sessionStartsAt,
    endsAt: input.sessionEndsAt,
  });

  return {
    clientName: normalizeLabel(input.clientName, ""),
    sessionTitle: normalizeLabel(input.sessionTitle, ""),
    dateTimeLabel,
    locationLabel: normalizeLabel(input.location, "To be confirmed"),
    waitlistEntryId: input.waitlistEntryId,
    ...(input.bookingId ? { bookingId: input.bookingId } : {}),
    deliveryContext: input.deliveryContext,
    "waitlist.classTitle": normalizeLabel(input.sessionTitle, ""),
    "waitlist.position": input.position === null ? "" : String(input.position),
    "waitlist.promotionExpiresAt": input.sessionStartsAt.toISOString(),
    "waitlist.manageUrl": resolveDashboardBookingsUrl(),
  };
}
