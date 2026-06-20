import "./helpers/setup-env";

import { LoyaltyPointsLedgerEntryType, PaymentMethod, PaymentProvider, PaymentStatus, PriceType, ProductType, Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../../src/lib/db";
import { resetDb } from "./helpers/reset-db";

async function createClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Loyalty Client ${unique}`,
      email: `loyalty-client-${unique}@example.test`,
      role: Role.CLIENT,
    },
  });
}

async function createAdmin() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Loyalty Admin ${unique}`,
      email: `loyalty-admin-${unique}@example.test`,
      role: Role.ADMIN,
    },
  });
}

async function createEligibleOrder(clientId: string) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const product = await prisma.product.create({
    data: {
      name: `Loyalty Product ${unique}`,
      slug: `loyalty-product-${unique}`,
      productType: ProductType.MERCHANDISE,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `loyalty-price-${unique}`,
      name: `Loyalty Price ${unique}`,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 5_000,
    },
  });
  const order = await prisma.order.create({
    data: {
      clientId,
      subtotalAmountMinor: 5_000,
      totalAmountMinor: 5_000,
      currencyCode: "EUR",
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.SUCCEEDED,
      amountMinor: 5_000,
      currencyCode: "EUR",
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      priceId: price.id,
      quantity: 1,
      productNameSnapshot: product.name,
      priceNameSnapshot: price.name,
      unitAmountMinor: 5_000,
      lineSubtotalAmountMinor: 5_000,
      lineTotalAmountMinor: 5_000,
      currencyCode: "EUR",
    },
  });

  return { product, order, payment };
}

describe("loyalty schema foundation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("stores program settings and explicit eligible products without creating redemption tables", async () => {
    const client = await createClient();
    const { product, order, payment } = await createEligibleOrder(client.id);

    const program = await prisma.loyaltyProgram.create({
      data: {
        currencyCode: "EUR",
        earningPoints: 1,
        earningAmountMinor: 100,
        pointsExpireAfterDays: 180,
        expirationReminderDays: 30,
        maxManualGrantPoints: 5_000,
        eligibleProducts: {
          create: {
            productId: product.id,
          },
        },
      },
      include: {
        eligibleProducts: true,
      },
    });

    const earnEntry = await prisma.loyaltyPointsLedgerEntry.create({
      data: {
        clientId: client.id,
        entryType: LoyaltyPointsLedgerEntryType.EARN,
        amountPoints: 50,
        currencyCode: "EUR",
        orderId: order.id,
        paymentId: payment.id,
        idempotencyKey: `loyalty:earn:payment:${payment.id}`,
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      },
    });

    expect(program.currencyCode).toBe("EUR");
    expect(program.eligibleProducts).toHaveLength(1);
    expect(earnEntry.entryType).toBe(LoyaltyPointsLedgerEntryType.EARN);
  });

  it("requires actor, reason, and metadata for manual grants", async () => {
    const client = await createClient();
    const admin = await createAdmin();

    await expect(
      prisma.loyaltyPointsLedgerEntry.create({
        data: {
          clientId: client.id,
          entryType: LoyaltyPointsLedgerEntryType.MANUAL_GRANT,
          amountPoints: 25,
          currencyCode: "EUR",
          idempotencyKey: "loyalty:manual-grant:missing-reason",
          createdById: admin.id,
          expiresAt: new Date("2026-12-31T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow(/LoyaltyPointsLedgerEntry_entry_shape/);

    await expect(
      prisma.loyaltyPointsLedgerEntry.create({
        data: {
          clientId: client.id,
          entryType: LoyaltyPointsLedgerEntryType.MANUAL_GRANT,
          amountPoints: 25,
          currencyCode: "EUR",
          idempotencyKey: "loyalty:manual-grant:missing-metadata",
          createdById: admin.id,
          reason: "Recovered missed launch promo points",
          expiresAt: new Date("2026-12-31T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow(/LoyaltyPointsLedgerEntry_entry_shape/);

    const grant = await prisma.loyaltyPointsLedgerEntry.create({
      data: {
        clientId: client.id,
        entryType: LoyaltyPointsLedgerEntryType.MANUAL_GRANT,
        amountPoints: 25,
        currencyCode: "EUR",
        idempotencyKey: "loyalty:manual-grant:valid",
        createdById: admin.id,
        reason: "Recovered missed launch promo points",
        metadata: {
          source: "admin-console",
          noteCategory: "launch-recovery",
        },
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      },
    });

    expect(grant.createdById).toBe(admin.id);
    expect(grant.reason).toContain("launch promo");
    expect(grant.metadata).toMatchObject({ source: "admin-console" });
  });

  it("requires reversals and expirations to link back to a source entry", async () => {
    const client = await createClient();
    const source = await prisma.loyaltyPointsLedgerEntry.create({
      data: {
        clientId: client.id,
        entryType: LoyaltyPointsLedgerEntryType.EARN,
        amountPoints: 80,
        currencyCode: "EUR",
        idempotencyKey: "loyalty:earn:source",
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      },
    });

    await expect(
      prisma.loyaltyPointsLedgerEntry.create({
        data: {
          clientId: client.id,
          entryType: LoyaltyPointsLedgerEntryType.REVERSAL,
          amountPoints: -20,
          currencyCode: "EUR",
          idempotencyKey: "loyalty:reversal:missing-source",
        },
      }),
    ).rejects.toThrow(/LoyaltyPointsLedgerEntry_entry_shape/);

    const expiration = await prisma.loyaltyPointsLedgerEntry.create({
      data: {
        clientId: client.id,
        entryType: LoyaltyPointsLedgerEntryType.EXPIRE,
        amountPoints: -80,
        currencyCode: "EUR",
        idempotencyKey: "loyalty:expire:source",
        sourceEntryId: source.id,
      },
    });

    expect(expiration.sourceEntryId).toBe(source.id);
  });
});
