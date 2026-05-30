import "./helpers/setup-env";
import { hash } from "bcryptjs";
import {
  BillingInterval,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  OrderStatus,
  PaymentProvider,
  PriceType,
  ProductType,
  Role,
  StudioSessionStatus,
  StripeWebhookReceiptStatus,
  SubscriptionStatus,
  WaitlistStatus,
  AttendanceSource,
  AttendanceStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelClientBooking,
  cancelClientWaitlistEntry,
  DashboardServiceError,
  getClientActivityPage,
  getClientStoreOrderHistory,
  getClientSubscriptionRecoveryState,
  getDashboardBookingsData,
  getDashboardHomeData,
  getDashboardLoyaltyPlaceholder,
  getDashboardMembershipData,
  updateDashboardProfile,
} from "../../src/lib/dashboard/dashboard-service";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

async function createSessionFixture(
  clientId: string,
  options?: {
    startsInHours?: number;
  },
) {
  const category = await createClassCategory(prisma, {
    name: "Yoga",
    slug: `yoga-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Hatha Yoga",
    slug: `hatha-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Teacher",
      email: `teacher.dashboard.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Hatha Session",
      slug: `hatha-template-${Date.now()}`,
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const startsInHours = options?.startsInHours ?? 72;
  const startsAt = new Date(Date.now() + startsInHours * 60 * 60 * 1000);

  const studioSession = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Hatha Yoga",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const entitlementProduct = await prisma.product.create({
    data: {
      name: "10-Class Pack",
      slug: `pack-${Date.now()}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const entitlement = await prisma.clientEntitlement.create({
    data: {
      clientId,
      productId: entitlementProduct.id,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      status: ClientEntitlementStatus.ACTIVE,
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.creditLedgerEntry.create({
    data: {
      clientId,
      entitlementId: entitlement.id,
      entryType: CreditLedgerEntryType.GRANT,
      amount: 10,
      notes: "Seed grant",
    },
  });

  const booking = await prisma.booking.create({
    data: {
      clientId,
      studioSessionId: studioSession.id,
      status: BookingStatus.CONFIRMED,
      selectedEntitlementId: entitlement.id,
      bookedAt: new Date(),
      customerName: "Client",
      customerEmail: "client@example.test",
      customerPhone: "+32000000000",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
    },
  });

  await prisma.creditLedgerEntry.create({
    data: {
      clientId,
      entitlementId: entitlement.id,
      bookingId: booking.id,
      entryType: CreditLedgerEntryType.CONSUME,
      amount: -1,
      notes: "Seed consume",
    },
  });

  return { booking, entitlement };
}

async function createCollectiveWaitlistFixture(clientId: string) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const category = await createClassCategory(prisma, {
    name: "Collective",
    slug: `collective-${unique}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Collective Waitlist",
    slug: `collective-waitlist-${unique}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Waitlist Teacher",
      email: `teacher.waitlist.${unique}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Collective Waitlist Template",
      slug: `collective-waitlist-template-${unique}`,
      defaultCapacity: 2,
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
      title: "Collective Waitlist Class",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 2,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
      location: "Room B",
    },
  });

  const fillerOne = await prisma.user.create({
    data: {
      name: `Filler One ${unique}`,
      email: `filler.one.${unique}@example.test`,
      role: Role.CLIENT,
    },
  });
  const fillerTwo = await prisma.user.create({
    data: {
      name: `Filler Two ${unique}`,
      email: `filler.two.${unique}@example.test`,
      role: Role.CLIENT,
    },
  });

  await prisma.booking.createMany({
    data: [
      {
        clientId: fillerOne.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        customerName: fillerOne.name,
        customerEmail: fillerOne.email,
      },
      {
        clientId: fillerTwo.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        customerName: fillerTwo.name,
        customerEmail: fillerTwo.email,
      },
    ],
  });

  const waitlistEntry = await prisma.waitlistEntry.create({
    data: {
      clientId,
      studioSessionId: session.id,
      status: WaitlistStatus.ACTIVE,
      position: 1,
      joinedAt: new Date(),
    },
  });

  return { waitlistEntry, session };
}

describe("dashboard-service integration", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "test-resend-key";
    process.env.EMAIL_FROM = process.env.EMAIL_FROM || "Test <test@example.test>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: "email_1" }, { status: 200 })),
    );
  });

  it("cancels eligible future booking and restores credit", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Client User",
        firstName: "Client",
        lastName: "User",
        email: `client.dashboard.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const { booking, entitlement } = await createSessionFixture(client.id);
    await cancelClientBooking({ bookingId: booking.id, clientId: client.id });

    const updatedBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
      select: { status: true, creditRefundedAt: true },
    });
    const restoreEntries = await prisma.creditLedgerEntry.findMany({
      where: {
        bookingId: booking.id,
        entitlementId: entitlement.id,
        entryType: CreditLedgerEntryType.RESTORE,
      },
    });
    const cancellationOutboxEvents = await prisma.emailAutomationEvent.findMany({
      where: {
        idempotencyKey: `booking-cancelled:${booking.id}:cancelled-v1`,
      },
      select: {
        template: { select: { templateKey: true } },
      },
    });

    expect(updatedBooking?.status).toBe(BookingStatus.CANCELLED);
    expect(updatedBooking?.creditRefundedAt).not.toBeNull();
    expect(restoreEntries).toHaveLength(1);
    expect(restoreEntries[0]?.amount).toBe(1);
    expect(cancellationOutboxEvents).toHaveLength(1);
    expect(cancellationOutboxEvents[0]?.template.templateKey).toBe("booking.class-cancelled");
  });

  it("rejects cancellation when it is past cutoff", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Late Client",
        firstName: "Late",
        lastName: "Client",
        email: `late.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const { booking } = await createSessionFixture(client.id, { startsInHours: 2 });

    await expect(
      cancelClientBooking({ bookingId: booking.id, clientId: client.id }),
    ).rejects.toMatchObject<Partial<DashboardServiceError>>({
      code: "BOOKING_TOO_LATE_TO_CANCEL",
    });
  });

  it("rejects cancellation after the booking has an attendance record", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Checked In Client",
        firstName: "Checked",
        lastName: "In",
        email: `checkedin.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const { booking } = await createSessionFixture(client.id, { startsInHours: 26 });

    await prisma.attendanceRecord.create({
      data: {
        bookingId: booking.id,
        status: AttendanceStatus.CHECKED_IN,
        source: AttendanceSource.DASHBOARD,
        markedById: client.id,
      },
    });

    await expect(
      cancelClientBooking({ bookingId: booking.id, clientId: client.id }),
    ).rejects.toMatchObject<Partial<DashboardServiceError>>({
      code: "BOOKING_ALREADY_CHECKED_IN",
    });
  });

  it("marks booking as self check-in eligible when session is within check-in window", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Checkin Eligible Client",
        firstName: "Checkin",
        lastName: "Eligible",
        email: `checkin.eligible.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createSessionFixture(client.id, { startsInHours: 0.08 });
    const bookings = await getDashboardBookingsData(client.id);

    expect(bookings.upcoming).toHaveLength(1);
    expect(bookings.upcoming[0]?.canCheckIn).toBe(true);
    expect(bookings.upcoming[0]?.checkInBlockedReason).toBeNull();
    expect(bookings.upcoming[0]?.isCheckedIn).toBe(false);
  });

  it("marks dashboard self check-in blocked outside window with configured site timezone", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Checkin Blocked Client",
        firstName: "Checkin",
        lastName: "Blocked",
        email: `checkin.blocked.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await prisma.siteSettings.create({
      data: {
        scope: "GLOBAL",
        timeZone: "America/New_York",
      },
    });
    await createSessionFixture(client.id, { startsInHours: 1 });

    const bookings = await getDashboardBookingsData(client.id);

    expect(bookings.upcoming).toHaveLength(1);
    expect(bookings.upcoming[0]?.canCheckIn).toBe(false);
    expect(bookings.upcoming[0]?.checkInBlockedReason).toBe("Outside check-in window");
  });

  it("marks booking as already checked in when attendance record exists", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Already Checked Client",
        firstName: "Already",
        lastName: "Checked",
        email: `already.checked.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const { booking } = await createSessionFixture(client.id, { startsInHours: 0.08 });

    await prisma.attendanceRecord.create({
      data: {
        bookingId: booking.id,
        status: AttendanceStatus.CHECKED_IN,
        source: AttendanceSource.KIOSK,
        markedById: client.id,
      },
    });

    const bookings = await getDashboardBookingsData(client.id);

    expect(bookings.upcoming).toHaveLength(1);
    expect(bookings.upcoming[0]?.canCheckIn).toBe(false);
    expect(bookings.upcoming[0]?.isCheckedIn).toBe(true);
    expect(bookings.upcoming[0]?.checkInBlockedReason).toBe("Already checked in");
  });

  it("marks booking as cancellable when start is more than 24 hours away", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Eligible Client",
        firstName: "Eligible",
        lastName: "Client",
        email: `eligible.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createSessionFixture(client.id, { startsInHours: 26 });
    const bookings = await getDashboardBookingsData(client.id);

    expect(bookings.upcoming).toHaveLength(1);
    expect(bookings.upcoming[0]?.canCancel).toBe(true);
    expect(bookings.upcoming[0]?.cancellationBlockedReason).toBeNull();
  });

  it("marks booking as not cancellable when start is within 24 hours", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Window Client",
        firstName: "Window",
        lastName: "Client",
        email: `window.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createSessionFixture(client.id, { startsInHours: 6 });
    const bookings = await getDashboardBookingsData(client.id);

    expect(bookings.upcoming).toHaveLength(1);
    expect(bookings.upcoming[0]?.canCancel).toBe(false);
    expect(bookings.upcoming[0]?.cancellationBlockedReason).toMatch(/less than 24 hour/i);
  });

  it("falls back to 24-hour cancellation window when config row is missing", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Fallback Client",
        firstName: "Fallback",
        lastName: "Client",
        email: `fallback.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await prisma.bookingPolicy.deleteMany({ where: { scope: "GLOBAL" } });
    await createSessionFixture(client.id, { startsInHours: 23 });

    const bookings = await getDashboardBookingsData(client.id);

    expect(bookings.upcoming).toHaveLength(1);
    expect(bookings.upcoming[0]?.canCancel).toBe(false);
    expect(bookings.upcoming[0]?.cancellationBlockedReason).toMatch(/less than 24 hour/i);
  });

  it("does not surface expired future drafts as active dashboard bookings", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Expired Draft Client",
        firstName: "Expired",
        lastName: "Draft",
        email: `expired.draft.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const { booking } = await createSessionFixture(client.id, { startsInHours: 72 });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.EXPIRED },
    });

    const bookings = await getDashboardBookingsData(client.id);

    expect(bookings.upcoming).toHaveLength(0);
    expect(bookings.past).toHaveLength(0);
    expect(bookings.cancelled).toHaveLength(0);
  });

  it("rejects client cancellation for expired draft history", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Expired Cancel Client",
        firstName: "Expired",
        lastName: "Cancel",
        email: `expired.cancel.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const { booking } = await createSessionFixture(client.id, { startsInHours: 72 });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.EXPIRED },
    });

    await expect(
      cancelClientBooking({ bookingId: booking.id, clientId: client.id }),
    ).rejects.toMatchObject<Partial<DashboardServiceError>>({
      code: "BOOKING_NOT_CANCELLABLE",
    });

    const unchanged = await prisma.booking.findUnique({
      where: { id: booking.id },
      select: { status: true, cancelledAt: true },
    });
    expect(unchanged?.status).toBe(BookingStatus.EXPIRED);
    expect(unchanged?.cancelledAt).toBeNull();
  });
  it("updates profile and enforces verified email change flow", async () => {
    const userOne = await prisma.user.create({
      data: {
        name: "User One",
        firstName: "User",
        lastName: "One",
        email: `user.one.${Date.now()}@example.test`,
        role: Role.CLIENT,
        passwordHash: await hash("Password123!", 12),
        emailVerified: new Date(),
        emailVerifiedAt: new Date(),
      },
    });
    const userTwo = await prisma.user.create({
      data: {
        name: "User Two",
        firstName: "User",
        lastName: "Two",
        email: `user.two.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await updateDashboardProfile(userOne.id, {
      firstName: "Updated",
      lastName: "Name",
      email: userOne.email,
      phone: "+32000000001",
    });

    const updated = await prisma.user.findUnique({
      where: { id: userOne.id },
      select: {
        firstName: true,
        lastName: true,
        name: true,
        email: true,
        pendingEmail: true,
        clientProfile: { select: { phone: true } },
      },
    });
    expect(updated?.firstName).toBe("Updated");
    expect(updated?.lastName).toBe("Name");
    expect(updated?.name).toBe("Updated Name");
    expect(updated?.email).toBe(userOne.email);
    expect(updated?.pendingEmail).toBeNull();
    expect(updated?.clientProfile?.phone).toBe("+32000000001");

    await expect(
      updateDashboardProfile(userOne.id, {
        firstName: "Updated",
        lastName: "Name",
        email: userTwo.email,
        phone: "",
        currentPasswordForEmailChange: "Password123!",
        appUrl: "http://localhost:3000",
      }),
    ).rejects.toMatchObject<Partial<DashboardServiceError>>({
      code: "EMAIL_ALREADY_IN_USE",
    });

    const newEmail = `user.one.changed.${Date.now()}@example.test`;
    const result = await updateDashboardProfile(userOne.id, {
      firstName: "Updated",
      lastName: "Name",
      email: newEmail,
      phone: "+32000000001",
      currentPasswordForEmailChange: "Password123!",
      appUrl: "http://localhost:3000",
    });

    expect(result.emailChangeRequested).toBe(true);

    const pending = await prisma.user.findUnique({
      where: { id: userOne.id },
      select: {
        email: true,
        pendingEmail: true,
        pendingEmailTokenHash: true,
        pendingEmailTokenExpiresAt: true,
      },
    });
    expect(pending?.email).toBe(userOne.email);
    expect(pending?.pendingEmail).toBe(newEmail);
    expect(pending?.pendingEmailTokenHash).toBeTruthy();
    expect(pending?.pendingEmailTokenExpiresAt).not.toBeNull();
  });

  it("returns dashboard home summary with upcoming booking and credits", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Dashboard Client",
        firstName: "Dashboard",
        lastName: "Client",
        email: `dashboard.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createSessionFixture(client.id);
    const home = await getDashboardHomeData(client.id);

    expect(home.userName).toBe("Dashboard");
    expect(home.nextUpcomingBooking).not.toBeNull();
    expect(home.recentBookings.length).toBeGreaterThan(0);
    expect(home.creditsLeft).toBe(9);
  });

  it("returns active waitlist entries in dashboard bookings data", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Waitlist Dashboard",
        firstName: "Waitlist",
        lastName: "Dashboard",
        email: `waitlist.dashboard.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const { waitlistEntry, session } = await createCollectiveWaitlistFixture(client.id);

    const bookings = await getDashboardBookingsData(client.id);

    expect(bookings.waitlist).toHaveLength(1);
    expect(bookings.waitlist[0]?.waitlistEntryId).toBe(waitlistEntry.id);
    expect(bookings.waitlist[0]?.serviceTitle).toBe(session.title);
    expect(bookings.waitlist[0]?.location).toBe(session.location);
  });

  it("cancels waitlist entry from dashboard service path", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Waitlist Cancel",
        firstName: "Waitlist",
        lastName: "Cancel",
        email: `waitlist.cancel.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const { waitlistEntry } = await createCollectiveWaitlistFixture(client.id);

    await cancelClientWaitlistEntry({
      clientId: client.id,
      waitlistEntryId: waitlistEntry.id,
    });

    const updatedEntry = await prisma.waitlistEntry.findUnique({
      where: { id: waitlistEntry.id },
      select: { status: true },
    });
    expect(updatedEntry?.status).toBe(WaitlistStatus.CANCELLED);

    const bookings = await getDashboardBookingsData(client.id);
    expect(bookings.waitlist).toHaveLength(0);
  });

  it("keeps dashboard home credits aligned with membership usable credits", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Consistent Credits Client",
        firstName: "Consistent",
        lastName: "Client",
        email: `consistent.credits.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const { entitlement } = await createSessionFixture(client.id);

    await prisma.clientEntitlement.update({
      where: { id: entitlement.id },
      data: {
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    const expiredProduct = await prisma.product.create({
      data: {
        name: "Expired Pack",
        slug: `expired-pack-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
        isActive: true,
        isArchived: false,
        sortOrder: 99,
      },
    });

    const expiredEntitlement = await prisma.clientEntitlement.create({
      data: {
        clientId: client.id,
        productId: expiredProduct.id,
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        status: ClientEntitlementStatus.ACTIVE,
        activatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.creditLedgerEntry.create({
      data: {
        clientId: client.id,
        entitlementId: expiredEntitlement.id,
        entryType: CreditLedgerEntryType.GRANT,
        amount: 50,
        notes: "Expired credits should not count as usable.",
      },
    });

    const home = await getDashboardHomeData(client.id);
    const membership = await getDashboardMembershipData(client.id);

    expect(home.creditsLeft).toBe(0);
    expect(membership.usableCredits).toBe(0);
    expect(home.creditsLeft).toBe(membership.usableCredits);
  });

  it("returns current plans with both active entitlement packs and subscriptions", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Membership Client",
        firstName: "Membership",
        lastName: "Client",
        email: `membership.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createSessionFixture(client.id);

    const subscriptionProduct = await prisma.product.create({
      data: {
        name: "Monthly Unlimited Collective",
        slug: `monthly-unlimited-${Date.now()}`,
        productType: ProductType.UNLIMITED_MEMBERSHIP,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
    });

    const subscriptionPrice = await prisma.price.create({
      data: {
        productId: subscriptionProduct.id,
        lookupKey: `monthly-unlimited-${Date.now()}`,
        name: "Monthly Unlimited - Monthly",
        priceType: PriceType.RECURRING,
        currencyCode: "EUR",
        unitAmountMinor: 12900,
        billingInterval: BillingInterval.MONTH,
        billingIntervalCount: 1,
        isActive: true,
        isArchived: false,
      },
    });

    await prisma.subscriptionContract.create({
      data: {
        clientId: client.id,
        productId: subscriptionProduct.id,
        priceId: subscriptionPrice.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        currentPeriodStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        provider: PaymentProvider.STRIPE,
      },
    });

    const membership = await getDashboardMembershipData(client.id);

    const entitlementPlan = membership.currentPlans.find((plan) => plan.source === "ENTITLEMENT");
    const subscriptionPlan = membership.currentPlans.find((plan) => plan.source === "SUBSCRIPTION");

    expect(entitlementPlan).toBeTruthy();
    expect(entitlementPlan?.remainingCredits).toBe(9);
    expect(subscriptionPlan).toBeTruthy();
    expect(subscriptionPlan?.status).toBe(SubscriptionStatus.ACTIVE);
  });
  it("keeps purchase history consistent with finalized ownership state", async () => {
    const client = await prisma.user.create({
      data: {
        name: "History Client",
        firstName: "History",
        lastName: "Client",
        email: `history.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "History Pack",
        slug: `history-pack-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
    });

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `history-pack-${Date.now()}`,
        name: "History Pack Price",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 9500,
        isActive: true,
        isArchived: false,
      },
    });

    const placedOrder = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: price.unitAmountMinor,
        discountAmountMinor: 0,
        totalAmountMinor: price.unitAmountMinor,
        currencyCode: "EUR",
        status: OrderStatus.PLACED,
      },
    });

    const paidOrder = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: price.unitAmountMinor,
        discountAmountMinor: 0,
        totalAmountMinor: price.unitAmountMinor,
        currencyCode: "EUR",
        status: OrderStatus.PAID,
      },
    });

    await prisma.orderItem.createMany({
      data: [
        {
          orderId: placedOrder.id,
          productId: product.id,
          priceId: price.id,
          quantity: 1,
          productNameSnapshot: product.name,
          priceNameSnapshot: price.name,
          unitAmountMinor: price.unitAmountMinor,
          lineSubtotalAmountMinor: price.unitAmountMinor,
          lineDiscountAmountMinor: 0,
          lineTotalAmountMinor: price.unitAmountMinor,
          currencyCode: "EUR",
        },
        {
          orderId: paidOrder.id,
          productId: product.id,
          priceId: price.id,
          quantity: 1,
          productNameSnapshot: product.name,
          priceNameSnapshot: price.name,
          unitAmountMinor: price.unitAmountMinor,
          lineSubtotalAmountMinor: price.unitAmountMinor,
          lineDiscountAmountMinor: 0,
          lineTotalAmountMinor: price.unitAmountMinor,
          currencyCode: "EUR",
        },
      ],
    });

    const membership = await getDashboardMembershipData(client.id);
    expect(membership.ownedOneTimeProducts).toHaveLength(1);
    expect(membership.ownedOneTimeProducts[0]?.orderId).toBe(paidOrder.id);
  });
  it("keeps credit restore idempotent when cancellation is submitted concurrently", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Concurrent Cancel Client",
        firstName: "Concurrent",
        lastName: "Client",
        email: `concurrent.cancel.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const { booking, entitlement } = await createSessionFixture(client.id);

    await Promise.allSettled([
      cancelClientBooking({ bookingId: booking.id, clientId: client.id }),
      cancelClientBooking({ bookingId: booking.id, clientId: client.id }),
      cancelClientBooking({ bookingId: booking.id, clientId: client.id }),
    ]);

    const restoreEntries = await prisma.creditLedgerEntry.findMany({
      where: {
        bookingId: booking.id,
        entitlementId: entitlement.id,
        entryType: CreditLedgerEntryType.RESTORE,
      },
    });

    expect(restoreEntries).toHaveLength(1);
    expect(restoreEntries[0]?.idempotencyKey).toBeTruthy();
  });
});

