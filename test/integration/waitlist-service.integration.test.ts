import "./helpers/setup-env";
import {
  BillingInterval,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  PriceType,
  ProductType,
  Role,
  StudioSessionStatus,
  SubscriptionStatus,
  WaitlistStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";
import {
  cancelSessionWaitlistEntry,
  joinSessionWaitlist,
  WaitlistServiceError,
} from "../../src/lib/public-booking/waitlist-service";
import { cancelClientBooking } from "../../src/lib/dashboard/dashboard-service";

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

async function createSessionFixture(input: {
  capacity: number;
  categorySlug: string;
  categoryName: string;
  classSlug: string;
  className: string;
}) {
  const category = await createClassCategory(prisma, {
    name: input.categoryName,
    slug: `${input.categorySlug}-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });

  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: input.className,
    slug: `${input.classSlug}-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Teacher Waitlist",
      email: `teacher.waitlist.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: `${input.className} Template`,
      slug: `${input.classSlug}-template-${Date.now()}`,
      defaultCapacity: input.capacity,
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
      title: input.className,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: input.capacity,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
      location: "Studio A",
    },
  });

  return { session };
}

async function grantCollectiveCredits(input: { clientId: string; amount: number }) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const product = await prisma.product.create({
    data: {
      name: `Collective Pack ${unique}`,
      slug: `collective-pack-${unique}`,
      productType: ProductType.CLASS_PACK,
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
      notes: "seed grant",
    },
  });

  return entitlement;
}

async function grantMonthlyUnlimitedSubscription(clientId: string) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const product = await prisma.product.create({
    data: {
      name: `Monthly Unlimited ${unique}`,
      slug: `monthly-unlimited-${unique}`,
      productType: ProductType.UNLIMITED_MEMBERSHIP,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `monthly-unlimited-${unique}-monthly`,
      name: "Monthly",
      priceType: PriceType.RECURRING,
      currencyCode: "EUR",
      unitAmountMinor: 12000,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
      isActive: true,
      isArchived: false,
    },
  });

  await prisma.entitlementRule.create({
    data: {
      productId: product.id,
      entitlementType: EntitlementType.UNLIMITED_ACCESS,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: null,
      isActive: true,
    },
  });

  await prisma.subscriptionContract.create({
    data: {
      clientId,
      productId: product.id,
      priceId: price.id,
      provider: "STRIPE",
      providerSubscriptionReference: `sub_${unique}`,
      status: SubscriptionStatus.ACTIVE,
      startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      currentPeriodStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    },
  });
}

async function createConfirmedBooking(input: {
  clientId: string;
  studioSessionId: string;
  selectedEntitlementId?: string | null;
}) {
  return prisma.booking.create({
    data: {
      clientId: input.clientId,
      studioSessionId: input.studioSessionId,
      status: BookingStatus.CONFIRMED,
      selectedEntitlementId: input.selectedEntitlementId ?? null,
      bookedAt: new Date(),
      customerName: `Client ${input.clientId.slice(-4)}`,
      customerEmail: `client.${input.clientId.slice(-4)}@example.test`,
      customerPhone: "+32000000000",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
    },
  });
}

async function fillSessionToCapacity(sessionId: string, capacity: number) {
  const bookings = [];
  for (let index = 0; index < capacity; index += 1) {
    const client = await createClient(`filled-${index}`);
    const booking = await createConfirmedBooking({
      clientId: client.id,
      studioSessionId: sessionId,
    });
    bookings.push({ client, booking });
  }

  return bookings;
}

async function seedWaitlistPromotionTemplate() {
  await prisma.emailTemplate.upsert({
    where: { templateKey: "waitlist.promotion.confirmed-booking" },
    update: {
      name: "Waitlist Promotion Booking Confirmation",
      category: "BOOKING",
      subjectTemplate: "You're in! Your class booking is now confirmed",
      bodyTemplateJson: {
        blocks: [{ type: "paragraph", text: "Hello {{clientName}}," }],
      },
      contentSchemaVersion: 1,
      isActive: true,
    },
    create: {
      templateKey: "waitlist.promotion.confirmed-booking",
      name: "Waitlist Promotion Booking Confirmation",
      category: "BOOKING",
      subjectTemplate: "You're in! Your class booking is now confirmed",
      bodyTemplateJson: {
        blocks: [{ type: "paragraph", text: "Hello {{clientName}}," }],
      },
      contentSchemaVersion: 1,
      isActive: true,
    },
  });
}

async function seedBookingConfirmationTemplate() {
  await prisma.emailTemplate.upsert({
    where: { templateKey: "booking.class-booked" },
    update: {
      name: "Booking Confirmation",
      category: "BOOKING",
      subjectTemplate: "You're booked for {{booking.classTitle}}",
      bodyTemplateJson: {
        blocks: [{ type: "paragraph", text: "Hello {{clientName}}," }],
      },
      contentSchemaVersion: 1,
      isActive: true,
    },
    create: {
      templateKey: "booking.class-booked",
      name: "Booking Confirmation",
      category: "BOOKING",
      subjectTemplate: "You're booked for {{booking.classTitle}}",
      bodyTemplateJson: {
        blocks: [{ type: "paragraph", text: "Hello {{clientName}}," }],
      },
      contentSchemaVersion: 1,
      isActive: true,
    },
  });
}

describe("waitlist runtime integration", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.EMAIL_FROM = process.env.EMAIL_FROM || "Test <test@example.test>";
    await Promise.all([seedWaitlistPromotionTemplate(), seedBookingConfirmationTemplate()]);
  });

  it("joins and cancels waitlist for a full collective class without consuming credit", async () => {
    const { session } = await createSessionFixture({
      capacity: 4,
      categorySlug: "collective",
      categoryName: "Collective",
      classSlug: "collective-yoga",
      className: "Collective Yoga",
    });
    await fillSessionToCapacity(session.id, 4);

    const client = await createClient("waitlist-client");
    const entitlement = await grantCollectiveCredits({ clientId: client.id, amount: 2 });

    const beforeLedger = await prisma.creditLedgerEntry.count({
      where: {
        clientId: client.id,
        entitlementId: entitlement.id,
      },
    });

    const joined = await joinSessionWaitlist({
      clientId: client.id,
      studioSessionId: session.id,
    });
    expect(joined.waitlistEntryId).toBeTruthy();

    const waitlistEntry = await prisma.waitlistEntry.findUnique({
      where: { id: joined.waitlistEntryId },
      select: { status: true, position: true },
    });
    expect(waitlistEntry?.status).toBe(WaitlistStatus.ACTIVE);
    expect(waitlistEntry?.position).toBe(1);

    const afterJoinLedger = await prisma.creditLedgerEntry.count({
      where: {
        clientId: client.id,
        entitlementId: entitlement.id,
      },
    });
    expect(afterJoinLedger).toBe(beforeLedger);

    await cancelSessionWaitlistEntry({
      clientId: client.id,
      waitlistEntryId: joined.waitlistEntryId,
    });

    const cancelledEntry = await prisma.waitlistEntry.findUnique({
      where: { id: joined.waitlistEntryId },
      select: { status: true },
    });
    expect(cancelledEntry?.status).toBe(WaitlistStatus.CANCELLED);

    const cancelAudit = await prisma.auditLog.findFirst({
      where: {
        actionType: "WAITLIST_CANCEL",
        entityId: joined.waitlistEntryId,
      },
    });
    expect(cancelAudit).not.toBeNull();
  });

  it("enforces collective-only waitlist and half-capacity limit", async () => {
    const privateFixture = await createSessionFixture({
      capacity: 4,
      categorySlug: "private-classes",
      categoryName: "Private Classes",
      classSlug: "private-pilates",
      className: "Private Pilates",
    });
    await fillSessionToCapacity(privateFixture.session.id, 4);

    const privateClient = await createClient("private-waitlist");
    await expect(
      joinSessionWaitlist({
        clientId: privateClient.id,
        studioSessionId: privateFixture.session.id,
      }),
    ).rejects.toMatchObject<Partial<WaitlistServiceError>>({
      code: "WAITLIST_NOT_SUPPORTED",
    });

    const collectiveFixture = await createSessionFixture({
      capacity: 5,
      categorySlug: "collective",
      categoryName: "Collective",
      classSlug: "collective-pilates",
      className: "Collective Pilates",
    });
    await fillSessionToCapacity(collectiveFixture.session.id, 5);

    const [c1, c2, c3] = await Promise.all([
      createClient("limit-1"),
      createClient("limit-2"),
      createClient("limit-3"),
    ]);

    await joinSessionWaitlist({ clientId: c1.id, studioSessionId: collectiveFixture.session.id });
    await joinSessionWaitlist({ clientId: c2.id, studioSessionId: collectiveFixture.session.id });

    await expect(
      joinSessionWaitlist({ clientId: c3.id, studioSessionId: collectiveFixture.session.id }),
    ).rejects.toMatchObject<Partial<WaitlistServiceError>>({
      code: "WAITLIST_FULL",
    });
  });

  it("promotes waitlist clients using FIFO after cancellation", async () => {
    await prisma.emailTemplate.upsert({
      where: { templateKey: "waitlist.promotion.confirmed-booking" },
      update: {
        name: "Custom Waitlist Name",
        category: "BOOKING",
        subjectTemplate: "Custom waitlist subject",
        bodyTemplateJson: {
          blocks: [{ type: "paragraph", text: "Custom waitlist body {{clientName}}" }],
        },
        contentSchemaVersion: 1,
        isActive: true,
      },
      create: {
        templateKey: "waitlist.promotion.confirmed-booking",
        name: "Custom Waitlist Name",
        category: "BOOKING",
        subjectTemplate: "Custom waitlist subject",
        bodyTemplateJson: {
          blocks: [{ type: "paragraph", text: "Custom waitlist body {{clientName}}" }],
        },
        contentSchemaVersion: 1,
        isActive: true,
      },
    });

    const { session } = await createSessionFixture({
      capacity: 4,
      categorySlug: "collective",
      categoryName: "Collective",
      classSlug: "collective-cardio",
      className: "Collective Cardio",
    });
    const fillers = await fillSessionToCapacity(session.id, 4);

    const waitlistFirst = await createClient("fifo-first");
    const waitlistSecond = await createClient("fifo-second");
    const firstEntitlement = await grantCollectiveCredits({ clientId: waitlistFirst.id, amount: 1 });
    await grantCollectiveCredits({ clientId: waitlistSecond.id, amount: 1 });

    const first = await joinSessionWaitlist({
      clientId: waitlistFirst.id,
      studioSessionId: session.id,
    });
    const second = await joinSessionWaitlist({
      clientId: waitlistSecond.id,
      studioSessionId: session.id,
    });

    const bookingToCancel = fillers[0]?.booking;
    expect(bookingToCancel).toBeDefined();
    await cancelClientBooking({
      bookingId: bookingToCancel!.id,
      clientId: bookingToCancel!.clientId!,
    });

    const firstEntry = await prisma.waitlistEntry.findUnique({
      where: { id: first.waitlistEntryId },
      select: { status: true },
    });
    const secondEntry = await prisma.waitlistEntry.findUnique({
      where: { id: second.waitlistEntryId },
      select: { status: true },
    });

    expect(firstEntry?.status).toBe(WaitlistStatus.PROMOTED);
    expect(secondEntry?.status).toBe(WaitlistStatus.ACTIVE);

    const promotedBooking = await prisma.booking.findFirst({
      where: {
        clientId: waitlistFirst.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
      },
      select: { id: true, selectedEntitlementId: true },
    });
    expect(promotedBooking?.id).toBeTruthy();
    expect(promotedBooking?.selectedEntitlementId).toBe(firstEntitlement.id);

    const consumeLedger = await prisma.creditLedgerEntry.findFirst({
      where: {
        clientId: waitlistFirst.id,
        entryType: CreditLedgerEntryType.CONSUME,
        bookingId: promotedBooking?.id,
      },
    });
    expect(consumeLedger).not.toBeNull();

    const outboxEvent = await prisma.emailAutomationEvent.findFirst({
      where: {
        recipientEmail: waitlistFirst.email.toLowerCase(),
        idempotencyKey: `waitlist-promotion:${first.waitlistEntryId}:${promotedBooking?.id}`,
      },
      select: {
        payloadJson: true,
        template: { select: { templateKey: true } },
      },
    });
    expect(outboxEvent?.template.templateKey).toBe("waitlist.promotion.confirmed-booking");
    expect(outboxEvent?.payloadJson).toMatchObject({
      clientName: waitlistFirst.name,
      sessionTitle: session.title,
      locationLabel: "Studio A",
      waitlistEntryId: first.waitlistEntryId,
      bookingId: promotedBooking?.id,
    });
    expect((outboxEvent?.payloadJson as { dateTimeLabel?: unknown } | null)?.dateTimeLabel).toEqual(expect.any(String));

    const templateAfter = await prisma.emailTemplate.findUnique({
      where: { templateKey: "waitlist.promotion.confirmed-booking" },
      select: {
        name: true,
        subjectTemplate: true,
        bodyTemplateJson: true,
      },
    });
    expect(templateAfter).toMatchObject({
      name: "Custom Waitlist Name",
      subjectTemplate: "Custom waitlist subject",
      bodyTemplateJson: {
        blocks: [{ type: "paragraph", text: "Custom waitlist body {{clientName}}" }],
      },
    });
  });

  it("preserves cancelled history and creates a new booking during waitlist promotion", async () => {
    const { session } = await createSessionFixture({
      capacity: 2,
      categorySlug: "collective",
      categoryName: "Collective",
      classSlug: "collective-rebook",
      className: "Collective Rebook",
    });
    const fillers = await fillSessionToCapacity(session.id, 2);

    const waitlistedClient = await createClient("cancelled-history");
    const entitlement = await grantCollectiveCredits({ clientId: waitlistedClient.id, amount: 1 });
    const cancelledBooking = await prisma.booking.create({
      data: {
        clientId: waitlistedClient.id,
        studioSessionId: session.id,
        status: BookingStatus.CANCELLED,
        selectedEntitlementId: entitlement.id,
        bookedAt: new Date(Date.now() - 60 * 60 * 1000),
        cancelledAt: new Date(Date.now() - 30 * 60 * 1000),
        cancellationReason: "Client cancelled before joining waitlist.",
        customerName: waitlistedClient.name,
        customerEmail: waitlistedClient.email,
        customerPhone: "+32000000000",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
        consentAcceptedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
      select: { id: true },
    });

    const joined = await joinSessionWaitlist({
      clientId: waitlistedClient.id,
      studioSessionId: session.id,
    });

    await cancelClientBooking({
      bookingId: fillers[0]!.booking.id,
      clientId: fillers[0]!.booking.clientId!,
    });

    const promotedEntry = await prisma.waitlistEntry.findUnique({
      where: { id: joined.waitlistEntryId },
      select: { status: true },
    });
    expect(promotedEntry?.status).toBe(WaitlistStatus.PROMOTED);

    const bookings = await prisma.booking.findMany({
      where: {
        clientId: waitlistedClient.id,
        studioSessionId: session.id,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true, cancelledAt: true },
    });

    expect(bookings).toHaveLength(2);
    expect(bookings[0]?.id).toBe(cancelledBooking.id);
    expect(bookings[0]?.status).toBe(BookingStatus.CANCELLED);
    expect(bookings[0]?.cancelledAt).not.toBeNull();
    expect(bookings[1]?.id).not.toBe(cancelledBooking.id);
    expect(bookings[1]?.status).toBe(BookingStatus.CONFIRMED);
  });

  it("expires stale pending history before waitlist promotion creates a new booking", async () => {
    const { session } = await createSessionFixture({
      capacity: 2,
      categorySlug: "collective",
      categoryName: "Collective",
      classSlug: "collective-stale-pending",
      className: "Collective Stale Pending",
    });
    const fillers = await fillSessionToCapacity(session.id, 2);

    const waitlistedClient = await createClient("stale-pending-history");
    await grantCollectiveCredits({ clientId: waitlistedClient.id, amount: 1 });
    const stalePending = await prisma.booking.create({
      data: {
        clientId: waitlistedClient.id,
        studioSessionId: session.id,
        status: BookingStatus.PENDING,
        bookedAt: new Date(Date.now() - 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        customerName: waitlistedClient.name,
        customerEmail: waitlistedClient.email,
        customerPhone: "+32000000000",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
        consentAcceptedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
      select: { id: true },
    });

    const joined = await joinSessionWaitlist({
      clientId: waitlistedClient.id,
      studioSessionId: session.id,
    });

    await cancelClientBooking({
      bookingId: fillers[0]!.booking.id,
      clientId: fillers[0]!.booking.clientId!,
    });

    const promotedEntry = await prisma.waitlistEntry.findUnique({
      where: { id: joined.waitlistEntryId },
      select: { status: true },
    });
    expect(promotedEntry?.status).toBe(WaitlistStatus.PROMOTED);

    const bookings = await prisma.booking.findMany({
      where: {
        clientId: waitlistedClient.id,
        studioSessionId: session.id,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true },
    });

    expect(bookings).toHaveLength(2);
    expect(bookings[0]).toEqual({ id: stalePending.id, status: BookingStatus.EXPIRED });
    expect(bookings[1]?.id).not.toBe(stalePending.id);
    expect(bookings[1]?.status).toBe(BookingStatus.CONFIRMED);
  });

  it("ignores completed and no-show history during waitlist promotion", async () => {
    const { session } = await createSessionFixture({
      capacity: 2,
      categorySlug: "collective",
      categoryName: "Collective",
      classSlug: "collective-attendance-history",
      className: "Collective Attendance History",
    });
    const fillers = await fillSessionToCapacity(session.id, 2);

    const waitlistedClient = await createClient("attendance-history");
    await grantCollectiveCredits({ clientId: waitlistedClient.id, amount: 1 });
    await prisma.booking.createMany({
      data: [
        {
          clientId: waitlistedClient.id,
          studioSessionId: session.id,
          status: BookingStatus.COMPLETED,
          customerName: waitlistedClient.name,
          customerEmail: waitlistedClient.email,
          customerPhone: "+32000000000",
          consentTermsAccepted: true,
          consentPrivacyAccepted: true,
          consentAcceptedAt: new Date(),
        },
        {
          clientId: waitlistedClient.id,
          studioSessionId: session.id,
          status: BookingStatus.NO_SHOW,
          customerName: waitlistedClient.name,
          customerEmail: waitlistedClient.email,
          customerPhone: "+32000000000",
          consentTermsAccepted: true,
          consentPrivacyAccepted: true,
          consentAcceptedAt: new Date(),
        },
      ],
    });

    const joined = await joinSessionWaitlist({
      clientId: waitlistedClient.id,
      studioSessionId: session.id,
    });

    await cancelClientBooking({
      bookingId: fillers[0]!.booking.id,
      clientId: fillers[0]!.booking.clientId!,
    });

    const promotedEntry = await prisma.waitlistEntry.findUnique({
      where: { id: joined.waitlistEntryId },
      select: { status: true },
    });
    expect(promotedEntry?.status).toBe(WaitlistStatus.PROMOTED);

    const statuses = await prisma.booking.findMany({
      where: {
        clientId: waitlistedClient.id,
        studioSessionId: session.id,
      },
      orderBy: { createdAt: "asc" },
      select: { status: true },
    });

    expect(statuses.map((booking) => booking.status)).toEqual(
      expect.arrayContaining([
        BookingStatus.COMPLETED,
        BookingStatus.NO_SHOW,
        BookingStatus.CONFIRMED,
      ]),
    );
    expect(statuses).toHaveLength(3);
  });

  it("removes ineligible first waitlist client and promotes next eligible client", async () => {
    const { session } = await createSessionFixture({
      capacity: 4,
      categorySlug: "collective",
      categoryName: "Collective",
      classSlug: "collective-strength",
      className: "Collective Strength",
    });
    const fillers = await fillSessionToCapacity(session.id, 4);

    const ineligibleClient = await createClient("ineligible-first");
    const eligibleClient = await createClient("eligible-second");
    await grantCollectiveCredits({ clientId: eligibleClient.id, amount: 1 });

    const first = await joinSessionWaitlist({
      clientId: ineligibleClient.id,
      studioSessionId: session.id,
    });
    const second = await joinSessionWaitlist({
      clientId: eligibleClient.id,
      studioSessionId: session.id,
    });

    const bookingToCancel = fillers[0]?.booking;
    expect(bookingToCancel).toBeDefined();
    await cancelClientBooking({
      bookingId: bookingToCancel!.id,
      clientId: bookingToCancel!.clientId!,
    });

    const [firstEntry, secondEntry] = await Promise.all([
      prisma.waitlistEntry.findUnique({
        where: { id: first.waitlistEntryId },
        select: { status: true },
      }),
      prisma.waitlistEntry.findUnique({
        where: { id: second.waitlistEntryId },
        select: { status: true },
      }),
    ]);

    expect(firstEntry?.status).toBe(WaitlistStatus.CANCELLED);
    expect(secondEntry?.status).toBe(WaitlistStatus.PROMOTED);

    const skippedAudit = await prisma.auditLog.findFirst({
      where: {
        actionType: "WAITLIST_PROMOTION_SKIPPED",
        entityId: first.waitlistEntryId,
      },
    });
    expect(skippedAudit).not.toBeNull();
  });

  it("promotes Monthly Unlimited clients without consuming credits", async () => {
    const { session } = await createSessionFixture({
      capacity: 2,
      categorySlug: "collective",
      categoryName: "Collective",
      classSlug: "collective-flow",
      className: "Collective Flow",
    });
    const fillers = await fillSessionToCapacity(session.id, 2);

    const unlimitedClient = await createClient("unlimited-client");
    await grantMonthlyUnlimitedSubscription(unlimitedClient.id);

    const joined = await joinSessionWaitlist({
      clientId: unlimitedClient.id,
      studioSessionId: session.id,
    });

    const bookingToCancel = fillers[0]?.booking;
    await cancelClientBooking({
      bookingId: bookingToCancel!.id,
      clientId: bookingToCancel!.clientId!,
    });

    const promotedEntry = await prisma.waitlistEntry.findUnique({
      where: { id: joined.waitlistEntryId },
      select: { status: true },
    });
    expect(promotedEntry?.status).toBe(WaitlistStatus.PROMOTED);

    const promotedBooking = await prisma.booking.findFirst({
      where: {
        clientId: unlimitedClient.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
      },
      select: {
        id: true,
        selectedEntitlementId: true,
      },
    });
    expect(promotedBooking?.id).toBeTruthy();

    const consumedCredits = await prisma.creditLedgerEntry.count({
      where: {
        clientId: unlimitedClient.id,
        entryType: CreditLedgerEntryType.CONSUME,
        bookingId: promotedBooking?.id,
      },
    });
    expect(consumedCredits).toBe(0);
  });

  it("keeps promotion duplicate-safe under concurrent cancellations", async () => {
    const { session } = await createSessionFixture({
      capacity: 2,
      categorySlug: "collective",
      categoryName: "Collective",
      classSlug: "collective-safe",
      className: "Collective Safe",
    });
    const fillers = await fillSessionToCapacity(session.id, 2);

    const waitlistedClient = await createClient("duplicate-safe");
    await grantCollectiveCredits({ clientId: waitlistedClient.id, amount: 1 });
    const joined = await joinSessionWaitlist({
      clientId: waitlistedClient.id,
      studioSessionId: session.id,
    });

    await Promise.all([
      cancelClientBooking({
        bookingId: fillers[0]!.booking.id,
        clientId: fillers[0]!.booking.clientId!,
      }),
      cancelClientBooking({
        bookingId: fillers[1]!.booking.id,
        clientId: fillers[1]!.booking.clientId!,
      }),
    ]);

    const promotedBookings = await prisma.booking.findMany({
      where: {
        clientId: waitlistedClient.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
      },
      select: { id: true },
    });
    expect(promotedBookings).toHaveLength(1);

    const promotedEntry = await prisma.waitlistEntry.findUnique({
      where: { id: joined.waitlistEntryId },
      select: { status: true },
    });
    expect(promotedEntry?.status).toBe(WaitlistStatus.PROMOTED);

    const consumeEntries = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: waitlistedClient.id,
        bookingId: promotedBookings[0]?.id,
        entryType: CreditLedgerEntryType.CONSUME,
      },
    });
    expect(consumeEntries).toHaveLength(1);

    const waitlistEmailOutboxCount = await prisma.emailAutomationEvent.count({
      where: {
        recipientEmail: waitlistedClient.email.toLowerCase(),
        idempotencyKey: `waitlist-promotion:${joined.waitlistEntryId}:${promotedBookings[0]?.id}`,
      },
    });
    const bookingConfirmationOutboxCount = await prisma.emailAutomationEvent.count({
      where: {
        recipientEmail: waitlistedClient.email.toLowerCase(),
        idempotencyKey: `booking-confirmation:${promotedBookings[0]?.id}:confirmed-v1`,
      },
    });
    expect(waitlistEmailOutboxCount).toBe(1);
    expect(bookingConfirmationOutboxCount).toBe(1);
  });

  it("cancellation still succeeds when enqueue-failure audit logging also fails", async () => {
    const { session } = await createSessionFixture({
      capacity: 2,
      categorySlug: "collective",
      categoryName: "Collective",
      classSlug: "collective-audit-failure",
      className: "Collective Audit Failure",
    });
    const fillers = await fillSessionToCapacity(session.id, 2);

    const waitlistedClient = await createClient("audit-failure");
    await grantCollectiveCredits({ clientId: waitlistedClient.id, amount: 1 });
    const joined = await joinSessionWaitlist({
      clientId: waitlistedClient.id,
      studioSessionId: session.id,
    });

    await prisma.emailTemplate.delete({
      where: { templateKey: "waitlist.promotion.confirmed-booking" },
    });

    const originalAuditCreate = prisma.auditLog.create.bind(prisma.auditLog);
    const auditSpy = vi.spyOn(prisma.auditLog, "create").mockImplementation(async (args) => {
      const actionType = (args as { data?: { actionType?: string } })?.data?.actionType;
      if (actionType === "WAITLIST_PROMOTION_EMAIL_ENQUEUE_FAILED") {
        throw new Error("forced-audit-write-failure");
      }
      return originalAuditCreate(args as never);
    });

    const bookingToCancel = fillers[0]!.booking;
    await expect(
      cancelClientBooking({
        bookingId: bookingToCancel.id,
        clientId: bookingToCancel.clientId!,
      }),
    ).resolves.toBeUndefined();

    const cancelledBooking = await prisma.booking.findUnique({
      where: { id: bookingToCancel.id },
      select: { status: true },
    });
    expect(cancelledBooking?.status).toBe(BookingStatus.CANCELLED);

    const promotedEntry = await prisma.waitlistEntry.findUnique({
      where: { id: joined.waitlistEntryId },
      select: { status: true },
    });
    expect(promotedEntry?.status).toBe(WaitlistStatus.PROMOTED);

    auditSpy.mockRestore();
  });
});
