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
  reverseLoyaltyForPaymentInvalidation,
  settleLoyaltyForSettledOrder,
} from "../../src/lib/loyalty/loyalty-settlement-service";
import { upsertLoyaltyProgramSettings } from "../../src/lib/loyalty/loyalty-program-service";
import { settleSuccessfulCheckoutOrder } from "../../src/lib/public-booking/checkout-finalization-service";
import { resetDb } from "./helpers/reset-db";

async function createVerifiedClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Loyalty Settlement Client ${unique}`,
      email: `loyalty-settlement-client-${unique}@example.test`,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      emailVerifiedAt: new Date(),
    },
  });
}

async function createCatalogProduct(input: {
  namePrefix: string;
  productType: ProductType;
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
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `${product.slug}-price`,
      name: `${input.namePrefix} Price ${unique}`,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: input.unitAmountMinor,
      isActive: true,
      isArchived: false,
    },
  });

  return { product, price };
}

async function createOrderFixture(input: {
  clientId: string;
  productId: string;
  priceId: string;
  unitAmountMinor: number;
  giftCardAmountMinor?: number;
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
}) {
  const giftCardAmountMinor = input.giftCardAmountMinor ?? 0;
  const stripeAmountMinor = input.unitAmountMinor - giftCardAmountMinor;

  const order = await prisma.order.create({
    data: {
      clientId: input.clientId,
      subtotalAmountMinor: input.unitAmountMinor,
      discountAmountMinor: 0,
      totalAmountMinor: input.unitAmountMinor,
      currencyCode: "EUR",
      status: input.orderStatus ?? OrderStatus.PLACED,
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: input.productId,
      priceId: input.priceId,
      quantity: 1,
      productNameSnapshot: "Eligible Product",
      priceNameSnapshot: "Eligible Price",
      unitAmountMinor: input.unitAmountMinor,
      lineSubtotalAmountMinor: input.unitAmountMinor,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: input.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  const giftCardPayment = giftCardAmountMinor > 0
    ? await prisma.payment.create({
        data: {
          orderId: order.id,
          status: input.paymentStatus ?? PaymentStatus.PENDING,
          amountMinor: giftCardAmountMinor,
          currencyCode: "EUR",
          method: PaymentMethod.GIFT_CARD,
          provider: PaymentProvider.INTERNAL,
        },
      })
    : null;

  const stripePayment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: input.paymentStatus ?? PaymentStatus.PENDING,
      amountMinor: stripeAmountMinor,
      currencyCode: "EUR",
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
    },
  });

  return { order, stripePayment, giftCardPayment };
}

describe("loyalty settlement integration", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("awards loyalty points once when checkout settlement is replayed", async () => {
    const client = await createVerifiedClient();
    const { product, price } = await createCatalogProduct({
      namePrefix: "Eligible Mat",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5_600,
    });

    await upsertLoyaltyProgramSettings({
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      maxManualGrantPoints: 5_000,
      eligibleProductIds: [product.id],
    });

    const { order, stripePayment, giftCardPayment } = await createOrderFixture({
      clientId: client.id,
      productId: product.id,
      priceId: price.id,
      unitAmountMinor: 5_600,
      giftCardAmountMinor: 2_000,
    });

    await settleSuccessfulCheckoutOrder({
      orderId: order.id,
      paymentId: stripePayment.id,
      internalPaymentIds: [stripePayment.id, giftCardPayment?.id],
      loyaltyMetadata: { source: "integration-test" },
    });

    const replay = await settleLoyaltyForSettledOrder({
      orderId: order.id,
      paymentId: stripePayment.id,
      metadata: { source: "integration-test-replay" },
    });

    const ledgerEntries = await prisma.loyaltyPointsLedgerEntry.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "asc" },
    });
    const refreshedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: { orderBy: { createdAt: "asc" } } },
    });

    expect(replay).toMatchObject({ outcome: "replayed" });
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]).toMatchObject({
      entryType: LoyaltyPointsLedgerEntryType.EARN,
      amountPoints: 36,
      paymentId: stripePayment.id,
    });
    expect(refreshedOrder.status).toBe(OrderStatus.PAID);
    expect(refreshedOrder.payments.every((payment) => payment.status === PaymentStatus.SUCCEEDED)).toBe(true);
  });

  it("skips loyalty settlement when no active program exists", async () => {
    const client = await createVerifiedClient();
    const { product, price } = await createCatalogProduct({
      namePrefix: "Inactive Loyalty Towel",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 4_000,
    });
    const { order, stripePayment } = await createOrderFixture({
      clientId: client.id,
      productId: product.id,
      priceId: price.id,
      unitAmountMinor: 4_000,
      orderStatus: OrderStatus.PAID,
      paymentStatus: PaymentStatus.SUCCEEDED,
    });

    const result = await settleLoyaltyForSettledOrder({
      orderId: order.id,
      paymentId: stripePayment.id,
    });

    expect(result).toEqual({
      outcome: "skipped",
      reason: "LOYALTY_PROGRAM_NOT_ACTIVE",
    });
    await expect(
      prisma.loyaltyPointsLedgerEntry.count({ where: { orderId: order.id } }),
    ).resolves.toBe(0);
  });

  it("creates proportional payment-invalidation reversals from the earned entry", async () => {
    const client = await createVerifiedClient();
    const { product, price } = await createCatalogProduct({
      namePrefix: "Eligible Block",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 8_000,
    });

    await upsertLoyaltyProgramSettings({
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      maxManualGrantPoints: 5_000,
      eligibleProductIds: [product.id],
    });

    const { order, stripePayment } = await createOrderFixture({
      clientId: client.id,
      productId: product.id,
      priceId: price.id,
      unitAmountMinor: 8_000,
      orderStatus: OrderStatus.PAID,
      paymentStatus: PaymentStatus.SUCCEEDED,
    });

    const earned = await settleLoyaltyForSettledOrder({
      orderId: order.id,
      paymentId: stripePayment.id,
    });
    const firstReversal = await reverseLoyaltyForPaymentInvalidation({
      actor: { type: "SYSTEM", label: "chargeback-handler" },
      orderId: order.id,
      paymentId: stripePayment.id,
      invalidatedAmountMinor: 2_550,
      reason: "Partial payment invalidation.",
      idempotencyKey: `loyalty:reversal:payment:${stripePayment.id}:2550`,
    });
    const replay = await reverseLoyaltyForPaymentInvalidation({
      actor: { type: "SYSTEM", label: "chargeback-handler" },
      orderId: order.id,
      paymentId: stripePayment.id,
      invalidatedAmountMinor: 2_550,
      reason: "Partial payment invalidation.",
      idempotencyKey: `loyalty:reversal:payment:${stripePayment.id}:2550`,
    });

    const ledgerEntries = await prisma.loyaltyPointsLedgerEntry.findMany({
      where: { orderId: order.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const balance = ledgerEntries.reduce((total, entry) => total + entry.amountPoints, 0);

    expect(earned).toMatchObject({ outcome: "created" });
    expect(firstReversal).toMatchObject({ outcome: "created" });
    expect(replay).toMatchObject({ outcome: "replayed" });
    expect(ledgerEntries.map((entry) => [entry.entryType, entry.amountPoints])).toEqual([
      [LoyaltyPointsLedgerEntryType.EARN, 80],
      [LoyaltyPointsLedgerEntryType.REVERSAL, -25],
    ]);
    expect(balance).toBe(55);
  });

  it("caps payment invalidation reversals at the earned eligible settled amount", async () => {
    const client = await createVerifiedClient();
    const { product, price } = await createCatalogProduct({
      namePrefix: "Eligible Strap",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 4_000,
    });

    await upsertLoyaltyProgramSettings({
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      maxManualGrantPoints: 5_000,
      eligibleProductIds: [product.id],
    });

    const { order, stripePayment } = await createOrderFixture({
      clientId: client.id,
      productId: product.id,
      priceId: price.id,
      unitAmountMinor: 4_000,
      orderStatus: OrderStatus.PAID,
      paymentStatus: PaymentStatus.SUCCEEDED,
    });

    await settleLoyaltyForSettledOrder({
      orderId: order.id,
      paymentId: stripePayment.id,
    });

    const result = await reverseLoyaltyForPaymentInvalidation({
      actor: { type: "SYSTEM", label: "chargeback-handler" },
      orderId: order.id,
      paymentId: stripePayment.id,
      invalidatedAmountMinor: 9_999,
      reason: "Full payment invalidation exceeded recorded eligible amount.",
      idempotencyKey: `loyalty:reversal:payment:${stripePayment.id}:over-cap`,
    });

    const ledgerEntries = await prisma.loyaltyPointsLedgerEntry.findMany({
      where: { orderId: order.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { entryType: true, amountPoints: true },
    });

    expect(result).toMatchObject({ outcome: "created" });
    expect(ledgerEntries).toEqual([
      { entryType: LoyaltyPointsLedgerEntryType.EARN, amountPoints: 40 },
      { entryType: LoyaltyPointsLedgerEntryType.REVERSAL, amountPoints: -40 },
    ]);
  });
});