describe("getClientActivityPage", () => {
  beforeEach(async () => {
    const { resetDb } = await import("./helpers/reset-db");
    await resetDb();
  });

  async function makeClientWithActivity() {
    const client = await prisma.user.create({
      data: {
        name: "Activity Client",
        email: `activity.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });
    const product = await prisma.product.create({
      data: {
        name: "Drop In",
        slug: `dropin-activity-${Date.now()}`,
        productType: ProductType.DROP_IN_CLASS,
        isActive: true,
        isArchived: false,
        sortOrder: 0,
      },
    });
    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `dropin-price-activity-${Date.now()}`,
        name: "Standard",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 1500,
        isActive: true,
        isArchived: false,
      },
    });
    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 1500,
        discountAmountMinor: 0,
        totalAmountMinor: 1500,
        currencyCode: "EUR",
        status: OrderStatus.PAID,
        items: {
          create: {
            productId: product.id,
            priceId: price.id,
            quantity: 1,
            productNameSnapshot: product.name,
            priceNameSnapshot: price.name,
            unitAmountMinor: 1500,
            lineSubtotalAmountMinor: 1500,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: 1500,
            currencyCode: "EUR",
          },
        },
      },
    });

    const { createClassCategory, createClassType } = await import("./helpers/factories");
    const cat = await createClassCategory(prisma, {
      name: "Activity Cat",
      slug: `activity-cat-${Date.now()}`,
      sortOrder: 1,
      isActive: true,
    });
    const ct = await createClassType(prisma, {
      categoryId: cat.id,
      name: "Activity Type",
      slug: `activity-ct-${Date.now()}`,
      sortOrder: 1,
      isActive: true,
      isVisible: true,
    });
    const teacher = await prisma.user.create({
      data: { name: "T", email: `t.act.${Date.now()}@example.test`, role: Role.TEACHER },
    });
    const template = await prisma.classTemplate.create({
      data: {
        classTypeId: ct.id,
        defaultTeacherId: teacher.id,
        title: "Act Template",
        slug: `act-tpl-${Date.now()}`,
        defaultCapacity: 10,
        defaultDurationMinutes: 60,
        isActive: true,
        isPublished: true,
      },
    });
    const sessionDate = new Date(Date.now() + 86400000);
    const studioSession = await prisma.studioSession.create({
      data: {
        classTemplateId: template.id,
        classTypeId: ct.id,
        teacherId: teacher.id,
        title: "Activity Session",
        startsAt: sessionDate,
        endsAt: new Date(sessionDate.getTime() + 3600000),
        capacity: 10,
        status: StudioSessionStatus.SCHEDULED,
        isPublished: true,
      },
    });
    const booking = await prisma.booking.create({
      data: {
        studioSessionId: studioSession.id,
        clientId: client.id,
        orderId: order.id,
        status: BookingStatus.CONFIRMED,
      },
    });

    return { client, order, booking };
  }

  it("returns activity items for current user", async () => {
    const { client } = await makeClientWithActivity();
    const result = await getClientActivityPage(client.id, {});
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.filter).toBe("all");
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("normalizes invalid filter to 'all'", async () => {
    const { client } = await makeClientWithActivity();
    const result = await getClientActivityPage(client.id, { filter: "invalid_filter" });
    expect(result.filter).toBe("all");
  });

  it("normalizes invalid page to 1", async () => {
    const { client } = await makeClientWithActivity();
    const result = await getClientActivityPage(client.id, { page: "not_a_number" });
    expect(result.page).toBe(1);
  });

  it("normalizes invalid pageSize to 20", async () => {
    const { client } = await makeClientWithActivity();
    const result = await getClientActivityPage(client.id, { pageSize: "0" });
    expect(result.pageSize).toBe(20);
  });

  it("caps pageSize at 50", async () => {
    const { client } = await makeClientWithActivity();
    const result = await getClientActivityPage(client.id, { pageSize: "999" });
    expect(result.pageSize).toBe(50);
  });

  it("filters by bookings only", async () => {
    const { client } = await makeClientWithActivity();
    const result = await getClientActivityPage(client.id, { filter: "bookings" });
    expect(result.filter).toBe("bookings");
    expect(result.items.every((i) => i.type === "BOOKING")).toBe(true);
  });

  it("filters by orders only", async () => {
    const { client } = await makeClientWithActivity();
    const result = await getClientActivityPage(client.id, { filter: "orders" });
    expect(result.filter).toBe("orders");
    expect(result.items.every((i) => i.type === "ORDER")).toBe(true);
  });

  it("items are sorted descending by timestamp", async () => {
    const { client } = await makeClientWithActivity();
    const result = await getClientActivityPage(client.id, {});
    const timestamps = result.items.map((i) => new Date(i.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]!);
    }
  });
});

describe("getClientSubscriptionRecoveryState", () => {
  beforeEach(async () => {
    const { resetDb } = await import("./helpers/reset-db");
    await resetDb();
  });

  async function makeClientWithContract(status: SubscriptionStatus) {
    const client = await prisma.user.create({
      data: {
        name: "Recovery Client",
        email: `recovery.dashboard.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });
    const product = await prisma.product.create({
      data: {
        name: "Recovery Membership",
        slug: `recov-mem-${Date.now()}`,
        productType: ProductType.UNLIMITED_MEMBERSHIP,
        isActive: true,
        isArchived: false,
        sortOrder: 0,
      },
    });
    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `recov-price-${Date.now()}`,
        name: "Monthly",
        priceType: PriceType.RECURRING,
        currencyCode: "EUR",
        unitAmountMinor: 4900,
        billingInterval: BillingInterval.MONTH,
        billingIntervalCount: 1,
        isActive: true,
        isArchived: false,
      },
    });
    await prisma.subscriptionContract.create({
      data: {
        clientId: client.id,
        productId: product.id,
        priceId: price.id,
        status,
        startsAt: new Date(),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        provider: PaymentProvider.STRIPE,
        providerSubscriptionReference: `sub_recov_${Date.now()}`,
      },
    });
    return client;
  }

  it("returns HEALTHY for active subscription", async () => {
    const client = await makeClientWithContract(SubscriptionStatus.ACTIVE);
    const state = await getClientSubscriptionRecoveryState(client.id);
    expect(state.status).toBe("HEALTHY");
  });

  it("returns PAST_DUE for past_due subscription", async () => {
    const client = await makeClientWithContract(SubscriptionStatus.PAST_DUE);
    const state = await getClientSubscriptionRecoveryState(client.id);
    expect(state.status).toBe("PAST_DUE");
    if (state.status === "PAST_DUE") {
      expect(state.productName).toBeTruthy();
    }
  });

  it("returns NONE when no subscriptions exist", async () => {
    const client = await prisma.user.create({
      data: {
        name: "No Sub",
        email: `nosub.dash.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });
    const state = await getClientSubscriptionRecoveryState(client.id);
    expect(state.status).toBe("NONE");
  });
});

describe("webhook receipt cleanup", () => {
  beforeEach(async () => {
    const { resetDb } = await import("./helpers/reset-db");
    await resetDb();
  });

  it("removes PROCESSED receipts older than 90 days and keeps recent ones", async () => {
    const { cleanupStaleWebhookReceipts } = await import(
      "../../src/lib/public-booking/webhook-receipt-cleanup"
    );

    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);

    const [stale, recent] = await Promise.all([
      prisma.stripeWebhookEventReceipt.create({
        data: {
          eventId: `evt_stale_cleanup_${Date.now()}`,
          status: StripeWebhookReceiptStatus.PROCESSED,
          updatedAt: ninetyOneDaysAgo,
        },
      }),
      prisma.stripeWebhookEventReceipt.create({
        data: {
          eventId: `evt_recent_cleanup_${Date.now()}`,
          status: StripeWebhookReceiptStatus.PROCESSED,
        },
      }),
    ]);

    await cleanupStaleWebhookReceipts();

    const [staleAfter, recentAfter] = await Promise.all([
      prisma.stripeWebhookEventReceipt.findUnique({ where: { id: stale.id } }),
      prisma.stripeWebhookEventReceipt.findUnique({ where: { id: recent.id } }),
    ]);

    expect(staleAfter).toBeNull();
    expect(recentAfter).not.toBeNull();
  });

  it("does not remove PROCESSING or RETRYABLE_FAILED receipts even if old", async () => {
    const { cleanupStaleWebhookReceipts } = await import(
      "../../src/lib/public-booking/webhook-receipt-cleanup"
    );

    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);

    const processing = await prisma.stripeWebhookEventReceipt.create({
      data: {
        eventId: `evt_proc_cleanup_${Date.now()}`,
        status: StripeWebhookReceiptStatus.PROCESSING,
        updatedAt: ninetyOneDaysAgo,
      },
    });
    const retryable = await prisma.stripeWebhookEventReceipt.create({
      data: {
        eventId: `evt_retry_cleanup_${Date.now()}`,
        status: StripeWebhookReceiptStatus.RETRYABLE_FAILED,
        updatedAt: ninetyOneDaysAgo,
      },
    });

    await cleanupStaleWebhookReceipts();

    const [procAfter, retryAfter] = await Promise.all([
      prisma.stripeWebhookEventReceipt.findUnique({ where: { id: processing.id } }),
      prisma.stripeWebhookEventReceipt.findUnique({ where: { id: retryable.id } }),
    ]);

    expect(procAfter).not.toBeNull();
    expect(retryAfter).not.toBeNull();
  });
});

describe("getDashboardLoyaltyPlaceholder", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns 0 for a client with no loyalty ledger entries (graceful empty state)", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Loyalty Client",
        firstName: "Loyalty",
        lastName: "Client",
        email: `loyalty.empty.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const result = await getDashboardLoyaltyPlaceholder(client.id);

    expect(result).toBe(0);
  });

  it("returns the correct summed point balance when loyalty entries exist", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Loyalty Client",
        firstName: "Loyalty",
        lastName: "Client",
        email: `loyalty.sum.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await prisma.loyaltyLedgerEntry.createMany({
      data: [
        { clientId: client.id, entryType: "EARN", amount: 50 },
        { clientId: client.id, entryType: "EARN", amount: 30 },
        { clientId: client.id, entryType: "REDEEM", amount: -20 },
      ],
    });

    const result = await getDashboardLoyaltyPlaceholder(client.id);

    expect(result).toBe(60);
  });

  it("returns 0 when all loyalty entries net to zero", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Loyalty Client",
        firstName: "Loyalty",
        lastName: "Client",
        email: `loyalty.zero.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await prisma.loyaltyLedgerEntry.createMany({
      data: [
        { clientId: client.id, entryType: "EARN", amount: 40 },
        { clientId: client.id, entryType: "REDEEM", amount: -40 },
      ],
    });

    const result = await getDashboardLoyaltyPlaceholder(client.id);

    expect(result).toBe(0);
  });
});

