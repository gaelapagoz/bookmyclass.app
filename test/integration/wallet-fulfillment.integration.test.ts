import "./helpers/setup-env";

import {
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  GiftCardCodeStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
  UserActivationStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fulfillPaidCartOrder } from "../../src/lib/fulfillment/order-fulfillment-service";
import { clearCapturedTestEmails, getCapturedTestEmails } from "../../src/lib/email/resend-delivery";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

async function seedVerifiedClient() {
  return prisma.user.create({
    data: {
      name: "Fulfillment Test Client",
      email: `fulfill.${Date.now()}.${Math.random()}@example.test`,
      role: Role.CLIENT,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      isActive: true,
    },
  });
}

async function seedClassPackProduct(quantity: number) {
  const ts = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const product = await prisma.product.create({
    data: {
      name: `10-Class Pack ${ts}`,
      slug: `class-pack-${ts}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 0,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `class-pack-${ts}-once`,
      stripePriceId: `price_test_cp_${ts}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      name: "10-Class Pack",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 15000,
      isActive: true,
      isArchived: false,
    },
  });
  await prisma.entitlementRule.create({
    data: {
      productId: product.id,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity,
      isActive: true,
    },
  });
  return { product, price };
}

async function seedPaidOrderWithItems(
  clientId: string,
  items: Array<{ productId: string; priceId: string; unitAmountMinor: number }>,
  payments: Array<{ provider: PaymentProvider; method: PaymentMethod; amountMinor: number }> = [],
) {
  const total = items.reduce((sum, i) => sum + i.unitAmountMinor, 0);
  const order = await prisma.order.create({
    data: {
      clientId,
      subtotalAmountMinor: total,
      discountAmountMinor: 0,
      totalAmountMinor: total,
      currencyCode: "EUR",
      status: OrderStatus.PAID,
    },
  });
  for (const item of items) {
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: item.productId,
        priceId: item.priceId,
        quantity: 1,
        productNameSnapshot: "Class Pack",
        priceNameSnapshot: "One-time",
        unitAmountMinor: item.unitAmountMinor,
        lineSubtotalAmountMinor: item.unitAmountMinor,
        lineDiscountAmountMinor: 0,
        lineTotalAmountMinor: item.unitAmountMinor,
        currencyCode: "EUR",
      },
    });
  }
  const paymentInputs =
    payments.length > 0
      ? payments
      : [{ provider: PaymentProvider.INTERNAL, method: PaymentMethod.GIFT_CARD, amountMinor: total }];
  await prisma.payment.createMany({
    data: paymentInputs.map((payment) => ({
      orderId: order.id,
      provider: payment.provider,
      method: payment.method,
      status: PaymentStatus.SUCCEEDED,
      amountMinor: payment.amountMinor,
      currencyCode: "EUR",
      capturedAt: new Date(),
    })),
  });
  return order;
}

