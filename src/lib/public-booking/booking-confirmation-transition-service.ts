import { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildBookingConfirmationEmailIdempotencyKey } from "@/lib/public-booking/booking-confirmation-notification-service";

type DbClient = Prisma.TransactionClient | typeof prisma;

const BOOKING_CLASS_BOOKED_TEMPLATE_KEY = "booking.class-booked";

async function enqueueBookingConfirmationOutboxEvent(input: {
  bookingId: string;
  recipientEmail: string;
  db: DbClient;
}): Promise<void> {
  const template = await input.db.emailTemplate.findUnique({
    where: { templateKey: BOOKING_CLASS_BOOKED_TEMPLATE_KEY },
    select: { id: true },
  });
  if (!template) {
    throw new Error("BOOKING_CONFIRMATION_TEMPLATE_MISSING");
  }

  try {
    await input.db.emailAutomationEvent.create({
      data: {
        templateId: template.id,
        recipientEmail: input.recipientEmail.toLowerCase(),
        payloadJson: { bookingId: input.bookingId },
        idempotencyKey: buildBookingConfirmationEmailIdempotencyKey(input.bookingId),
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return;
    }
    throw error;
  }
}

export async function transitionBookingToConfirmedAndQueueEmail(input: {
  bookingId: string;
  db?: DbClient;
}): Promise<{ transitioned: boolean }> {
  const db = input.db ?? prisma;
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      status: true,
      customerEmail: true,
      client: {
        select: { email: true },
      },
    },
  });

  if (!booking || booking.status === BookingStatus.CONFIRMED) {
    return { transitioned: false };
  }

  const updated = await db.booking.updateMany({
    where: {
      id: booking.id,
      NOT: { status: BookingStatus.CONFIRMED },
    },
    data: { status: BookingStatus.CONFIRMED },
  });
  if (updated.count < 1) {
    return { transitioned: false };
  }

  const recipientEmail = booking.client?.email ?? booking.customerEmail;
  if (!recipientEmail) {
    return { transitioned: true };
  }

  await enqueueBookingConfirmationOutboxEvent({
    bookingId: booking.id,
    recipientEmail,
    db,
  });
  return { transitioned: true };
}

export async function ensureBookingConfirmationEventForConfirmedBooking(input: {
  bookingId: string;
  db?: DbClient;
}): Promise<{ queued: boolean }> {
  const db = input.db ?? prisma;
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      status: true,
      customerEmail: true,
      client: { select: { email: true } },
    },
  });
  if (!booking || booking.status !== BookingStatus.CONFIRMED) {
    return { queued: false };
  }

  const recipientEmail = booking.client?.email ?? booking.customerEmail;
  if (!recipientEmail) {
    return { queued: false };
  }

  await enqueueBookingConfirmationOutboxEvent({
    bookingId: booking.id,
    recipientEmail,
    db,
  });
  return { queued: true };
}

export async function reconcileMissingBookingConfirmationEvents(input?: {
  limit?: number;
}): Promise<{ scanned: number; enqueued: number; failed: number }> {
  const limit = Math.max(1, Math.min(input?.limit ?? 100, 500));
  const confirmedBookings = await prisma.booking.findMany({
    where: { status: BookingStatus.CONFIRMED },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true },
  });

  let enqueued = 0;
  let failed = 0;
  for (const booking of confirmedBookings) {
    try {
      const result = await ensureBookingConfirmationEventForConfirmedBooking({
        bookingId: booking.id,
      });
      if (result.queued) enqueued += 1;
    } catch {
      failed += 1;
    }
  }

  return { scanned: confirmedBookings.length, enqueued, failed };
}
