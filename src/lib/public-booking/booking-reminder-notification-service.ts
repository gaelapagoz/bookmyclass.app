import { BookingStatus, StudioSessionStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ensureExpectedAutomationTemplateExists } from "@/lib/email/email-automation-admin-service";
import { enqueueEmailAutomationEvent } from "@/lib/email/email-automation-outbox-service";
import { buildBookingTemplatePayload } from "@/lib/public-booking/email-template-payloads";

const BOOKING_CLASS_REMINDER_TEMPLATE_KEY = "booking.class-reminder";
const BOOKING_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

export function buildBookingReminderEmailIdempotencyKey(input: {
  bookingId: string;
  sessionStartsAt: Date;
}): string {
  return `booking-reminder:${input.bookingId}:${input.sessionStartsAt.toISOString()}:24h-v1`;
}

async function deadLetterStaleQueuedBookingReminderEvents(input: {
  bookingId: string;
  currentIdempotencyKey: string;
  now: Date;
}): Promise<void> {
  await prisma.emailAutomationEvent.updateMany({
    where: {
      idempotencyKey: {
        startsWith: `booking-reminder:${input.bookingId}:`,
        not: input.currentIdempotencyKey,
      },
      status: {
        in: ["PENDING", "LEASED"],
      },
    },
    data: {
      status: "DEAD_LETTER",
      deadLetteredAt: input.now,
      lastError: "BOOKING_REMINDER_RESCHEDULED",
      leaseOwner: null,
      leasedAt: null,
      leaseExpiresAt: null,
    },
  });
}

export async function enqueueBookingReminderNotifications(input?: {
  now?: Date;
  limit?: number;
}): Promise<{ scanned: number; enqueued: number; failed: number }> {
  await ensureExpectedAutomationTemplateExists(BOOKING_CLASS_REMINDER_TEMPLATE_KEY);

  const now = input?.now ?? new Date();
  const limit = Math.max(1, Math.min(input?.limit ?? 100, 500));
  const reminderCutoff = new Date(now.getTime() + BOOKING_REMINDER_LEAD_MS);

  const candidates = await prisma.booking.findMany({
    where: {
      status: BookingStatus.CONFIRMED,
      studioSession: {
        status: StudioSessionStatus.SCHEDULED,
        isPublished: true,
        startsAt: {
          gt: now,
          lte: reminderCutoff,
        },
      },
    },
    orderBy: [{ studioSession: { startsAt: "asc" } }, { updatedAt: "asc" }],
    take: limit,
    select: {
      id: true,
      customerEmail: true,
      customerName: true,
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
          teacher: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  let enqueued = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const recipientEmail = candidate.client?.email ?? candidate.customerEmail;
    if (!recipientEmail) {
      continue;
    }

    const idempotencyKey = buildBookingReminderEmailIdempotencyKey({
      bookingId: candidate.id,
      sessionStartsAt: candidate.studioSession.startsAt,
    });

    try {
      await deadLetterStaleQueuedBookingReminderEvents({
        bookingId: candidate.id,
        currentIdempotencyKey: idempotencyKey,
        now,
      });

      await enqueueEmailAutomationEvent({
        templateKey: BOOKING_CLASS_REMINDER_TEMPLATE_KEY,
        recipientEmail,
        payloadJson: buildBookingTemplatePayload({
          bookingId: candidate.id,
          clientName: candidate.client?.name ?? candidate.customerName ?? "",
          location: candidate.studioSession.location,
          sessionEndsAt: candidate.studioSession.endsAt,
          sessionStartsAt: candidate.studioSession.startsAt,
          sessionTitle: candidate.studioSession.title,
          teacherName: candidate.studioSession.teacher?.name ?? null,
        }),
        idempotencyKey,
      });
      enqueued += 1;
    } catch (error) {
      failed += 1;
      console.error("[booking-reminder-notification-service] reminder email enqueue failed", {
        alertCode: "BOOKING_REMINDER_EMAIL_ENQUEUE_FAILED",
        bookingId: candidate.id,
        recipientEmail,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    scanned: candidates.length,
    enqueued,
    failed,
  };
}
