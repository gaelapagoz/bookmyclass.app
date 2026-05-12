import "./helpers/setup-env";

import {
  CheckoutSource,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { getCartCheckoutSuccessState, getCartCheckoutSuccessStateForOrder } from "../../src/lib/cart/cart-success-state";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

async function createCartSuccessFixture(input: {
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
}) {
  const client = await prisma.user.create({
    data: {
      name: "Cart Success Client",
      email: `cart.success.${Date.now()}.${Math.random()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const productOne = await prisma.product.create({
    data: {
      name: "Cart Product A",
      slug: `cart-product-a-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });
  const productTwo = await prisma.product.create({
    data: {
      name: "Cart Product B",
      slug: `cart-product-b-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 2,
    },
  });

  const priceOne = await prisma.price.create({
    data: {
      productId: productOne.id,
      lookupKey: `cart-success-price-a-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: "Price A",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 5000,
      isActive: true,
      isArchived: false,
    },
  });
  const priceTwo = await prisma.price.create({
    data: {
      productId: productTwo.id,
      lookupKey: `cart-success-price-b-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: "Price B",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 3000,
      isActive: true,
      isArchived: false,
    },
  });

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      subtotalAmountMinor: 11000,
      discountAmountMinor: 0,
      totalAmountMinor: 11000,
      currencyCode: "EUR",
      status: input.orderStatus,
      notes: "Slice D cart success integration fixture",
      items: {
        create: [
          {
            productId: productOne.id,
            priceId: priceOne.id,
            quantity: 1,
            productNameSnapshot: "Snapshot Product A",
            priceNameSnapshot: "Snapshot Price A",
            unitAmountMinor: 5000,
            lineSubtotalAmountMinor: 5000,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: 5000,
            currencyCode: "EUR",
          },
          {
            productId: productTwo.id,
            priceId: priceTwo.id,
            quantity: 2,
            productNameSnapshot: "Snapshot Product B",
            priceNameSnapshot: "Snapshot Price B",
            unitAmountMinor: 3000,
            lineSubtotalAmountMinor: 6000,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: 6000,
            currencyCode: "EUR",
          },
        ],
      },
    },
  });

  const checkoutSessionId = `cs_cart_success_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  await prisma.payment.create({
    data: {
      orderId: order.id,
      status: input.paymentStatus,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: checkoutSessionId,
      stripeCheckoutSessionId: checkoutSessionId,
      amountMinor: 11000,
      currencyCode: "EUR",
      checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
    },
  });

  return { client, checkoutSessionId };
}

describe("cart success summary read model", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns DB-backed payment/order/order-item snapshots", async () => {
    const fixture = await createCartSuccessFixture({
      paymentStatus: PaymentStatus.SUCCEEDED,
      orderStatus: OrderStatus.PAID,
    });

    const state = await getCartCheckoutSuccessState({
      checkoutSessionId: fixture.checkoutSessionId,
      userId: fixture.client.id,
    });

    expect(state.paymentStatus).toBe(PaymentStatus.SUCCEEDED);
    expect(state.orderStatus).toBe(OrderStatus.PAID);
    expect(state.reconciliationState).toBe("CONFIRMED");
    expect(state.cartClearEligible).toBe(true);
    expect(state.subtotalAmountMinor).toBe(11000);
    expect(state.totalAmountMinor).toBe(11000);
    expect(state.currencyCode).toBe("EUR");
    expect(state.items).toEqual([
      expect.objectContaining({
        productNameSnapshot: "Snapshot Product A",
        priceNameSnapshot: "Snapshot Price A",
        quantity: 1,
        unitAmountMinor: 5000,
        lineTotalAmountMinor: 5000,
      }),
      expect.objectContaining({
        productNameSnapshot: "Snapshot Product B",
        priceNameSnapshot: "Snapshot Price B",
        quantity: 2,
        unitAmountMinor: 3000,
        lineTotalAmountMinor: 6000,
      }),
    ]);
    expect(state.hasGiftCardItems).toBe(false);
  });

  it("keeps cart clear ineligible until reconciliation is confirmed", async () => {
    const pendingFixture = await createCartSuccessFixture({
      paymentStatus: PaymentStatus.PENDING,
      orderStatus: OrderStatus.PLACED,
    });

    const pendingState = await getCartCheckoutSuccessState({
      checkoutSessionId: pendingFixture.checkoutSessionId,
      userId: pendingFixture.client.id,
    });

    expect(pendingState.reconciliationState).toBe("PENDING");
    expect(pendingState.cartClearEligible).toBe(false);

    const failedFixture = await createCartSuccessFixture({
      paymentStatus: PaymentStatus.FAILED,
      orderStatus: OrderStatus.CANCELLED,
    });

    const failedState = await getCartCheckoutSuccessState({
      checkoutSessionId: failedFixture.checkoutSessionId,
      userId: failedFixture.client.id,
    });

    expect(failedState.reconciliationState).toBe("FAILED");
    expect(failedState.cartClearEligible).toBe(false);
  });

  it("does not depend on client-side cart state to build summary", async () => {
    const fixture = await createCartSuccessFixture({
      paymentStatus: PaymentStatus.SUCCEEDED,
      orderStatus: OrderStatus.PAID,
    });

    await prisma.cartCheckoutIdempotency.create({
      data: {
        userId: fixture.client.id,
        idempotencyKey: "cartchk_123e4567-e89b-12d3-a456-426614174000",
        cartHash: "unrelated-cart-hash",
        state: "FAILED_STRIPE_UNCERTAIN",
      },
    });

    const state = await getCartCheckoutSuccessState({
      checkoutSessionId: fixture.checkoutSessionId,
      userId: fixture.client.id,
    });

    expect(state.reconciliationState).toBe("CONFIRMED");
    expect(state.items).toHaveLength(2);
    expect(state.totalAmountMinor).toBe(11000);
  });

  it("returns safe empty state for unknown session id", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Unknown Session Client",
        email: `unknown.session.${Date.now()}.${Math.random()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const state = await getCartCheckoutSuccessState({
      checkoutSessionId: "cs_unknown_session",
      userId: client.id,
    });

    expect(state.reconciliationState).toBe("PENDING");
    expect(state.paymentStatus).toBeNull();
    expect(state.orderStatus).toBeNull();
    expect(state.cartClearEligible).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.subtotalAmountMinor).toBeNull();
    expect(state.totalAmountMinor).toBeNull();
    expect(state.currencyCode).toBeNull();
  });

  it("does not expose summary when checkout session belongs to another user", async () => {
    const fixture = await createCartSuccessFixture({
      paymentStatus: PaymentStatus.SUCCEEDED,
      orderStatus: OrderStatus.PAID,
    });

    const otherUser = await prisma.user.create({
      data: {
        name: "Other Client",
        email: `other.client.${Date.now()}.${Math.random()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const state = await getCartCheckoutSuccessState({
      checkoutSessionId: fixture.checkoutSessionId,
      userId: otherUser.id,
    });

    expect(state.reconciliationState).toBe("PENDING");
    expect(state.paymentStatus).toBeNull();
    expect(state.orderStatus).toBeNull();
    expect(state.cartClearEligible).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.subtotalAmountMinor).toBeNull();
    expect(state.totalAmountMinor).toBeNull();
    expect(state.currencyCode).toBeNull();
  });
});

describe("cart success state — full-wallet orderId path (Phase 2.1)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function createFullWalletOrderFixture(input: {
    orderStatus: OrderStatus;
    paymentStatus: PaymentStatus;
  }) {
    const client = await prisma.user.create({
      data: {
        name: "Full Wallet Client",
        email: `full.wallet.${Date.now()}.${Math.random()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Gift Card",
        slug: `gc-orderId-success-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        productType: ProductType.GIFT_CARD,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
    });
    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `gc-orderId-price-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        name: "Gift Card Price",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 2500,
        isActive: true,
        isArchived: false,
      },
    });

    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 2500,
        discountAmountMinor: 0,
        totalAmountMinor: 2500,
        currencyCode: "EUR",
        status: input.orderStatus,
        notes: "Full wallet order test",
        items: {
          create: [
            {
              productId: product.id,
              priceId: price.id,
              quantity: 1,
              productNameSnapshot: "Gift Card Snapshot",
              priceNameSnapshot: "€25",
              unitAmountMinor: 2500,
              lineSubtotalAmountMinor: 2500,
              lineDiscountAmountMinor: 0,
              lineTotalAmountMinor: 2500,
              currencyCode: "EUR",
            },
          ],
        },
      },
    });

    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: input.paymentStatus,
        method: PaymentMethod.CARD,
        provider: PaymentProvider.INTERNAL,
        amountMinor: 2500,
        currencyCode: "EUR",
        checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
        ...(input.paymentStatus === PaymentStatus.SUCCEEDED ? { capturedAt: new Date() } : {}),
      },
    });

    return { client, order };
  }

  it("returns CONFIRMED and cartClearEligible:true for a full-wallet PAID order (orderId path)", async () => {
    const fixture = await createFullWalletOrderFixture({
      orderStatus: OrderStatus.PAID,
      paymentStatus: PaymentStatus.SUCCEEDED,
    });

    const state = await getCartCheckoutSuccessStateForOrder({
      orderId: fixture.order.id,
      userId: fixture.client.id,
    });

    expect(state.reconciliationState).toBe("CONFIRMED");
    expect(state.cartClearEligible).toBe(true);
    expect(state.orderStatus).toBe(OrderStatus.PAID);
    expect(state.paymentStatus).toBe(PaymentStatus.SUCCEEDED);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      productNameSnapshot: "Gift Card Snapshot",
      quantity: 1,
      lineTotalAmountMinor: 2500,
      productType: ProductType.GIFT_CARD,
    });
    expect(state.hasGiftCardItems).toBe(true);
  });

  it("returns PENDING and cartClearEligible:false when full-wallet order payment is not yet captured", async () => {
    const fixture = await createFullWalletOrderFixture({
      orderStatus: OrderStatus.PLACED,
      paymentStatus: PaymentStatus.PENDING,
    });

    const state = await getCartCheckoutSuccessStateForOrder({
      orderId: fixture.order.id,
      userId: fixture.client.id,
    });

    expect(state.reconciliationState).toBe("PENDING");
    expect(state.cartClearEligible).toBe(false);
  });

  it("rejects orderId belonging to another user", async () => {
    const fixture = await createFullWalletOrderFixture({
      orderStatus: OrderStatus.PAID,
      paymentStatus: PaymentStatus.SUCCEEDED,
    });

    const otherUser = await prisma.user.create({
      data: {
        name: "Other User",
        email: `other.user.orderId.${Date.now()}.${Math.random()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const state = await getCartCheckoutSuccessStateForOrder({
      orderId: fixture.order.id,
      userId: otherUser.id,
    });

    expect(state.reconciliationState).toBe("PENDING");
    expect(state.cartClearEligible).toBe(false);
    expect(state.items).toEqual([]);
  });
});
