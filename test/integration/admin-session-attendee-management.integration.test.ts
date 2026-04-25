import "./helpers/setup-env";

import {
  BookingIntent,
  BookingPaymentSelection,
  AttendanceSource,
  AttendanceStatus,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  ProductType,
  Role,
  StudioSessionStatus,
  SubscriptionStatus,
  WaitlistStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addSessionAttendeeByManager,
  getAdminSessionById,
  getAdminSessionsData,
  getAdminSessionOptions,
  removeSessionAttendeeByManager,
} from "../../src/lib/admin/admin-service";
import { markBookingAttendanceByStaff } from "../../src/lib/attendance/attendance-service";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

async function createSessionFixture() {
  const category = await createClassCategory(prisma, {
    name: "Collective",
    slug: `collective-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });

  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Pilates",
    slug: `pilates-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Teacher",
      email: `teacher.session.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Pilates Session",
      slug: `pilates-template-${Date.now()}`,
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const startsAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Pilates Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  return {
    session,
    teacher,
  };
}

async function grantCollectiveCredits(input: { clientId: string; amount: number }) {
  const product = await prisma.product.create({
    data: {
      name: `Pack ${Date.now()}`,
      slug: `pack-${Date.now()}`,
      productType: "CLASS_PACK",
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const entitlement = await prisma.clientEntitlement.create({
    data: {
      clientId: input.clientId,
      productId: product.id,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      status: ClientEntitlementStatus.ACTIVE,
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.creditLedgerEntry.create({
    data: {
      clientId: input.clientId,
      entitlementId: entitlement.id,
      entryType: CreditLedgerEntryType.GRANT,
      amount: input.amount,
      notes: "Seed grant",
    },
  });

  return entitlement;
}

async function grantCollectiveUnlimitedSubscription(input: { clientId: string }) {
  const now = new Date();
  const product = await prisma.product.create({
    data: {
      name: `Unlimited ${Date.now()}`,
      slug: `unlimited-${Date.now()}`,
      productType: ProductType.UNLIMITED_MEMBERSHIP,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
      entitlementRules: {
        create: {
          entitlementType: EntitlementType.UNLIMITED_ACCESS,
          entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
          isActive: true,
        },
      },
    },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `unlimited-price-${Date.now()}`,
      name: "Unlimited Monthly",
      priceType: "RECURRING",
      currencyCode: "EUR",
      unitAmountMinor: 9900,
      billingInterval: "MONTH",
      billingIntervalCount: 1,
      isActive: true,
      isArchived: false,
    },
  });

  await prisma.subscriptionContract.create({
    data: {
      clientId: input.clientId,
      productId: product.id,
      priceId: price.id,
      status: SubscriptionStatus.ACTIVE,
      startsAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      provider: "STRIPE",
      providerSubscriptionReference: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    },
  });
}

describe("admin session attendee management service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("loads session attendees in admin session detail", async () => {
    const { session } = await createSessionFixture();
    const client = await prisma.user.create({
      data: {
        name: "Client One",
        email: `client.one.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await prisma.booking.create({
      data: {
        clientId: client.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        customerName: client.name,
        customerEmail: client.email,
      },
    });

    const detail = await getAdminSessionById(session.id);

    expect(detail).not.toBeNull();
    expect(detail?.attendees).toHaveLength(1);
    expect(detail?.attendees[0]?.clientName).toBe("Client One");
  });

  it("shows only confirmed bookings in session attendee roster", async () => {
    const { session } = await createSessionFixture();
    const [confirmedClient, pendingClient] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Confirmed Client",
          email: `confirmed.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Pending Client",
          email: `pending.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
    ]);

    await Promise.all([
      prisma.booking.create({
        data: {
          clientId: confirmedClient.id,
          studioSessionId: session.id,
          status: BookingStatus.CONFIRMED,
          customerName: confirmedClient.name,
          customerEmail: confirmedClient.email,
        },
      }),
      prisma.booking.create({
        data: {
          clientId: pendingClient.id,
          studioSessionId: session.id,
          status: BookingStatus.PENDING,
          customerName: pendingClient.name,
          customerEmail: pendingClient.email,
        },
      }),
    ]);

    const detail = await getAdminSessionById(session.id);

    expect(detail?.attendees).toHaveLength(1);
    expect(detail?.attendees[0]?.clientName).toBe("Confirmed Client");
  });

  it("removing attendee restores consumed credit through ledger", async () => {
    const { session } = await createSessionFixture();
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Two",
          email: `client.two.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin",
          email: `admin.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    const entitlement = await grantCollectiveCredits({ clientId: client.id, amount: 5 });

    const booking = await prisma.booking.create({
      data: {
        clientId: client.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        selectedEntitlementId: entitlement.id,
        customerName: client.name,
        customerEmail: client.email,
      },
    });

    await prisma.creditLedgerEntry.create({
      data: {
        clientId: client.id,
        entitlementId: entitlement.id,
        bookingId: booking.id,
        entryType: CreditLedgerEntryType.CONSUME,
        amount: -1,
        notes: "Seed consume",
      },
    });

    await removeSessionAttendeeByManager({
      studioSessionId: session.id,
      bookingId: booking.id,
      note: "Client requested",
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    const updatedBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
      select: { status: true, creditRefundedAt: true },
    });

    const restore = await prisma.creditLedgerEntry.findFirst({
      where: {
        bookingId: booking.id,
        entitlementId: entitlement.id,
        entryType: CreditLedgerEntryType.RESTORE,
      },
      select: { amount: true },
    });

    expect(updatedBooking?.status).toBe(BookingStatus.CANCELLED);
    expect(updatedBooking?.creditRefundedAt).not.toBeNull();
    expect(restore?.amount).toBe(1);
  });

  it("adding attendee with available credit consumes one credit", async () => {
    const { session } = await createSessionFixture();
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Three",
          email: `client.three.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin Two",
          email: `admin.two.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    const entitlement = await grantCollectiveCredits({ clientId: client.id, amount: 2 });

    const result = await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: client.id,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    expect(result.usedCreditEntitlementId).toBe(entitlement.id);
    expect(result.overrideApplied).toBe(false);

    const consume = await prisma.creditLedgerEntry.findFirst({
      where: {
        bookingId: result.bookingId,
        entitlementId: entitlement.id,
        entryType: CreditLedgerEntryType.CONSUME,
      },
      select: { amount: true },
    });

    expect(consume?.amount).toBe(-1);
  });

  it("ADMIN and MASTER_ADMIN cannot add attendee without eligible credit or qualifying subscription", async () => {
    const { session } = await createSessionFixture();
    const [clientOne, clientTwo, admin, masterAdmin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Four",
          email: `client.four.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Client Five",
          email: `client.five.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin Three",
          email: `admin.three.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          name: "Master Admin",
          email: `master.admin.${Date.now()}@example.test`,
          role: Role.MASTER_ADMIN,
        },
      }),
    ]);

    await expect(
      addSessionAttendeeByManager({
        studioSessionId: session.id,
        clientId: clientOne.id,
        actor: {
          userId: admin.id,
          role: Role.ADMIN,
        },
      }),
    ).rejects.toThrow("SESSION_ELIGIBILITY_REQUIRED");

    await expect(
      addSessionAttendeeByManager({
        studioSessionId: session.id,
        clientId: clientTwo.id,
        note: "Manual override",
        actor: {
          userId: masterAdmin.id,
          role: Role.MASTER_ADMIN,
        },
      }),
    ).rejects.toThrow("SESSION_ELIGIBILITY_REQUIRED");
  });

  it("allows add attendee with active qualifying subscription without consuming credit", async () => {
    const { session } = await createSessionFixture();
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Unlimited",
          email: `client.unlimited.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin Unlimited",
          email: `admin.unlimited.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    await grantCollectiveUnlimitedSubscription({ clientId: client.id });

    const result = await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: client.id,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    expect(result.status).toBe(BookingStatus.CONFIRMED);
    expect(result.usedCreditEntitlementId).toBeNull();
    expect(result.overrideApplied).toBe(false);

    const consumedEntries = await prisma.creditLedgerEntry.count({
      where: {
        bookingId: result.bookingId,
        entryType: CreditLedgerEntryType.CONSUME,
      },
    });
    expect(consumedEntries).toBe(0);
  });

  it("TEACHER cannot add attendee without available credits", async () => {
    const { session, teacher } = await createSessionFixture();
    const [client] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Six",
          email: `client.six.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
    ]);

    await expect(
      addSessionAttendeeByManager({
        studioSessionId: session.id,
        clientId: client.id,
        note: "Trying override",
        actor: {
          userId: teacher.id,
          role: Role.TEACHER,
        },
      }),
    ).rejects.toThrow("SESSION_ELIGIBILITY_REQUIRED");
  });

  it("returns existing active booking instead of creating duplicate booking", async () => {
    const { session } = await createSessionFixture();
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Duplicate",
          email: `client.duplicate.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin Duplicate",
          email: `admin.duplicate.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    await grantCollectiveCredits({ clientId: client.id, amount: 3 });

    const first = await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: client.id,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });
    const second = await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: client.id,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    expect(second.bookingId).toBe(first.bookingId);

    const bookings = await prisma.booking.count({
      where: {
        studioSessionId: session.id,
        clientId: client.id,
        status: {
          in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
        },
      },
    });
    expect(bookings).toBe(1);
  });

  it("blocks manager add when session is already full", async () => {
    const { session } = await createSessionFixture();
    const [admin, clientA, clientB, clientC] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Admin Full",
          email: `admin.full.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          name: "Client Full A",
          email: `client.full.a.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Client Full B",
          email: `client.full.b.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Client Full C",
          email: `client.full.c.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
    ]);

    await prisma.studioSession.update({
      where: { id: session.id },
      data: { capacity: 2 },
    });

    await grantCollectiveCredits({ clientId: clientA.id, amount: 1 });
    await grantCollectiveCredits({ clientId: clientB.id, amount: 1 });
    await grantCollectiveCredits({ clientId: clientC.id, amount: 1 });

    await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: clientA.id,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });
    await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: clientB.id,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    await expect(
      addSessionAttendeeByManager({
        studioSessionId: session.id,
        clientId: clientC.id,
        actor: {
          userId: admin.id,
          role: Role.ADMIN,
        },
      }),
    ).rejects.toThrow("SESSION_FULL");
  });

  it("treats pending draft at 15-minute cutoff as expired for manager capacity and admin booked count", async () => {
    const { session } = await createSessionFixture();
    const [admin, draftClient, activeClient] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Admin Draft Capacity",
          email: `admin.draft.capacity.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          name: "Draft Client",
          email: `draft.client.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Active Client",
          email: `active.client.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
    ]);

    await prisma.studioSession.update({
      where: { id: session.id },
      data: { capacity: 1 },
    });

    await grantCollectiveCredits({ clientId: draftClient.id, amount: 1 });
    await grantCollectiveCredits({ clientId: activeClient.id, amount: 1 });

    const expiredDraftCreatedAt = new Date(Date.now() - 15 * 60 * 1000);
    await prisma.booking.create({
      data: {
        clientId: draftClient.id,
        studioSessionId: session.id,
        status: BookingStatus.PENDING,
        bookingIntent: BookingIntent.USE_PLAN,
        paymentSelection: BookingPaymentSelection.EXISTING_PLAN,
        draftAmountMinor: 0,
        draftCurrencyCode: "EUR",
        customerName: draftClient.name,
        customerEmail: draftClient.email,
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
        consentAcceptedAt: expiredDraftCreatedAt,
        createdAt: expiredDraftCreatedAt,
      },
    });

    const added = await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: activeClient.id,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });
    expect(added.status).toBe(BookingStatus.CONFIRMED);

    const sessions = await getAdminSessionsData({
      weekStart: new Date(session.startsAt.getTime() - 24 * 60 * 60 * 1000),
      weekEnd: new Date(session.startsAt.getTime() + 24 * 60 * 60 * 1000),
    });
    const target = sessions.find((item) => item.id === session.id);
    expect(target?.bookedCount).toBe(1);
  });

  it("treats pending drafts inside hold window as active capacity", async () => {
    const { session } = await createSessionFixture();
    const [admin, draftClient, blockedClient] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Admin Window Capacity",
          email: `admin.window.capacity.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          name: "Draft Window Client",
          email: `draft.window.client.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Blocked Window Client",
          email: `blocked.window.client.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
    ]);

    await prisma.studioSession.update({
      where: { id: session.id },
      data: { capacity: 1 },
    });

    await grantCollectiveCredits({ clientId: draftClient.id, amount: 1 });
    await grantCollectiveCredits({ clientId: blockedClient.id, amount: 1 });

    const activeDraftCreatedAt = new Date(Date.now() - 14 * 60 * 1000);
    await prisma.booking.create({
      data: {
        clientId: draftClient.id,
        studioSessionId: session.id,
        status: BookingStatus.PENDING,
        bookingIntent: BookingIntent.USE_PLAN,
        paymentSelection: BookingPaymentSelection.EXISTING_PLAN,
        draftAmountMinor: 0,
        draftCurrencyCode: "EUR",
        customerName: draftClient.name,
        customerEmail: draftClient.email,
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
        consentAcceptedAt: activeDraftCreatedAt,
        createdAt: activeDraftCreatedAt,
      },
    });

    await expect(
      addSessionAttendeeByManager({
        studioSessionId: session.id,
        clientId: blockedClient.id,
        actor: {
          userId: admin.id,
          role: Role.ADMIN,
        },
      }),
    ).rejects.toThrow("SESSION_FULL");
  });

  it("TEACHER cannot add attendee on unassigned session", async () => {
    const { session } = await createSessionFixture();
    const [client, unassignedTeacher] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Unassigned",
          email: `client.unassigned.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Teacher Unassigned",
          email: `teacher.unassigned.${Date.now()}@example.test`,
          role: Role.TEACHER,
        },
      }),
    ]);

    await expect(
      addSessionAttendeeByManager({
        studioSessionId: session.id,
        clientId: client.id,
        actor: {
          userId: unassignedTeacher.id,
          role: Role.TEACHER,
        },
      }),
    ).rejects.toThrow("TEACHER_SESSION_FORBIDDEN");
  });

  it("shows attendee after add and removes from detail list after removal", async () => {
    const { session } = await createSessionFixture();
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Seven",
          email: `client.seven.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin Four",
          email: `admin.four.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    await grantCollectiveCredits({ clientId: client.id, amount: 1 });

    const addResult = await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: client.id,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    const withAttendee = await getAdminSessionById(session.id);
    expect(withAttendee?.attendees.some((attendee) => attendee.bookingId === addResult.bookingId)).toBe(true);

    await removeSessionAttendeeByManager({
      studioSessionId: session.id,
      bookingId: addResult.bookingId,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    const afterRemoval = await getAdminSessionById(session.id);
    expect(afterRemoval?.attendees.some((attendee) => attendee.bookingId === addResult.bookingId)).toBe(false);
  });

  it("manager cancellation triggers waitlist auto-promotion when a seat opens", async () => {
    const { session } = await createSessionFixture();
    const [admin, bookedClient, waitlistedClient] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Admin Promote",
          email: `admin.promote.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          name: "Booked Client",
          email: `booked.client.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Waitlisted Client",
          email: `waitlisted.client.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
    ]);

    await prisma.studioSession.update({
      where: { id: session.id },
      data: { capacity: 1 },
    });

    await grantCollectiveCredits({ clientId: bookedClient.id, amount: 1 });
    await grantCollectiveCredits({ clientId: waitlistedClient.id, amount: 1 });

    const confirmed = await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: bookedClient.id,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    await prisma.waitlistEntry.create({
      data: {
        clientId: waitlistedClient.id,
        studioSessionId: session.id,
        status: WaitlistStatus.ACTIVE,
        position: 1,
      },
    });

    await removeSessionAttendeeByManager({
      studioSessionId: session.id,
      bookingId: confirmed.bookingId,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    const promotedBooking = await prisma.booking.findFirst({
      where: {
        studioSessionId: session.id,
        clientId: waitlistedClient.id,
        status: BookingStatus.CONFIRMED,
      },
      select: {
        id: true,
      },
    });
    const waitlistEntry = await prisma.waitlistEntry.findFirst({
      where: {
        studioSessionId: session.id,
        clientId: waitlistedClient.id,
      },
      select: {
        status: true,
      },
    });

    expect(promotedBooking?.id).toBeTruthy();
    expect(waitlistEntry?.status).toBe(WaitlistStatus.PROMOTED);
  });

  it("returns selectable clients with credit visibility for the session scope", async () => {
    const { session } = await createSessionFixture();
    const [clientWithCredits, clientWithoutCredits] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Eight",
          email: `client.eight.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Client Nine",
          email: `client.nine.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
    ]);

    await grantCollectiveCredits({ clientId: clientWithCredits.id, amount: 2 });

    const options = await getAdminSessionOptions(session.id);
    const withCredits = options.clients.find((client) => client.id === clientWithCredits.id);
    const withoutCredits = options.clients.find((client) => client.id === clientWithoutCredits.id);

    expect(withCredits?.hasAvailableCredits).toBe(true);
    expect(withCredits?.availableCredits).toBe(2);
    expect(withCredits?.hasEligibleAccess).toBe(true);
    expect(withoutCredits?.hasAvailableCredits).toBe(false);
    expect(withoutCredits?.availableCredits).toBe(0);
    expect(withoutCredits?.hasEligibleAccess).toBe(false);
  });

  it("applies staff attendance transitions and blocks finalized rewrites", async () => {
    const { session } = await createSessionFixture();
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Ten",
          email: `client.ten.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin Five",
          email: `admin.five.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    const booking = await prisma.booking.create({
      data: {
        clientId: client.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        customerName: client.name,
        customerEmail: client.email,
      },
    });

    await markBookingAttendanceByStaff({
      bookingId: booking.id,
      studioSessionId: session.id,
      actorUserId: admin.id,
      targetStatus: AttendanceStatus.CHECKED_IN,
      notes: "Desk check-in",
    });

    await markBookingAttendanceByStaff({
      bookingId: booking.id,
      studioSessionId: session.id,
      actorUserId: admin.id,
      targetStatus: AttendanceStatus.ATTENDED,
    });

    const record = await prisma.attendanceRecord.findUnique({
      where: { bookingId: booking.id },
      select: { status: true, source: true },
    });

    expect(record?.status).toBe(AttendanceStatus.ATTENDED);
    expect(record?.source).toBe(AttendanceSource.DASHBOARD);

    await expect(
      markBookingAttendanceByStaff({
        bookingId: booking.id,
        studioSessionId: session.id,
        actorUserId: admin.id,
        targetStatus: AttendanceStatus.NO_SHOW,
      }),
    ).rejects.toThrow("ATTENDANCE_ALREADY_FINALIZED");
  });
});
