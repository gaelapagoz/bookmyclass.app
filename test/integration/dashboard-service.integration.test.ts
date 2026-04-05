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
  SubscriptionStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelClientBooking,
  DashboardServiceError,
  getDashboardBookingsData,
  getDashboardHomeData,
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

    expect(updatedBooking?.status).toBe(BookingStatus.CANCELLED);
    expect(updatedBooking?.creditRefundedAt).not.toBeNull();
    expect(restoreEntries).toHaveLength(1);
    expect(restoreEntries[0]?.amount).toBe(1);
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

    const [home, membership] = await Promise.all([
      getDashboardHomeData(client.id),
      getDashboardMembershipData(client.id),
    ]);

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

