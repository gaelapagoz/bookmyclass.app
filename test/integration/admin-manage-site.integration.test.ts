import "./helpers/setup-env";

import { BillingInterval, PriceType, ProductType, Role, SubscriptionStatus, Weekday } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createAdminSiteWeeklyScheduleEntry,
  deleteAdminSiteWeeklyScheduleEntry,
  getAdminCancellationPeriodHours,
  getAdminClientStats,
  listAdminSiteScheduleServiceOptions,
  listAdminSiteWeeklyScheduleEntries,
  updateAdminCancellationPeriodHours,
  updateAdminSiteWeeklyScheduleEntry,
} from "../../src/lib/admin/admin-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("admin manage-site service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("aggregates client stats with active and historical subscriptions", async () => {
    const [neverSubscribed, activeClient, unsubscribedClient] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Never Subscribed",
          email: `never.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Active Client",
          email: `active.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Unsubscribed Client",
          email: `unsubscribed.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
    ]);

    const product = await prisma.product.create({
      data: {
        name: "Monthly Unlimited",
        slug: `monthly-unlimited-${Date.now()}`,
        productType: ProductType.UNLIMITED_MEMBERSHIP,
        isActive: true,
        isArchived: false,
      },
    });

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `monthly-unlimited-${Date.now()}`,
        name: "Monthly",
        priceType: PriceType.RECURRING,
        currencyCode: "EUR",
        unitAmountMinor: 7900,
        billingInterval: BillingInterval.MONTH,
        billingIntervalCount: 1,
        isActive: true,
        isArchived: false,
      },
    });

    await prisma.subscriptionContract.createMany({
      data: [
        {
          clientId: activeClient.id,
          productId: product.id,
          priceId: price.id,
          status: SubscriptionStatus.ACTIVE,
          startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          currentPeriodStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
          provider: "STRIPE",
        },
        {
          clientId: unsubscribedClient.id,
          productId: product.id,
          priceId: price.id,
          status: SubscriptionStatus.CANCELLED,
          startsAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
          currentPeriodStart: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          cancelledAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          provider: "STRIPE",
        },
      ],
    });

    const stats = await getAdminClientStats();

    expect(stats.totalClients).toBe(3);
    expect(stats.neverSubscribedClients).toBe(1);
    expect(stats.subscribedClients).toBe(1);
    expect(stats.unsubscribedClients).toBe(1);
    expect(stats.totalSubscriptions).toBe(2);

    expect(neverSubscribed.id).toBeTruthy();
  });

  it("supports static weekly schedule CRUD and cancellation period updates", async () => {
    const category = await prisma.classCategory.create({
      data: {
        name: "Yoga",
        slug: `yoga-${Date.now()}`,
        isActive: true,
        sortOrder: 1,
      },
    });

    const [pilates, yoga] = await Promise.all([
      prisma.classType.create({
        data: {
          categoryId: category.id,
          name: "Pilates",
          slug: `pilates-${Date.now()}`,
          defaultDurationMinutes: 60,
          defaultCapacity: 12,
          isActive: true,
          isVisible: true,
          sortOrder: 1,
        },
      }),
      prisma.classType.create({
        data: {
          categoryId: category.id,
          name: "Yoga",
          slug: `yoga-flow-${Date.now()}`,
          defaultDurationMinutes: 60,
          defaultCapacity: 10,
          isActive: true,
          isVisible: true,
          sortOrder: 2,
        },
      }),
    ]);

    const serviceOptions = await listAdminSiteScheduleServiceOptions();
    expect(serviceOptions.map((option) => option.name)).toEqual(["Pilates", "Yoga"]);

    const created = await createAdminSiteWeeklyScheduleEntry({
      dayOfWeek: Weekday.MONDAY,
      startTime: "18:00",
      endTime: "19:00",
      serviceId: pilates.id,
      displayOrder: 1,
      isActive: true,
    });

    let rows = await listAdminSiteWeeklyScheduleEntries();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("Pilates");
    expect(rows[0]?.serviceId).toBe(pilates.id);

    const updated = await updateAdminSiteWeeklyScheduleEntry(created.id, {
      dayOfWeek: Weekday.TUESDAY,
      startTime: "10:00",
      endTime: "11:00",
      serviceId: yoga.id,
      displayOrder: 2,
      isActive: false,
    });

    expect(updated.dayOfWeek).toBe(Weekday.TUESDAY);
    expect(updated.label).toBe("Yoga");
    expect(updated.serviceId).toBe(yoga.id);

    await deleteAdminSiteWeeklyScheduleEntry(created.id);
    rows = await listAdminSiteWeeklyScheduleEntries();
    expect(rows).toHaveLength(0);

    const updatedHours = await updateAdminCancellationPeriodHours(36);
    expect(updatedHours).toBe(36);
    expect(await getAdminCancellationPeriodHours()).toBe(36);

    await expect(updateAdminCancellationPeriodHours(0)).rejects.toThrow("INVALID_CANCELLATION_CUTOFF_HOURS");
  });

  it("returns empty schedule and default cancellation period when config rows are missing", async () => {
    const rows = await listAdminSiteWeeklyScheduleEntries();
    expect(rows).toEqual([]);

    await prisma.bookingPolicy.deleteMany({ where: { scope: "GLOBAL" } });
    await expect(getAdminCancellationPeriodHours()).resolves.toBe(24);
  });
});