describe("getClientStoreOrderHistory", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function makeStoreProduct(type: ProductType, nameSuffix = "") {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const product = await prisma.product.create({
      data: {
        name: `${type} Product ${nameSuffix}`,
        slug: `${type.toLowerCase()}-${unique}`,
        productType: type,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
    });
    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `${type.toLowerCase()}-price-${unique}`,
        name: "Standard",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 2500,
        isActive: true,
        isArchived: false,
      },
    });
    return { product, price };
  }

  async function createStoreOrder(
    clientId: string,
    productType: ProductType,
    status: OrderStatus = OrderStatus.PAID,
  ) {
    const { product, price } = await makeStoreProduct(productType);
    return prisma.order.create({
      data: {
        clientId,
        subtotalAmountMinor: 2500,
        discountAmountMinor: 0,
        totalAmountMinor: 2500,
        currencyCode: "EUR",
        status,
        items: {
          create: {
            productId: product.id,
            priceId: price.id,
            quantity: 1,
            productNameSnapshot: product.name,
            priceNameSnapshot: price.name,
            unitAmountMinor: 2500,
            lineSubtotalAmountMinor: 2500,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: 2500,
            currencyCode: "EUR",
          },
        },
      },
    });
  }

  it("returns merchandise orders for the correct client", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Store Client",
        email: `store.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createStoreOrder(client.id, ProductType.MERCHANDISE);

    const result = await getClientStoreOrderHistory(client.id);

    expect(result).toHaveLength(1);
    expect(result[0]?.items[0]?.productType).toBe(ProductType.MERCHANDISE);
  });

  it("returns gift-card orders for the correct client", async () => {
    const client = await prisma.user.create({
      data: {
        name: "GC Client",
        email: `gc.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createStoreOrder(client.id, ProductType.GIFT_CARD);

    const result = await getClientStoreOrderHistory(client.id);

    expect(result).toHaveLength(1);
    expect(result[0]?.items[0]?.productType).toBe(ProductType.GIFT_CARD);
  });

  it("sets fulfillmentNote to 'Pickup at studio' for merchandise orders", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Merch Fulfillment Client",
        email: `merch.fulfil.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createStoreOrder(client.id, ProductType.MERCHANDISE);

    const result = await getClientStoreOrderHistory(client.id);

    expect(result[0]?.fulfillmentNote).toBe("Pickup at studio.");
  });

  it("sets fulfillmentNote to null for gift-card-only orders", async () => {
    const client = await prisma.user.create({
      data: {
        name: "GC Fulfillment Client",
        email: `gc.fulfil.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createStoreOrder(client.id, ProductType.GIFT_CARD);

    const result = await getClientStoreOrderHistory(client.id);

    expect(result[0]?.fulfillmentNote).toBeNull();
  });

  it("does not return plan/subscription orders (non-store types)", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Plan Client",
        email: `plan.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createStoreOrder(client.id, ProductType.DROP_IN_CLASS);

    const result = await getClientStoreOrderHistory(client.id);

    expect(result).toHaveLength(0);
  });

  it("does not return another client's store orders", async () => {
    const clientA = await prisma.user.create({
      data: {
        name: "Client A",
        email: `client.a.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });
    const clientB = await prisma.user.create({
      data: {
        name: "Client B",
        email: `client.b.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createStoreOrder(clientA.id, ProductType.MERCHANDISE);

    const result = await getClientStoreOrderHistory(clientB.id);

    expect(result).toHaveLength(0);
  });

  it("excludes DRAFT orders from client purchase history", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Draft Client",
        email: `draft.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createStoreOrder(client.id, ProductType.MERCHANDISE, OrderStatus.DRAFT);

    const result = await getClientStoreOrderHistory(client.id);

    expect(result).toHaveLength(0);
  });

  it("includes PLACED and PAID orders", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Status Client",
        email: `status.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await createStoreOrder(client.id, ProductType.MERCHANDISE, OrderStatus.PLACED);
    await createStoreOrder(client.id, ProductType.GIFT_CARD, OrderStatus.PAID);

    const result = await getClientStoreOrderHistory(client.id);

    expect(result).toHaveLength(2);
    expect(result.map((o) => o.status)).toEqual(
      expect.arrayContaining([OrderStatus.PLACED, OrderStatus.PAID]),
    );
  });

  it("returns orders sorted by placedAt descending", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Sort Client",
        email: `sort.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const { product: p1, price: pr1 } = await makeStoreProduct(ProductType.MERCHANDISE, "A");
    const { product: p2, price: pr2 } = await makeStoreProduct(ProductType.GIFT_CARD, "B");

    const earlier = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const later = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

    await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 2500,
        discountAmountMinor: 0,
        totalAmountMinor: 2500,
        currencyCode: "EUR",
        status: OrderStatus.PAID,
        placedAt: earlier,
        items: {
          create: {
            productId: p1.id,
            priceId: pr1.id,
            quantity: 1,
            productNameSnapshot: p1.name,
            priceNameSnapshot: pr1.name,
            unitAmountMinor: 2500,
            lineSubtotalAmountMinor: 2500,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: 2500,
            currencyCode: "EUR",
          },
        },
      },
    });
    await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 2500,
        discountAmountMinor: 0,
        totalAmountMinor: 2500,
        currencyCode: "EUR",
        status: OrderStatus.PAID,
        placedAt: later,
        items: {
          create: {
            productId: p2.id,
            priceId: pr2.id,
            quantity: 1,
            productNameSnapshot: p2.name,
            priceNameSnapshot: pr2.name,
            unitAmountMinor: 2500,
            lineSubtotalAmountMinor: 2500,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: 2500,
            currencyCode: "EUR",
          },
        },
      },
    });

    const result = await getClientStoreOrderHistory(client.id);

    expect(result).toHaveLength(2);
    expect(new Date(result[0]!.placedAt).getTime()).toBeGreaterThan(
      new Date(result[1]!.placedAt).getTime(),
    );
  });
});
