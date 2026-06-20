import "./helpers/setup-env";

import {
  LoyaltyPointsLedgerEntryType,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
  UserActivationStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../../src/lib/db";
import {
  getAdminLoyaltyClientDetails,
  grantManualLoyaltyPointsByAdmin,
  listAdminLoyaltyClientsByActor,
  upsertLoyaltyProgramSettingsByAdmin,
} from "../../src/lib/loyalty/loyalty-admin-service";
import {
  awardLoyaltyPointsForSettledOrder,
  expireLoyaltyPointsEntry,
  reverseLoyaltyPointsEntry,
} from "../../src/lib/loyalty/loyalty-points-service";
import { getClientLoyaltySummary, listClientLoyaltyHistory } from "../../src/lib/loyalty/loyalty-read-service";
import { resetDb } from "./helpers/reset-db";

async function createVerifiedClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Loyalty Client ${unique}`,
      email: `loyalty-client-${unique}@example.test`,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      emailVerifiedAt: new Date(),
    },
  });
}

async function createUnverifiedClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Unverified Loyalty Client ${unique}`,
      email: `unverified-loyalty-client-${unique}@example.test`,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: null,
      emailVerifiedAt: null,
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

async function createCatalogProduct(input: {
  namePrefix: string;
  productType: ProductType;
  priceType?: PriceType;
  currencyCode?: string;
  unitAmountMinor: number;
}) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const product = await prisma.product.create({
    data: {
      name: `${input.namePrefix} ${unique}`,
      slug: `${input.namePrefix.toLowerCase().replace(/\s+/g, "-")}-${unique}`,
      productType: input.productType,
      isActive: true,
      isArchived: false,
      sortOrder: 0,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `${input.namePrefix.toLowerCase().replace(/\s+/g, "-")}-price-${unique}`,
      name: `${input.namePrefix} Price ${unique}`,
      priceType: input.priceType ?? PriceType.ONE_TIME,
      currencyCode: input.currencyCode ?? "EUR",
      unitAmountMinor: input.unitAmountMinor,
      isActive: true,
      isArchived: false,
    },
  });
  return { product, price };
}

async function createPaidOrder(input: {
  clientId: string;
  currencyCode?: string;
  discountAmountMinor?: number;
  giftCardAmountMinor?: number;
  lines: Array<{
    productId: string;
    priceId: string;
    unitAmountMinor: number;
    quantity?: number;
    lineDiscountAmountMinor?: number;
    productName: string;
    priceName: string;
  }>;
}) {
  const currencyCode = input.currencyCode ?? "EUR";
  const subtotal = input.lines.reduce(
    (total, line) => total + line.unitAmountMinor * (line.quantity ?? 1),
    0,
  );
  const discountAmountMinor = input.discountAmountMinor
    ?? input.lines.reduce((total, line) => total + (line.lineDiscountAmountMinor ?? 0), 0);
  const totalAmountMinor = subtotal - discountAmountMinor;
  const giftCardAmountMinor = input.giftCardAmountMinor ?? 0;
  const stripeAmountMinor = totalAmountMinor - giftCardAmountMinor;

  const order = await prisma.order.create({
    data: {
      clientId: input.clientId,
      subtotalAmountMinor: subtotal,
      discountAmountMinor,
      totalAmountMinor,
      currencyCode,
      status: OrderStatus.PAID,
    },
  });

  await prisma.orderItem.createMany({
    data: input.lines.map((line) => ({
      orderId: order.id,
      productId: line.productId,
      priceId: line.priceId,
      quantity: line.quantity ?? 1,
      productNameSnapshot: line.productName,
      priceNameSnapshot: line.priceName,
      unitAmountMinor: line.unitAmountMinor,
      lineSubtotalAmountMinor: line.unitAmountMinor * (line.quantity ?? 1),
      lineDiscountAmountMinor: line.lineDiscountAmountMinor ?? 0,
      lineTotalAmountMinor: (line.unitAmountMinor * (line.quantity ?? 1)) - (line.lineDiscountAmountMinor ?? 0),
      currencyCode,
    })),
  });

  if (giftCardAmountMinor > 0) {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.SUCCEEDED,
        amountMinor: giftCardAmountMinor,
        currencyCode,
        method: PaymentMethod.GIFT_CARD,
        provider: PaymentProvider.INTERNAL,
        capturedAt: new Date("2026-06-20T10:00:00.000Z"),
      },
    });
  }

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.SUCCEEDED,
      amountMinor: stripeAmountMinor,
      currencyCode,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      capturedAt: new Date("2026-06-20T10:00:00.000Z"),
    },
  });

  return { order, payment };
}

