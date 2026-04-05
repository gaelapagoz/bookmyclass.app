import "./helpers/setup-env";

import { BookingIntent, BookingStatus, Role, StudioSessionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { createPendingBookingDraft } from "../../src/lib/public-booking/booking-draft-service";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

async function createCapacityOneFixture() {
  const category = await createClassCategory(prisma, {
    name: "Yoga",
    slug: `yoga-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Vinyasa",
    slug: `vinyasa-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Teacher",
      email: `teacher.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Template",
      slug: `template-${Date.now()}`,
      defaultCapacity: 1,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const startsAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);

  const studioSession = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 1,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const userOne = await prisma.user.create({
    data: {
      name: "User One",
      email: `one.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const userTwo = await prisma.user.create({
    data: {
      name: "User Two",
      email: `two.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  return {
    studioSession,
    classType,
    userOne,
    userTwo,
  };
}

describe("booking draft service concurrency", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates at most one pending booking when capacity is reached concurrently", async () => {
    const fixture = await createCapacityOneFixture();

    const payload = {
      bookingIntent: BookingIntent.SINGLE_BOOKING,
      consentPrivacyAccepted: true,
      consentTermsAccepted: true,
      customerEmail: "client@example.test",
      customerName: "Client",
      customerPhone: "+32000000000",
      serviceSlug: fixture.classType.slug,
      sessionId: fixture.studioSession.id,
    };

    const results = await Promise.allSettled([
      createPendingBookingDraft({
        authenticatedUserId: fixture.userOne.id,
        payload,
      }),
      createPendingBookingDraft({
        authenticatedUserId: fixture.userTwo.id,
        payload,
      }),
    ]);

    const successCount = results.filter((result) => result.status === "fulfilled").length;
    expect(successCount).toBe(1);

    const activeBookings = await prisma.booking.findMany({
      where: {
        studioSessionId: fixture.studioSession.id,
        status: {
          in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
        },
      },
    });

    expect(activeBookings).toHaveLength(1);
  });
});
