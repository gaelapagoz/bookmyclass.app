import "./helpers/setup-env";

import { BookingStatus, Role, StudioSessionStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";
import {
  buildBookingReminderEmailIdempotencyKey,
  enqueueBookingReminderNotifications,
} from "../../src/lib/public-booking/booking-reminder-notification-service";

async function createClient(label: string) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return prisma.user.create({
    data: {
      name: `${label} ${unique}`,
      email: `${label.toLowerCase()}.${unique}@example.test`,
      role: Role.CLIENT,
    },
  });
}

async function seedBookingReminderTemplate() {
  await prisma.emailTemplate.upsert({
    where: { templateKey: "booking.class-reminder" },
    update: {
      name: "Booking Reminder",
      category: "BOOKING",
      subjectTemplate: "Reminder: {{booking.classTitle}}",
      bodyTemplateJson: {
        blocks: [{ type: "paragraph", text: "See you soon, {{clientName}}." }],
      },
      contentSchemaVersion: 1,
      isActive: true,
    },
    create: {
      templateKey: "booking.class-reminder",
      name: "Booking Reminder",
      category: "BOOKING",
      subjectTemplate: "Reminder: {{booking.classTitle}}",
      bodyTemplateJson: {
        blocks: [{ type: "paragraph", text: "See you soon, {{clientName}}." }],
      },
      contentSchemaVersion: 1,
      isActive: true,
    },
  });
}