describe("loyalty core services", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("upserts program settings, grants manual points, and exposes admin read models", async () => {
    const admin = await createAdmin();
    const client = await createVerifiedClient();
    const eligible = await createCatalogProduct({
      namePrefix: "Loyalty Eligible Mat",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5_000,
    });

    const program = await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "eur",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      maxManualGrantPoints: 5_000,
      eligibleProductIds: [eligible.product.id],
    });

    const grant = await grantManualLoyaltyPointsByAdmin({
      actorUserId: admin.id,
      clientId: client.id,
      currencyCode: "EUR",
      amountPoints: 250,
      reason: "Recovered launch-week points for a verified client.",
      idempotencyKey: "loyalty:manual-grant:admin-test",
      metadata: { source: "integration-test" },
    });

    const adminList = await listAdminLoyaltyClientsByActor({
      actorUserId: admin.id,
      currencyCode: "EUR",
      query: client.email,
    });
    const details = await getAdminLoyaltyClientDetails({
      actorUserId: admin.id,
      clientId: client.id,
      currencyCode: "EUR",
      historyLimit: 10,
    });

    expect(program.currencyCode).toBe("EUR");
    expect(program.eligibleProducts.map((entry) => entry.productId)).toEqual([eligible.product.id]);
    expect(grant.outcome).toBe("created");
    expect(adminList.items).toHaveLength(1);
    expect(adminList.items[0]?.balancePoints).toBe(250);
    expect(details.summary.balancePoints).toBe(250);
    expect(details.history[0]?.entryType).toBe(LoyaltyPointsLedgerEntryType.MANUAL_GRANT);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        actionType: { in: ["LOYALTY_PROGRAM_UPSERT", "LOYALTY_MANUAL_GRANT"] },
      },
      orderBy: { createdAt: "asc" },
    });
    expect(auditLogs).toHaveLength(2);
  });

  it("awards points from discounted eligible net after excluding gift-card funded value", async () => {
    const client = await createVerifiedClient();
    const admin = await createAdmin();
    const eligible = await createCatalogProduct({
      namePrefix: "Eligible Bottle",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5_600,
    });
    const ineligible = await createCatalogProduct({
      namePrefix: "Ineligible Towel",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 4_000,
    });

    await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      maxManualGrantPoints: 5_000,
      eligibleProductIds: [eligible.product.id],
    });

    const { order, payment } = await createPaidOrder({
      clientId: client.id,
      lines: [
        {
          productId: eligible.product.id,
          priceId: eligible.price.id,
          unitAmountMinor: 5_600,
          lineDiscountAmountMinor: 600,
          productName: eligible.product.name,
          priceName: eligible.price.name,
        },
        {
          productId: ineligible.product.id,
          priceId: ineligible.price.id,
          unitAmountMinor: 4_000,
          productName: ineligible.product.name,
          priceName: ineligible.price.name,
        },
      ],
      discountAmountMinor: 600,
      giftCardAmountMinor: 4_500,
    });

    const first = await awardLoyaltyPointsForSettledOrder({
      clientId: client.id,
      orderId: order.id,
      paymentId: payment.id,
      idempotencyKey: `loyalty:earn:payment:${payment.id}`,
    });
    const replay = await awardLoyaltyPointsForSettledOrder({
      clientId: client.id,
      orderId: order.id,
      paymentId: payment.id,
      idempotencyKey: `loyalty:earn:payment:${payment.id}`,
    });
    const summary = await getClientLoyaltySummary({
      actor: { type: "CLIENT", userId: client.id },
      clientId: client.id,
      currencyCode: "EUR",
    });
    const history = await listClientLoyaltyHistory({
      actor: { type: "CLIENT", userId: client.id },
      clientId: client.id,
      currencyCode: "EUR",
      limit: 10,
    });

    expect(first.outcome).toBe("created");
    expect(replay.outcome).toBe("replayed");
    expect(summary.balancePoints).toBe(25);
    expect(history).toHaveLength(1);
    expect(history[0]?.entryType).toBe(LoyaltyPointsLedgerEntryType.EARN);
    expect(history[0]?.metadata).toMatchObject({
      computedEligibleAmountMinor: 5_000,
      eligibleAmountMinor: 2_500,
      giftCardFundedAmountMinor: 4_500,
    });
  });

  it("reverses and expires remaining points through ledger-safe mutations", async () => {
    const client = await createVerifiedClient();
    const admin = await createAdmin();
    const eligible = await createCatalogProduct({
      namePrefix: "Eligible Block",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 8_000,
    });

    await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      maxManualGrantPoints: 5_000,
      eligibleProductIds: [eligible.product.id],
    });

    const { order, payment } = await createPaidOrder({
      clientId: client.id,
      lines: [
        {
          productId: eligible.product.id,
          priceId: eligible.price.id,
          unitAmountMinor: 8_000,
          productName: eligible.product.name,
          priceName: eligible.price.name,
        },
      ],
    });

    const earned = await awardLoyaltyPointsForSettledOrder({
      clientId: client.id,
      orderId: order.id,
      paymentId: payment.id,
      idempotencyKey: `loyalty:earn:${payment.id}`,
    });
    if (earned.outcome !== "created") {
      throw new Error("Expected loyalty earn mutation to create an entry.");
    }

    const reversal = await reverseLoyaltyPointsEntry({
      actor: { type: "SYSTEM", label: "chargeback-handler" },
      sourceEntryId: earned.entry.id,
      amountPoints: 30,
      reason: "Partial payment invalidation.",
      idempotencyKey: `loyalty:reversal:${earned.entry.id}`,
    });
    const expiration = await expireLoyaltyPointsEntry({
      sourceEntryId: earned.entry.id,
      idempotencyKey: `loyalty:expire:${earned.entry.id}`,
      happenedAt: new Date("2027-01-05T00:00:00.000Z"),
    });
    const summary = await getClientLoyaltySummary({
      actor: { type: "CLIENT", userId: client.id },
      clientId: client.id,
      currencyCode: "EUR",
    });
    const history = await listClientLoyaltyHistory({
      actor: { type: "CLIENT", userId: client.id },
      clientId: client.id,
      currencyCode: "EUR",
      limit: 10,
    });

    expect(reversal.outcome).toBe("created");
    expect(expiration.outcome).toBe("created");
    expect(summary.balancePoints).toBe(0);
    expect(history.map((entry) => entry.entryType)).toEqual([
      LoyaltyPointsLedgerEntryType.EXPIRE,
      LoyaltyPointsLedgerEntryType.REVERSAL,
      LoyaltyPointsLedgerEntryType.EARN,
    ]);
  });

  it("supports non-EUR program-driven manual grants and read models", async () => {
    const admin = await createAdmin();
    const client = await createVerifiedClient();
    const eligible = await createCatalogProduct({
      namePrefix: "USD Eligible Strap",
      productType: ProductType.MERCHANDISE,
      currencyCode: "USD",
      unitAmountMinor: 2_500,
    });

    await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "USD",
      isActive: true,
      earningPoints: 2,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 90,
      expirationReminderDays: 14,
      maxManualGrantPoints: 2_000,
      eligibleProductIds: [eligible.product.id],
    });

    const grant = await grantManualLoyaltyPointsByAdmin({
      actorUserId: admin.id,
      clientId: client.id,
      currencyCode: "USD",
      amountPoints: 120,
      reason: "Recovered USD loyalty points for cross-currency setup.",
      idempotencyKey: "loyalty:manual-grant:usd",
    });

    const summary = await getClientLoyaltySummary({
      actor: { type: "CLIENT", userId: client.id },
      clientId: client.id,
      currencyCode: "USD",
    });
    const history = await listClientLoyaltyHistory({
      actor: { type: "CLIENT", userId: client.id },
      clientId: client.id,
      currencyCode: "USD",
      limit: 10,
    });
    const adminList = await listAdminLoyaltyClientsByActor({
      actorUserId: admin.id,
      currencyCode: "USD",
      query: client.email,
    });

    expect(grant.outcome).toBe("created");
    expect(summary.program?.currencyCode).toBe("USD");
    expect(summary.balancePoints).toBe(120);
    expect(history[0]?.currencyCode).toBe("USD");
    expect(adminList.items[0]?.balancePoints).toBe(120);
  });

  it("enforces verified client ownership for client-facing loyalty reads", async () => {
    const admin = await createAdmin();
    const client = await createVerifiedClient();
    const otherClient = await createVerifiedClient();
    const unverifiedClient = await createUnverifiedClient();
    const eligible = await createCatalogProduct({
      namePrefix: "Ownership Eligible Bottle",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 3_000,
    });

    await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      maxManualGrantPoints: 5_000,
      eligibleProductIds: [eligible.product.id],
    });

    await grantManualLoyaltyPointsByAdmin({
      actorUserId: admin.id,
      clientId: client.id,
      currencyCode: "EUR",
      amountPoints: 80,
      reason: "Ownership-read coverage for verified client account.",
      idempotencyKey: "loyalty:manual-grant:ownership",
    });

    await expect(
      getClientLoyaltySummary({
        actor: { type: "CLIENT", userId: otherClient.id },
        clientId: client.id,
        currencyCode: "EUR",
      }),
    ).rejects.toMatchObject({ code: "LOYALTY_CLIENT_REQUIRED" });

    await expect(
      listClientLoyaltyHistory({
        actor: { type: "CLIENT", userId: otherClient.id },
        clientId: client.id,
        currencyCode: "EUR",
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: "LOYALTY_CLIENT_REQUIRED" });

    await expect(
      getClientLoyaltySummary({
        actor: { type: "CLIENT", userId: unverifiedClient.id },
        clientId: unverifiedClient.id,
        currencyCode: "EUR",
      }),
    ).rejects.toMatchObject({ code: "LOYALTY_CLIENT_EMAIL_UNVERIFIED" });
  });
});
