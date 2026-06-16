import { enqueueEmailAutomationEvent } from "@/lib/email/email-automation-outbox-service";
import { ensureExpectedAutomationTemplateExists } from "@/lib/email/email-automation-admin-service";
import { prisma } from "@/lib/db";
import { WaitlistStatus } from "@prisma/client";
import { bookingDraftActiveBookingFilter } from "@/lib/public-booking/booking-draft-service";
import { buildWaitlistTemplatePayload } from "@/lib/public-booking/email-template-payloads";
import { type WaitlistPromotionNotification } from "@/lib/public-booking/waitlist-service";

const WAITLIST_ON_LIST_TEMPLATE_KEY = "waitlist.on-list";
const WAITLIST_PROMOTION_TEMPLATE_KEY = "waitlist.promoted";
const WAITLIST_NOT_PROMOTED_TEMPLATE_KEY = "waitlist.not-promoted";

type WaitlistJoinNotification = {
  clientEmail: string;
  clientName: string;
  location: string | null;
  position: number;
  sessionEndsAt: Date;
  sessionStartsAt: Date;
  sessionTitle: string;
  waitlistEntryId: string;
};

function buildWaitlistPromotionEmailIdempotencyKey(input: {
  bookingId: string;
  waitlistEntryId: string;
}): string {
  return `waitlist-promotion:${input.waitlistEntryId}:${input.bookingId}`;
}

function buildWaitlistOnListEmailIdempotencyKey(waitlistEntryId: string): string {
  return `waitlist-on-list:${waitlistEntryId}:joined-v1`;
}

function buildWaitlistNotPromotedEmailIdempotencyKey(waitlistEntryId: string): string {
  return `waitlist-not-promoted:${waitlistEntryId}:session-start-v1`;
}

export async function enqueueWaitlistJoinNotification(
  waitlistEntry: WaitlistJoinNotification,
): Promise<void> {
  await ensureExpectedAutomationTemplateExists(WAITLIST_ON_LIST_TEMPLATE_KEY);

  await enqueueEmailAutomationEvent({
    templateKey: WAITLIST_ON_LIST_TEMPLATE_KEY,
    recipientEmail: waitlistEntry.clientEmail,
    payloadJson: buildWaitlistTemplatePayload({
      clientName: waitlistEntry.clientName,
      deliveryContext: `waitlist-on-list:${waitlistEntry.waitlistEntryId}`,
      location: waitlistEntry.location,
      position: waitlistEntry.position,
      sessionEndsAt: waitlistEntry.sessionEndsAt,
      sessionStartsAt: waitlistEntry.sessionStartsAt,
      sessionTitle: waitlistEntry.sessionTitle,
      waitlistEntryId: waitlistEntry.waitlistEntryId,
    }),
    idempotencyKey: buildWaitlistOnListEmailIdempotencyKey(waitlistEntry.waitlistEntryId),
  });
}

export async function enqueueWaitlistPromotionNotification(
  promotion: WaitlistPromotionNotification,
): Promise<void> {
  await ensureExpectedAutomationTemplateExists(WAITLIST_PROMOTION_TEMPLATE_KEY);

  await enqueueEmailAutomationEvent({
    templateKey: WAITLIST_PROMOTION_TEMPLATE_KEY,
    recipientEmail: promotion.clientEmail,
    payloadJson: buildWaitlistTemplatePayload({
      clientName: promotion.clientName,
      deliveryContext: `waitlist-promotion:${promotion.waitlistEntryId}:${promotion.bookingId}`,
      location: promotion.location,
      position: null,
      sessionEndsAt: promotion.sessionEndsAt,
      sessionStartsAt: promotion.sessionStartsAt,
      sessionTitle: promotion.sessionTitle,
      waitlistEntryId: promotion.waitlistEntryId,
      bookingId: promotion.bookingId,
    }),
    idempotencyKey: buildWaitlistPromotionEmailIdempotencyKey({
      bookingId: promotion.bookingId,
      waitlistEntryId: promotion.waitlistEntryId,
    }),
  });
}

export async function enqueueWaitlistNotPromotedNotifications(input?: {
  now?: Date;
  limit?: number;
}): Promise<{ scanned: number; enqueued: number; failed: number }> {
  await ensureExpectedAutomationTemplateExists(WAITLIST_NOT_PROMOTED_TEMPLATE_KEY);

  const now = input?.now ?? new Date();
  const limit = Math.max(1, Math.min(input?.limit ?? 100, 500));
  const candidates = await prisma.waitlistEntry.findMany({
    where: {
      status: WaitlistStatus.ACTIVE,
      studioSession: {
        startsAt: { lte: now },
      },
    },
    orderBy: [{ studioSession: { startsAt: "asc" } }, { joinedAt: "asc" }],
    take: limit,
    select: {
      clientId: true,
      id: true,
      position: true,
      studioSessionId: true,
      client: {
        select: {
          email: true,
          name: true,
        },
      },
      studioSession: {
        select: {
          title: true,
          startsAt: true,
          endsAt: true,
          location: true,
        },
      },
    },
  });

  let enqueued = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const hasActiveBooking = await prisma.booking.findFirst({
        where: {
          clientId: candidate.clientId,
          studioSessionId: candidate.studioSessionId,
          ...bookingDraftActiveBookingFilter(now),
        },
        select: {
          id: true,
        },
      });
      if (hasActiveBooking) {
        continue;
      }

      await enqueueEmailAutomationEvent({
        templateKey: WAITLIST_NOT_PROMOTED_TEMPLATE_KEY,
        recipientEmail: candidate.client.email,
        payloadJson: buildWaitlistTemplatePayload({
          clientName: candidate.client.name,
          deliveryContext: `waitlist-not-promoted:${candidate.id}`,
          location: candidate.studioSession.location,
          position: candidate.position,
          sessionEndsAt: candidate.studioSession.endsAt,
          sessionStartsAt: candidate.studioSession.startsAt,
          sessionTitle: candidate.studioSession.title,
          waitlistEntryId: candidate.id,
        }),
        idempotencyKey: buildWaitlistNotPromotedEmailIdempotencyKey(candidate.id),
      });
      enqueued += 1;
    } catch (error) {
      failed += 1;
      console.error("[waitlist-notification-service] not-promoted email enqueue failed", {
        alertCode: "WAITLIST_NOT_PROMOTED_EMAIL_ENQUEUE_FAILED",
        error: error instanceof Error ? error.message : String(error),
        waitlistEntryId: candidate.id,
      });
    }
  }

  return {
    scanned: candidates.length,
    enqueued,
    failed,
  };
}
