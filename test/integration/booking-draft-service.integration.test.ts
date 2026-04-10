import "./helpers/setup-env";

import { BookingIntent, BookingStatus, Prisma, Role, StudioSessionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPendingBookingDraft } from "../../src/lib/public-booking/booking-draft-service";
import * as ClientMessageService from "../../src/lib/client-messages/client-message-service";
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

  it("expires stale pending booking drafts before creating a new draft", async () => {
    const fixture = await createCapacityOneFixture();

    const staleBooking = await prisma.booking.create({
      data: {
        clientId: fixture.userOne.id,
        studioSessionId: fixture.studioSession.id,
        status: BookingStatus.PENDING,
        bookingIntent: BookingIntent.SINGLE_BOOKING,
        customerName: "Client",
        customerEmail: "client@example.test",
        customerPhone: "+32000000000",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
        consentAcceptedAt: new Date(Date.now() - 30 * 60 * 1000),
        createdAt: new Date(Date.now() - 30 * 60 * 1000),
      },
      select: { id: true },
    });

    const payload = {
      bookingIntent: BookingIntent.SINGLE_BOOKING,
      consentPrivacyAccepted: true,
      consentTermsAccepted: true,
      customerEmail: "client2@example.test",
      customerName: "Client Two",
      customerPhone: "+32000000001",
      serviceSlug: fixture.classType.slug,
      sessionId: fixture.studioSession.id,
    };

    const result = await createPendingBookingDraft({
      authenticatedUserId: fixture.userTwo.id,
      payload,
    });

    expect(result.status).toBe(BookingStatus.PENDING);

    const activeBookings = await prisma.booking.findMany({
      where: {
        studioSessionId: fixture.studioSession.id,
        status: {
          in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
        },
      },
    });

    expect(activeBookings).toHaveLength(1);

    const expiredBooking = await prisma.booking.findUnique({
      where: { id: staleBooking.id },
    });

    expect(expiredBooking?.status).toBe(BookingStatus.CANCELLED);
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
      .mockImplementation(async (callback, options) => {
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

  it("retries and succeeds for postgres serialization conflicts surfaced as SQLSTATE 40001", async () => {
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
      .mockImplementation(async (callback, options) => {
        if (transactionAttempts === 0) {
          transactionAttempts += 1;
          const commitConflict = Object.assign(
            new Error("could not serialize access due to read/write dependencies among transactions"),
            { code: "40001" },
          );
          throw commitConflict;
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

  it("retries and succeeds when serialization SQLSTATE 40001 is nested in prisma meta", async () => {
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
      .mockImplementation(async (callback, options) => {
        if (transactionAttempts === 0) {
          transactionAttempts += 1;
          const nestedSqlStateConflict = Object.assign(new Error("Transaction API error"), {
            code: "P2028",
            meta: {
              driverAdapterError: {
                code: "40001",
                detail: "could not serialize access due to read/write dependencies among transactions",
              },
            },
          });
          throw nestedSqlStateConflict;
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

  it("maps repeated SQLSTATE 40001 conflicts to BOOKING_CONTENTION", async () => {
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
        const commitConflict = Object.assign(
          new Error("could not serialize access due to read/write dependencies among transactions"),
          { code: "40001" },
        );
        throw commitConflict;
      });

    await expect(
      createPendingBookingDraft({
        authenticatedUserId: fixture.userOne.id,
        payload,
      }),
    ).rejects.toMatchObject({ code: "BOOKING_CONTENTION" });

    transactionSpy.mockRestore();
  });

  it("retries and succeeds when adapter reports overlapping client.query usage", async () => {
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
      .mockImplementation(async (callback, options) => {
        if (transactionAttempts === 0) {
          transactionAttempts += 1;
          throw new Error(
            "Calling client.query() when the client is already executing a query is deprecated",
          );
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

  it("maps repeated overlapping client.query failures to BOOKING_CONTENTION", async () => {
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
        throw new Error(
          "Calling client.query() when the client is already executing a query is deprecated",
        );
      });

    await expect(
      createPendingBookingDraft({
        authenticatedUserId: fixture.userOne.id,
        payload,
      }),
    ).rejects.toMatchObject({ code: "BOOKING_CONTENTION" });

    transactionSpy.mockRestore();
  });
  it("maps adapter-level unique violations (SQLSTATE 23505) to idempotent pending draft reuse", async () => {
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

    const findFirstSpy = vi
      .spyOn(prisma.booking, "findFirst")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "existing-pending-booking-id",
        status: BookingStatus.PENDING,
      } as { id: string; status: BookingStatus });

    const transactionSpy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementation(async () => {
        const error = Object.assign(new Error("driver unique violation"), {
          cause: {
            code: "23505",
            message:
              "duplicate key value violates unique constraint \"Booking_clientId_studioSessionId_key\"",
          },
        });
        throw error;
      });

    const result = await createPendingBookingDraft({
      authenticatedUserId: fixture.userOne.id,
      payload,
    });

    expect(result.created).toBe(false);
    expect(result.status).toBe(BookingStatus.PENDING);
    expect(result.bookingId).toBe("existing-pending-booking-id");

    transactionSpy.mockRestore();
    findFirstSpy.mockRestore();
  });
  it("returns existing pending draft idempotently on duplicate create requests", async () => {
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

    const first = await createPendingBookingDraft({
      authenticatedUserId: fixture.userOne.id,
      payload,
    });

    const second = await createPendingBookingDraft({
      authenticatedUserId: fixture.userOne.id,
      payload,
    });

    expect(first.bookingId).toBe(second.bookingId);
    expect(second.created).toBe(false);
    expect(second.status).toBe(BookingStatus.PENDING);
  });

  it("returns the same booking id for concurrent duplicate create requests from the same user", async () => {
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

    const results = await Promise.all([
      createPendingBookingDraft({
        authenticatedUserId: fixture.userOne.id,
        payload,
      }),
      createPendingBookingDraft({
        authenticatedUserId: fixture.userOne.id,
        payload,
      }),
    ]);

    expect(results[0]?.bookingId).toBeTruthy();
    expect(results[0]?.bookingId).toBe(results[1]?.bookingId);

    const bookings = await prisma.booking.findMany({
      where: {
        clientId: fixture.userOne.id,
        studioSessionId: fixture.studioSession.id,
      },
      select: { id: true, status: true },
    });

    expect(bookings).toHaveLength(1);
    expect(bookings[0]?.status).toBe(BookingStatus.PENDING);
  });

  it("rejects duplicate booking with DUPLICATE_BOOKING when booking is already confirmed", async () => {
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

    const created = await createPendingBookingDraft({
      authenticatedUserId: fixture.userOne.id,
      payload,
    });

    await prisma.booking.update({
      where: { id: created.bookingId },
      data: { status: BookingStatus.CONFIRMED },
    });

    await expect(
      createPendingBookingDraft({
        authenticatedUserId: fixture.userOne.id,
        payload,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_BOOKING" });
  });

  it("keeps booking draft creation successful when optional booking note persistence fails", async () => {
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
      customerMessage: "Please reserve my spot",
      serviceSlug: fixture.classType.slug,
      sessionId: fixture.studioSession.id,
    };

    const bookingNoteSpy = vi
      .spyOn(ClientMessageService, "createBookingNoteMessage")
      .mockRejectedValueOnce(new Error("simulated booking note persistence failure"));

    const result = await createPendingBookingDraft({
      authenticatedUserId: fixture.userOne.id,
      payload,
    });

    expect(result.status).toBe(BookingStatus.PENDING);
    expect(result.created).toBe(true);
    expect(bookingNoteSpy).toHaveBeenCalledTimes(1);

    const persistedBooking = await prisma.booking.findUnique({
      where: { id: result.bookingId },
      select: { id: true, status: true, clientId: true },
    });

    expect(persistedBooking?.id).toBe(result.bookingId);
    expect(persistedBooking?.status).toBe(BookingStatus.PENDING);
    expect(persistedBooking?.clientId).toBe(fixture.userOne.id);

    bookingNoteSpy.mockRestore();
  });
});



