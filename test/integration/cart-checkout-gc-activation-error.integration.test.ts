import "./helpers/setup-env";

import {
  GiftCardLedgerEntryType,
  GiftCardReconciliationStatus,
  GiftCardWalletStatus,
  OrderStatus,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
  UserActivationStatus,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGiftCardManualReviewCase } from "../../src/lib/gift-cards/gift-card-reconciliation-service";

const issueGiftCardCodesForOrderMock = vi.fn();

vi.mock("../../src/lib/gift-cards/gift-card-code-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/gift-cards/gift-card-code-service")>();
  return {
    ...actual,
    issueGiftCardCodesForOrder: (...args: unknown[]) => issueGiftCardCodesForOrderMock(...args),
  };
});

import { startCartCheckout } from "../../src/lib/cart/cart-checkout-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

async function seedVerifiedClientForErrorTest() {
  return prisma.user.create({
    data: {
      name: "GC Error Test Client",
      email: `gc.error.test.${Date.now()}.${Math.random()}@example.test`,
      role: Role.CLIENT,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      isActive: true,
    },
    select: { id: true },
  });
}

async function seedGiftCardProductForErrorTest(unitAmountMinor: number) {
  const ts = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const product = await prisma.product.create({
    data: {
      name: "Gift Card Error Test",
      slug: `gc-error-test-${ts}`,
      productType: ProductType.GIFT_CARD,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
    select: { id: true },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `gc-error-price-${ts}`,
      stripePriceId: `price_gc_error_${ts}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      name: "Gift Card Error Price",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor,
      isActive: true,
      isArchived: false,
    },
    select: { id: true },
  });
  return { product, price };
}

async function seedClientWalletForErrorTest(clientId: string, balanceMinor: number) {
  return prisma.giftCardWallet.create({
    data: {
      clientId,
      currencyCode: "EUR",
      balanceMinor,
      status: GiftCardWalletStatus.ACTIVE,
    },
    select: { id: true },
  });
}

describe("cart checkout service — gift card code issuance failure (Phase 4.5C)", () => {
  beforeEach(async () => {
    await resetDb();
    issueGiftCardCodesForOrderMock.mockReset();
    process.env.STORE_ENABLED = "1";
    process.env.GIFT_CARD_PURCHASE_ENABLED = "1";
    process.env.GIFT_CARD_REDEMPTION_ENABLED = "1";
  });

  afterEach(() => {
    delete process.env.STORE_ENABLED;
    delete process.env.GIFT_CARD_PURCHASE_ENABLED;
    delete process.env.GIFT_CARD_REDEMPTION_ENABLED;
  });

  it("code issuance failure after capture: review case created, order PAID, idempotency SUCCEEDED, response completed, no wallet credit", async () => {
    const client = await seedVerifiedClientForErrorTest();
    const { product, price } = await seedGiftCardProductForErrorTest(2500);
    await seedClientWalletForErrorTest(client.id, 5000);

    // Simulate issueGiftCardCodesForOrder internal failure: creates review case, does NOT throw
    issueGiftCardCodesForOrderMock.mockImplementation(
      async (input: { orderId: string; clientId: string; paymentId?: string; items: Array<{ orderItemId: string; amountMinor: number }> }) => {
        for (const item of input.items) {
          await createGiftCardManualReviewCase({
            orderId: input.orderId,
            clientId: input.clientId,
            paymentId: input.paymentId ?? null,
            reason: "GIFT_CARD_CODE_ISSUANCE_FAILED",
            idempotencyKey: `gift-card:code-issuance-failed:order:${input.orderId}:item:${item.orderItemId}`,
            metadata: { orderItemId: item.orderItemId, amountMinor: item.amountMinor, source: "gift-card-code-service" },
          });
        }
      }
    );

    const response = await startCartCheckout({
      userId: client.id,
      idempotencyKey: `cart_gc_issuance_error_${Date.now()}`,
      clientCartVersion: "v1",
      lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
      walletAmountMinor: 2500,
    });

    expect(response.status).toBe(200);
    expect(response.body.type).toBe("completed");

    const order = await prisma.order.findFirst({
      where: { clientId: client.id },
      select: { id: true, status: true },
    });
    expect(order?.status).toBe(OrderStatus.PAID);

    const reviewCase = await prisma.giftCardReconciliationCase.findFirst({
      where: { orderId: order!.id },
    });
    expect(reviewCase).not.toBeNull();
    expect(reviewCase?.reason).toBe("GIFT_CARD_CODE_ISSUANCE_FAILED");
    expect(reviewCase?.status).toBe(GiftCardReconciliationStatus.MANUAL_REVIEW);

    const idempotencyRecord = await prisma.cartCheckoutIdempotency.findFirst({
      where: { userId: client.id },
      select: { state: true },
    });
    expect(idempotencyRecord?.state).toBe("SUCCEEDED");

    const activationEntries = await prisma.giftCardLedgerEntry.findMany({
      where: {
        wallet: { clientId: client.id },
        entryType: GiftCardLedgerEntryType.ACTIVATION,
      },
    });
    expect(activationEntries).toHaveLength(0);
  });
});