describe("fulfillPaidCartOrder — class pack (Issue 1: full wallet entitlement grant)", () => {
  beforeEach(async () => {
    await resetDb();
    clearCapturedTestEmails();
    process.env.E2E_TEST_MODE = "1";
  });

  it("grants ACTIVE ClientEntitlement for a CLASS_PACK in a PAID order", async () => {
    const client = await seedVerifiedClient();
    const { product, price } = await seedClassPackProduct(10);
    const order = await seedPaidOrderWithItems(client.id, [
      { productId: product.id, priceId: price.id, unitAmountMinor: 15000 },
    ]);

    await fulfillPaidCartOrder({ orderId: order.id, clientId: client.id });

    const entitlement = await prisma.clientEntitlement.findFirst({
      where: { clientId: client.id, productId: product.id },
      select: { status: true, entitlementType: true, entitlementScope: true },
    });
    expect(entitlement).not.toBeNull();
    expect(entitlement!.status).toBe(ClientEntitlementStatus.ACTIVE);
    expect(entitlement!.entitlementType).toBe(EntitlementType.CREDIT_PACK);
    expect(entitlement!.entitlementScope).toBe(EntitlementScope.COLLECTIVE_CLASSES);
  });

  it("grants 10 credits via CreditLedgerEntry for a CLASS_PACK", async () => {
    const client = await seedVerifiedClient();
    const { product, price } = await seedClassPackProduct(10);
    const order = await seedPaidOrderWithItems(client.id, [
      { productId: product.id, priceId: price.id, unitAmountMinor: 15000 },
    ]);

    await fulfillPaidCartOrder({ orderId: order.id, clientId: client.id });

    const credits = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: client.id, entryType: CreditLedgerEntryType.GRANT },
      _sum: { amount: true },
    });
    expect(credits._sum.amount).toBe(10);
  });

  it("sends a purchase confirmation email for a CLASS_PACK", async () => {
    const client = await seedVerifiedClient();
    const { product, price } = await seedClassPackProduct(10);
    const order = await seedPaidOrderWithItems(client.id, [
      { productId: product.id, priceId: price.id, unitAmountMinor: 15000 },
    ]);

    await fulfillPaidCartOrder({ orderId: order.id, clientId: client.id });

    const emails = getCapturedTestEmails();
    const confirmEmail = emails.find((e) => e.context === "purchase-confirmation");
    expect(confirmEmail).toBeDefined();
    expect(confirmEmail!.to).toContain(client.email.toLowerCase());
  });

  it("includes wallet and card contributions in the purchase confirmation email", async () => {
    const client = await seedVerifiedClient();
    const { product, price } = await seedClassPackProduct(10);
    const order = await seedPaidOrderWithItems(
      client.id,
      [{ productId: product.id, priceId: price.id, unitAmountMinor: 15000 }],
      [
        { provider: PaymentProvider.INTERNAL, method: PaymentMethod.GIFT_CARD, amountMinor: 5000 },
        { provider: PaymentProvider.STRIPE, method: PaymentMethod.CARD, amountMinor: 10000 },
      ],
    );

    await fulfillPaidCartOrder({ orderId: order.id, clientId: client.id });

    const confirmEmail = getCapturedTestEmails().find(
      (e) => e.context === "purchase-confirmation",
    );
    expect(confirmEmail?.html).toContain("Wallet credit applied");
    expect(confirmEmail?.html).toContain("Paid by card");
  });

  it("does not double-grant credits on replay (idempotent)", async () => {
    const client = await seedVerifiedClient();
    const { product, price } = await seedClassPackProduct(10);
    const order = await seedPaidOrderWithItems(client.id, [
      { productId: product.id, priceId: price.id, unitAmountMinor: 15000 },
    ]);

    await fulfillPaidCartOrder({ orderId: order.id, clientId: client.id });
    await fulfillPaidCartOrder({ orderId: order.id, clientId: client.id });

    const credits = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: client.id, entryType: CreditLedgerEntryType.GRANT },
      _sum: { amount: true },
    });
    expect(credits._sum.amount).toBe(10);

    const entitlementCount = await prisma.clientEntitlement.count({
      where: { clientId: client.id, productId: product.id },
    });
    expect(entitlementCount).toBe(1);

    const emails = getCapturedTestEmails().filter((e) => e.context === "purchase-confirmation");
    expect(emails).toHaveLength(1);
  });

  it("does not rollback fulfillment when purchase confirmation email fails", async () => {
    vi.doMock("@/lib/email/purchase-confirmation-email", () => ({
      sendPurchaseConfirmationEmail: vi.fn(async () => {
        throw new Error("email unavailable");
      }),
    }));
    const client = await seedVerifiedClient();
    const { product, price } = await seedClassPackProduct(10);
    const order = await seedPaidOrderWithItems(client.id, [
      { productId: product.id, priceId: price.id, unitAmountMinor: 15000 },
    ]);

    try {
      await fulfillPaidCartOrder({ orderId: order.id, clientId: client.id });
    } finally {
      vi.doUnmock("@/lib/email/purchase-confirmation-email");
    }

    const entitlement = await prisma.clientEntitlement.findFirst({
      where: { clientId: client.id, productId: product.id },
    });
    const credits = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: client.id, entryType: CreditLedgerEntryType.GRANT },
      _sum: { amount: true },
    });
    expect(entitlement).not.toBeNull();
    expect(credits._sum.amount).toBe(10);
  });

  it("does not grant entitlement for GIFT_CARD items (handled separately)", async () => {
    const ts = `${Date.now()}-${Math.random()}`;
    const client = await seedVerifiedClient();
    const gcProduct = await prisma.product.create({
      data: {
        name: `GC ${ts}`,
        slug: `gc-${ts}`,
        productType: ProductType.GIFT_CARD,
        isActive: true,
        isArchived: false,
        sortOrder: 0,
      },
    });
    const gcPrice = await prisma.price.create({
      data: {
        productId: gcProduct.id,
        lookupKey: `gc-price-${ts}`,
        name: "Gift Card",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 2500,
        isActive: true,
        isArchived: false,
      },
    });
    const order = await seedPaidOrderWithItems(client.id, [
      { productId: gcProduct.id, priceId: gcPrice.id, unitAmountMinor: 2500 },
    ]);

    await fulfillPaidCartOrder({ orderId: order.id, clientId: client.id });

    const entitlementCount = await prisma.clientEntitlement.count({
      where: { clientId: client.id },
    });
    expect(entitlementCount).toBe(0);
  });

  it("ignores orders belonging to a different client", async () => {
    const owner = await seedVerifiedClient();
    const attacker = await seedVerifiedClient();
    const { product, price } = await seedClassPackProduct(10);
    const order = await seedPaidOrderWithItems(owner.id, [
      { productId: product.id, priceId: price.id, unitAmountMinor: 15000 },
    ]);

    await fulfillPaidCartOrder({ orderId: order.id, clientId: attacker.id });

    const entitlementCount = await prisma.clientEntitlement.count({
      where: { clientId: attacker.id },
    });
    expect(entitlementCount).toBe(0);
  });
});

describe("fulfillPaidCartOrder — gift card code issuance in paid order", () => {
  beforeEach(async () => {
    await resetDb();
    clearCapturedTestEmails();
    process.env.E2E_TEST_MODE = "1";
  });

  it("issues a GiftCardCode for GIFT_CARD items in a PAID order", async () => {
    const ts = `${Date.now()}-${Math.random()}`;
    const client = await seedVerifiedClient();
    const gcProduct = await prisma.product.create({
      data: {
        name: `GC ${ts}`,
        slug: `gc-${ts}`,
        productType: ProductType.GIFT_CARD,
        isActive: true,
        isArchived: false,
        sortOrder: 0,
      },
    });
    const gcPrice = await prisma.price.create({
      data: {
        productId: gcProduct.id,
        lookupKey: `gc-price-${ts}`,
        name: "Gift Card",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 5000,
        isActive: true,
        isArchived: false,
      },
    });
    const order = await seedPaidOrderWithItems(client.id, [
      { productId: gcProduct.id, priceId: gcPrice.id, unitAmountMinor: 5000 },
    ]);

    await fulfillPaidCartOrder({ orderId: order.id, clientId: client.id });

    const code = await prisma.giftCardCode.findFirst({
      where: { purchasedById: client.id },
      select: { status: true, amountMinor: true },
    });
    expect(code).not.toBeNull();
    expect(code!.status).toBe(GiftCardCodeStatus.ISSUED);
    expect(code!.amountMinor).toBe(5000);
  });
});
