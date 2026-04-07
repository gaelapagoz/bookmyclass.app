import "./helpers/setup-env";

import { BookingIntent, BookingStatus, Prisma, Role, StudioSessionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPendingBookingDraft } from "../../src/lib/public-booking/booking-draft-service";
import { prisma } from "../../src/lib/db";
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

  it("retries on serialization failures and succeeds", async () => {
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

    const originalTransaction = prisma.$transaction.bind(prisma);
    let transactionAttempts = 0;
    const transactionSpy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementation(async (callback: any, options?: any) => {
        if (transactionAttempts === 0) {
          transactionAttempts += 1;
          const error = Object.setPrototypeOf(
            {
              name: "PrismaClientKnownRequestError",
              message: "Serialization failure",
              code: "P2034",
              clientVersion: "4.0.0",
            },
            Prisma.PrismaClientKnownRequestError.prototype,
          ) as Prisma.PrismaClientKnownRequestError;
          throw error;
        }

        return originalTransaction(callback, options);
      });

    const result = await createPendingBookingDraft({
      authenticatedUserId: fixture.userOne.id,
      payload,
    });

    expect(result.status).toBe("PENDING");
    expect(transactionAttempts).toBe(1);
    transactionSpy.mockRestore();
  });

  it("throws BOOKING_CONTENTION after exhausting serialization retries", async () => {
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

    const transactionSpy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementation(async () => {
        const error = Object.setPrototypeOf(
          {
            name: "PrismaClientKnownRequestError",
            message: "Serialization failure",
            code: "P2034",
            clientVersion: "4.0.0",
          },
          Prisma.PrismaClientKnownRequestError.prototype,
        ) as Prisma.PrismaClientKnownRequestError;
        throw error;
      });

    await expect(
      createPendingBookingDraft({
        authenticatedUserId: fixture.userOne.id,
        payload,
      }),
    ).rejects.toMatchObject({ code: "BOOKING_CONTENTION" });

    transactionSpy.mockRestore();
  });

  it("rejects duplicate booking with DUPLICATE_BOOKING", async () => {
    const fixture = await createCapacityOneFixture();
    await prisma.studioSession.update({
      where: { id: fixture.studioSession.id },
      data: { capacity: 2 },
    });

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

    await createPendingBookingDraft({
      authenticatedUserId: fixture.userOne.id,
      payload,
    });

    await expect(
      createPendingBookingDraft({
        authenticatedUserId: fixture.userOne.id,
        payload,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_BOOKING" });
  });
});
