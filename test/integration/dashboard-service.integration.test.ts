import "./helpers/setup-env";
import {
  BillingInterval,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  PaymentProvider,
  PriceType,
  ProductType,
  Role,
  StudioSessionStatus,
  SubscriptionStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  cancelClientBooking,
  DashboardServiceError,
  getDashboardHomeData,
  getDashboardMembershipData,
  updateDashboardProfile,
} from "../../src/lib/dashboard/dashboard-service";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

async function createSessionFixture(clientId: string) {
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

  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 3);
  startsAt.setUTCHours(18, 0, 0, 0);

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
      cancellationEligibleUntilAt: new Date(startsAt.getTime() - 24 * 60 * 60 * 1000),
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

    const { booking } = await createSessionFixture(client.id);
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        cancellationEligibleUntilAt: new Date(Date.now() - 60 * 1000),
      },
    });

    await expect(
      cancelClientBooking({ bookingId: booking.id, clientId: client.id }),
    ).rejects.toMatchObject<Partial<DashboardServiceError>>({
      code: "BOOKING_TOO_LATE_TO_CANCEL",
    });
  });

  it("updates profile and blocks duplicate email", async () => {
    const userOne = await prisma.user.create({
      data: {
        name: "User One",
        firstName: "User",
        lastName: "One",
        email: `user.one.${Date.now()}@example.test`,
        role: Role.CLIENT,
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
        clientProfile: { select: { phone: true } },
      },
    });
    expect(updated?.firstName).toBe("Updated");
    expect(updated?.lastName).toBe("Name");
    expect(updated?.name).toBe("Updated Name");
    expect(updated?.clientProfile?.phone).toBe("+32000000001");

    await expect(
      updateDashboardProfile(userOne.id, {
        firstName: "Updated",
        lastName: "Name",
        email: userTwo.email,
        phone: "",
      }),
    ).rejects.toMatchObject<Partial<DashboardServiceError>>({
      code: "EMAIL_ALREADY_IN_USE",
    });
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
});


