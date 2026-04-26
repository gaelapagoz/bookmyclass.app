import "./helpers/setup-env";

import { BookingStatus, Role, StudioSessionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  bookingDraftActiveBookingFilter,
  expireStaleBookingDrafts,
} from "../../src/lib/public-booking/booking-draft-service";
import { prisma } from "../../src/lib/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

async function createSessionFixture() {
  const category = await createClassCategory(prisma, {
    name: "Yoga",
    slug: `yoga-expiry-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Flow",
    slug: `flow-expiry-${Date.now()}`,
    isActive: true,
    isVisible: true,
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Teacher Expiry",
      email: `teacher.expiry.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Flow Template",
      slug: `flow-template-${Date.now()}`,
      defaultCapacity: 5,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const startsAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);

  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Flow Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 5,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const client = await prisma.user.create({
    data: {
      name: "Client Expiry",
      email: `client.expiry.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  return { session, classType, client };
}

describe("expireStaleBookingDrafts", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("marks expired PENDING drafts as CANCELLED", async () => {
    const { session, client } = await createSessionFixture();

    const expiredCreatedAt = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago

    const draft = await prisma.booking.create({
      data: {
        clientId: client.id,
        studioSessionId: session.id,
        status: BookingStatus.PENDING,
        bookingIntent: "SINGLE_BOOKING",
        customerName: client.name,
        customerEmail: `client.expiry@example.test`,
        customerPhone: "+10000000000",
        createdAt: expiredCreatedAt,
      },
    });

    const { expiredCount } = await expireStaleBookingDrafts();

    expect(expiredCount).toBeGreaterThanOrEqual(1);

    const updated = await prisma.booking.findUnique({ where: { id: draft.id } });
    expect(updated?.status).toBe(BookingStatus.CANCELLED);
    expect(updated?.cancellationReason).toBe("Expired booking draft");
  });

  it("does not affect CONFIRMED bookings", async () => {
    const { session, client } = await createSessionFixture();

    const confirmed = await prisma.booking.create({
      data: {
        clientId: client.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        bookingIntent: "SINGLE_BOOKING",
        customerName: client.name,
        customerEmail: `client.confirmed@example.test`,
        customerPhone: "+10000000000",
      },
    });

    await expireStaleBookingDrafts();

    const updated = await prisma.booking.findUnique({ where: { id: confirmed.id } });
    expect(updated?.status).toBe(BookingStatus.CONFIRMED);
  });

  it("does not affect recent PENDING drafts within the hold window", async () => {
    const { session, client } = await createSessionFixture();

    const recent = await prisma.booking.create({
      data: {
        clientId: client.id,
        studioSessionId: session.id,
        status: BookingStatus.PENDING,
        bookingIntent: "SINGLE_BOOKING",
        customerName: client.name,
        customerEmail: `client.recent@example.test`,
        customerPhone: "+10000000000",
      },
    });

    await expireStaleBookingDrafts();

    const updated = await prisma.booking.findUnique({ where: { id: recent.id } });
    expect(updated?.status).toBe(BookingStatus.PENDING);
  });

  it("expired drafts do not count toward session capacity after expiry job runs", async () => {
    const { session, client } = await createSessionFixture();

    // Create an expired PENDING draft
    const expiredCreatedAt = new Date(Date.now() - 30 * 60 * 1000);
    await prisma.booking.create({
      data: {
        clientId: client.id,
        studioSessionId: session.id,
        status: BookingStatus.PENDING,
        bookingIntent: "SINGLE_BOOKING",
        customerName: client.name,
        customerEmail: `client.expired@example.test`,
        customerPhone: "+10000000000",
        createdAt: expiredCreatedAt,
      },
    });

    // Run the expiry job
    await expireStaleBookingDrafts();

    // Count active bookings — should be 0 since the only draft was expired
    const count = await prisma.booking.count({
      where: {
        studioSessionId: session.id,
        ...bookingDraftActiveBookingFilter(),
      },
    });
    expect(count).toBe(0);
  });
});