async function createSessionFixture(input: {
  title: string;
  startsAt: Date;
  status?: StudioSessionStatus;
  isPublished?: boolean;
}) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const category = await createClassCategory(prisma, {
    name: `Collective ${unique}`,
    slug: `collective-${unique}`,
    sortOrder: 1,
    isActive: true,
  });

  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: `Pilates ${unique}`,
    slug: `pilates-${unique}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const teacher = await prisma.user.create({
    data: {
      name: `Teacher ${unique}`,
      email: `teacher.${unique}@example.test`,
      role: Role.TEACHER,
    },
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: `${input.title} Template`,
      slug: `template-${unique}`,
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  return prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: input.title,
      startsAt: input.startsAt,
      endsAt: new Date(input.startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: input.status ?? StudioSessionStatus.SCHEDULED,
      isPublished: input.isPublished ?? true,
      location: "Studio A",
    },
  });
}

async function createConfirmedBooking(input: {
  clientId: string;
  studioSessionId: string;
  status?: BookingStatus;
  customerEmail?: string;
}) {
  const client = await prisma.user.findUniqueOrThrow({
    where: { id: input.clientId },
    select: { name: true, email: true },
  });

  return prisma.booking.create({
    data: {
      clientId: input.clientId,
      studioSessionId: input.studioSessionId,
      status: input.status ?? BookingStatus.CONFIRMED,
      bookedAt: new Date(),
      customerName: client.name,
      customerEmail: input.customerEmail ?? client.email,
      customerPhone: "+32000000000",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
    },
  });
}

describe("booking reminder notification service", () => {
  const originalAppUrl = process.env.APP_URL;

  beforeEach(async () => {
    await resetDb();
    process.env.APP_URL = "https://studio.example.test";
    await seedBookingReminderTemplate();
  });

  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL;
      return;
    }

    process.env.APP_URL = originalAppUrl;
  });

  it("enqueues one reminder when a confirmed booking enters the 24-hour window", async () => {
    const now = new Date("2026-06-17T10:00:00.000Z");
    const client = await createClient("reminder-client");
    const session = await createSessionFixture({
      title: "Morning Flow",
      startsAt: new Date("2026-06-18T09:30:00.000Z"),
    });
    const booking = await createConfirmedBooking({
      clientId: client.id,
      studioSessionId: session.id,
    });

    const firstRun = await enqueueBookingReminderNotifications({ now, limit: 100 });
    const secondRun = await enqueueBookingReminderNotifications({ now, limit: 100 });

    expect(firstRun).toEqual({ scanned: 1, enqueued: 1, failed: 0 });
    expect(secondRun).toEqual({ scanned: 1, enqueued: 1, failed: 0 });

    const events = await prisma.emailAutomationEvent.findMany({
      where: {
        recipientEmail: client.email.toLowerCase(),
        idempotencyKey: buildBookingReminderEmailIdempotencyKey({
          bookingId: booking.id,
          sessionStartsAt: session.startsAt,
        }),
      },
      select: {
        payloadJson: true,
        template: { select: { templateKey: true } },
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.template.templateKey).toBe("booking.class-reminder");
    expect(events[0]?.payloadJson).toMatchObject({
      bookingId: booking.id,
      clientName: client.name,
      sessionTitle: session.title,
      "booking.classTitle": session.title,
      "booking.manageUrl": "https://studio.example.test/dashboard/bookings",
      "booking.cancelUrl": "https://studio.example.test/dashboard/bookings",
    });
    expect((events[0]?.payloadJson as { "booking.startAt"?: unknown } | null)?.["booking.startAt"]).toEqual(
      expect.any(String),
    );
  });

  it("suppresses reminders outside the active confirmed-session contract", async () => {
    const now = new Date("2026-06-17T10:00:00.000Z");
    const [futureClient, cancelledClient, unpublishedClient, startedClient] = await Promise.all([
      createClient("future-client"),
      createClient("cancelled-client"),
      createClient("unpublished-client"),
      createClient("started-client"),
    ]);

    const futureSession = await createSessionFixture({
      title: "Future Flow",
      startsAt: new Date("2026-06-18T12:30:01.000Z"),
    });
    const cancelledSession = await createSessionFixture({
      title: "Cancelled Flow",
      startsAt: new Date("2026-06-18T08:00:00.000Z"),
    });
    const unpublishedSession = await createSessionFixture({
      title: "Hidden Flow",
      startsAt: new Date("2026-06-18T08:15:00.000Z"),
      isPublished: false,
    });
    const startedSession = await createSessionFixture({
      title: "Started Flow",
      startsAt: new Date("2026-06-17T09:45:00.000Z"),
    });

    await Promise.all([
      createConfirmedBooking({ clientId: futureClient.id, studioSessionId: futureSession.id }),
      createConfirmedBooking({
        clientId: cancelledClient.id,
        studioSessionId: cancelledSession.id,
        status: BookingStatus.CANCELLED,
      }),
      createConfirmedBooking({ clientId: unpublishedClient.id, studioSessionId: unpublishedSession.id }),
      createConfirmedBooking({ clientId: startedClient.id, studioSessionId: startedSession.id }),
    ]);

    const result = await enqueueBookingReminderNotifications({ now, limit: 100 });

    expect(result).toEqual({ scanned: 0, enqueued: 0, failed: 0 });
    expect(
      await prisma.emailAutomationEvent.count({
        where: {
          template: { templateKey: "booking.class-reminder" },
        },
      }),
    ).toBe(0);
  });

  it("uses the current session start time so later edits delay reminder eligibility", async () => {
    const now = new Date("2026-06-17T10:00:00.000Z");
    const client = await createClient("reschedule-client");
    const session = await createSessionFixture({
      title: "Rescheduled Flow",
      startsAt: new Date("2026-06-18T09:00:00.000Z"),
    });
    const booking = await createConfirmedBooking({
      clientId: client.id,
      studioSessionId: session.id,
    });

    await prisma.studioSession.update({
      where: { id: session.id },
      data: {
        startsAt: new Date("2026-06-19T09:00:00.000Z"),
        endsAt: new Date("2026-06-19T10:00:00.000Z"),
      },
    });

    const firstRun = await enqueueBookingReminderNotifications({ now, limit: 100 });
    const secondRun = await enqueueBookingReminderNotifications({
      now: new Date("2026-06-18T10:00:00.000Z"),
      limit: 100,
    });

    expect(firstRun).toEqual({ scanned: 0, enqueued: 0, failed: 0 });
    expect(secondRun).toEqual({ scanned: 1, enqueued: 1, failed: 0 });
    expect(
      await prisma.emailAutomationEvent.count({
        where: {
          idempotencyKey: buildBookingReminderEmailIdempotencyKey({
            bookingId: booking.id,
            sessionStartsAt: new Date("2026-06-19T09:00:00.000Z"),
          }),
        },
      }),
    ).toBe(1);
  });

  it("dead-letters an older queued reminder and creates a new one after reschedule", async () => {
    const now = new Date("2026-06-17T10:00:00.000Z");
    const client = await createClient("rescheduled-after-queue");
    const originalStartsAt = new Date("2026-06-18T09:30:00.000Z");
    const rescheduledStartsAt = new Date("2026-06-19T09:30:00.000Z");
    const session = await createSessionFixture({
      title: "Rescheduled After Queue",
      startsAt: originalStartsAt,
    });
    const booking = await createConfirmedBooking({
      clientId: client.id,
      studioSessionId: session.id,
    });

    const firstRun = await enqueueBookingReminderNotifications({ now, limit: 100 });
    expect(firstRun).toEqual({ scanned: 1, enqueued: 1, failed: 0 });

    await prisma.studioSession.update({
      where: { id: session.id },
      data: {
        startsAt: rescheduledStartsAt,
        endsAt: new Date(rescheduledStartsAt.getTime() + 60 * 60 * 1000),
      },
    });

    const secondRun = await enqueueBookingReminderNotifications({
      now: new Date("2026-06-18T10:00:00.000Z"),
      limit: 100,
    });

    expect(secondRun).toEqual({ scanned: 1, enqueued: 1, failed: 0 });

    const reminderEvents = await prisma.emailAutomationEvent.findMany({
      where: {
        recipientEmail: client.email.toLowerCase(),
        idempotencyKey: {
          startsWith: `booking-reminder:${booking.id}:`,
        },
      },
      orderBy: { createdAt: "asc" },
      select: {
        idempotencyKey: true,
        status: true,
        lastError: true,
      },
    });

    expect(reminderEvents).toHaveLength(2);
    expect(reminderEvents[0]).toMatchObject({
      idempotencyKey: buildBookingReminderEmailIdempotencyKey({
        bookingId: booking.id,
        sessionStartsAt: originalStartsAt,
      }),
      status: "DEAD_LETTER",
      lastError: "BOOKING_REMINDER_RESCHEDULED",
    });
    expect(reminderEvents[1]).toMatchObject({
      idempotencyKey: buildBookingReminderEmailIdempotencyKey({
        bookingId: booking.id,
        sessionStartsAt: rescheduledStartsAt,
      }),
      status: "PENDING",
    });
  });

});
