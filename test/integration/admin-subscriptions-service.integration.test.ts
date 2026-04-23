import "./helpers/setup-env";

import { BillingInterval, PaymentProvider, PriceType, ProductType, Role, SubscriptionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createAdminSubscription,
  updateAdminSubscription,
} from "../../src/lib/admin/admin-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("admin subscription service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function createFixture() {
    const client = await prisma.user.create({
      data: {
        name: "Client",
        email: `client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Monthly Unlimited",
        slug: `monthly-unlimited-${Date.now()}`,
        productType: ProductType.UNLIMITED_MEMBERSHIP,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
    });

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `monthly-${Date.now()}`,
        name: "Monthly",
        priceType: PriceType.RECURRING,
        currencyCode: "EUR",
        unitAmountMinor: 8900,
        billingInterval: BillingInterval.MONTH,
        billingIntervalCount: 1,
        isActive: true,
        isArchived: false,
      },
    });

    const otherProduct = await prisma.product.create({
      data: {
        name: "Other",
        slug: `other-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
        isActive: true,
        isArchived: false,
        sortOrder: 2,
      },
    });

    return { client, product, price, otherProduct };
  }

  it("creates subscription contract on happy path", async () => {
    const fixture = await createFixture();

    const startsAt = new Date("2026-03-22T09:00:00.000Z");
    const currentPeriodStart = new Date("2026-03-22T09:00:00.000Z");
    const currentPeriodEnd = new Date("2026-04-22T09:00:00.000Z");

    const created = await createAdminSubscription({
      clientId: fixture.client.id,
      productId: fixture.product.id,
      priceId: fixture.price.id,
      status: SubscriptionStatus.ACTIVE,
      startsAt,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      provider: PaymentProvider.STRIPE,
      providerSubscriptionReference: "sub_123",
    });

    expect(created.clientId).toBe(fixture.client.id);
    expect(created.productId).toBe(fixture.product.id);
    expect(created.priceId).toBe(fixture.price.id);
  });

  it("rejects create when price does not belong to selected product", async () => {
    const fixture = await createFixture();

    await expect(
      createAdminSubscription({
        clientId: fixture.client.id,
        productId: fixture.otherProduct.id,
        priceId: fixture.price.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date("2026-03-22T09:00:00.000Z"),
        currentPeriodStart: new Date("2026-03-22T09:00:00.000Z"),
        currentPeriodEnd: new Date("2026-04-22T09:00:00.000Z"),
        cancelAtPeriodEnd: false,
        provider: PaymentProvider.STRIPE,
      }),
    ).rejects.toThrow("PRICE_PRODUCT_MISMATCH");
  });

  it("keeps one contract row when update is replayed with same payload", async () => {
    const fixture = await createFixture();

    const created = await createAdminSubscription({
      clientId: fixture.client.id,
      productId: fixture.product.id,
      priceId: fixture.price.id,
      status: SubscriptionStatus.ACTIVE,
      startsAt: new Date("2026-03-22T09:00:00.000Z"),
      currentPeriodStart: new Date("2026-03-22T09:00:00.000Z"),
      currentPeriodEnd: new Date("2026-04-22T09:00:00.000Z"),
      cancelAtPeriodEnd: false,
      provider: PaymentProvider.STRIPE,
      providerSubscriptionReference: "sub_replay",
    });

    const updateInput = {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: new Date("2026-03-22T09:00:00.000Z"),
      currentPeriodEnd: new Date("2026-04-22T09:00:00.000Z"),
      cancelAtPeriodEnd: true,
      cancelledAt: null,
      endedAt: null,
      providerSubscriptionReference: "sub_replay",
    };

    await updateAdminSubscription(created.id, updateInput);
    await updateAdminSubscription(created.id, updateInput);

    const contracts = await prisma.subscriptionContract.findMany({
      where: { id: created.id },
    });

    expect(contracts).toHaveLength(1);
    expect(contracts[0]?.cancelAtPeriodEnd).toBe(true);
  });
});
