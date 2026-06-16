import { enqueueEmailAutomationEvent } from "@/lib/email/email-automation-outbox-service";
import { prisma } from "@/lib/db";
import { buildBookingTemplatePayload } from "@/lib/public-booking/email-template-payloads";

const BOOKING_CLASS_BOOKED_TEMPLATE_KEY = "booking.class-booked";

export function buildBookingConfirmationEmailIdempotencyKey(bookingId: string): string {
  return `booking-confirmation:${bookingId}:confirmed-v1`;
}

export async function enqueueBookingConfirmationEmail(input: {
  bookingId: string;
  recipientEmail: string;
}): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      customerName: true,
      client: {
        select: { name: true },
      },
      studioSession: {
        select: {
          title: true,
          startsAt: true,
          endsAt: true,
          location: true,
          teacher: {
            select: { name: true },
          },
        },
      },
    },
  });
  if (!booking) {
    throw new Error("BOOKING_NOT_FOUND_FOR_EMAIL");
  }

  await enqueueEmailAutomationEvent({
    templateKey: BOOKING_CLASS_BOOKED_TEMPLATE_KEY,
    recipientEmail: input.recipientEmail,
    payloadJson: buildBookingTemplatePayload({
      bookingId: booking.id,
      clientName: booking.client?.name ?? booking.customerName ?? "",
      location: booking.studioSession.location,
      sessionEndsAt: booking.studioSession.endsAt,
      sessionStartsAt: booking.studioSession.startsAt,
      sessionTitle: booking.studioSession.title,
      teacherName: booking.studioSession.teacher?.name ?? null,
    }),
    idempotencyKey: buildBookingConfirmationEmailIdempotencyKey(input.bookingId),
  });
}
