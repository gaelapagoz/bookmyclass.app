import { isDeterministicEmailDeliveryMode, sendEmailViaResend } from "@/lib/email/resend-delivery";
import { formatSessionDateTime } from "@/lib/public-booking/format-session-date-time";
import { type WaitlistPromotionNotification } from "@/lib/public-booking/waitlist-service";

function getEmailFromOrThrow() {
  const from = process.env.EMAIL_FROM?.trim()
    || (isDeterministicEmailDeliveryMode() ? "Book My Class Test <no-reply@test.local>" : "");
  if (!from) {
    throw new Error("Missing EMAIL_FROM.");
  }

  return from;
}

export async function sendWaitlistPromotionNotification(
  promotion: WaitlistPromotionNotification,
): Promise<void> {
  const from = getEmailFromOrThrow();
  const dateTimeLabel = formatSessionDateTime({
    startsAt: promotion.sessionStartsAt,
    endsAt: promotion.sessionEndsAt,
  });

  await sendEmailViaResend({
    context: "waitlist-promotion",
    from,
    to: promotion.clientEmail,
    subject: "You're in! Your class booking is now confirmed",
    html: `
      <p>Hello ${promotion.clientName},</p>
      <p>Good news. A spot opened up and we've automatically confirmed your booking from the waitlist.</p>
      <p><strong>Class:</strong> ${promotion.sessionTitle}</p>
      <p><strong>When:</strong> ${dateTimeLabel}</p>
      <p><strong>Location:</strong> ${promotion.location?.trim() || "To be confirmed"}</p>
      <p>You can review your booking from your dashboard.</p>
    `,
  });
}

