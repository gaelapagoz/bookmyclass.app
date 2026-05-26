import { enqueueEmailAutomationEvent } from "@/lib/email/email-automation-outbox-service";

const BOOKING_CLASS_BOOKED_TEMPLATE_KEY = "booking.class-booked";

export function buildBookingConfirmationEmailIdempotencyKey(bookingId: string): string {
  return `booking-confirmation:${bookingId}:confirmed-v1`;
}

export async function enqueueBookingConfirmationEmail(input: {
  bookingId: string;
  recipientEmail: string;
}): Promise<void> {
  await enqueueEmailAutomationEvent({
    templateKey: BOOKING_CLASS_BOOKED_TEMPLATE_KEY,
    recipientEmail: input.recipientEmail,
    payloadJson: {
      bookingId: input.bookingId,
    },
    idempotencyKey: buildBookingConfirmationEmailIdempotencyKey(input.bookingId),
  });
}
