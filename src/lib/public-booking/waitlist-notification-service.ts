import { enqueueEmailAutomationEvent } from "@/lib/email/email-automation-outbox-service";
import { ensureExpectedAutomationTemplateExists } from "@/lib/email/email-automation-admin-service";
import { formatSessionDateTime } from "@/lib/public-booking/format-session-date-time";
import { type WaitlistPromotionNotification } from "@/lib/public-booking/waitlist-service";

const WAITLIST_PROMOTION_TEMPLATE_KEY = "waitlist.promoted";

function buildWaitlistPromotionEmailIdempotencyKey(input: {
  bookingId: string;
  waitlistEntryId: string;
}): string {
  return `waitlist-promotion:${input.waitlistEntryId}:${input.bookingId}`;
}

export async function enqueueWaitlistPromotionNotification(
  promotion: WaitlistPromotionNotification,
): Promise<void> {
  await ensureExpectedAutomationTemplateExists(WAITLIST_PROMOTION_TEMPLATE_KEY);

  const dateTimeLabel = formatSessionDateTime({
    startsAt: promotion.sessionStartsAt,
    endsAt: promotion.sessionEndsAt,
  });

  await enqueueEmailAutomationEvent({
    templateKey: WAITLIST_PROMOTION_TEMPLATE_KEY,
    recipientEmail: promotion.clientEmail,
    payloadJson: {
      clientName: promotion.clientName,
      sessionTitle: promotion.sessionTitle,
      dateTimeLabel,
      locationLabel: promotion.location?.trim() || "To be confirmed",
      bookingId: promotion.bookingId,
      waitlistEntryId: promotion.waitlistEntryId,
    },
    idempotencyKey: buildWaitlistPromotionEmailIdempotencyKey({
      bookingId: promotion.bookingId,
      waitlistEntryId: promotion.waitlistEntryId,
    }),
  });
}
