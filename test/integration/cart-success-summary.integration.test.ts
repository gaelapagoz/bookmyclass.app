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
  discountAmountMinor?: number;
  couponCodeSnapshot?: string | null;
  walletAmountMinor?: number;
  loyaltyCreditAmountMinor?: number;
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
      discountAmountMinor: input.discountAmountMinor ?? 0,
      totalAmountMinor: 11000 - (input.discountAmountMinor ?? 0),
      currencyCode: "EUR",
      status: input.orderStatus,
      couponCodeSnapshot: input.couponCodeSnapshot ?? null,
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
      amountMinor:
        11000
        - (input.discountAmountMinor ?? 0)
        - (input.walletAmountMinor ?? 0)
        - (input.loyaltyCreditAmountMinor ?? 0),
      currencyCode: "EUR",
      checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
    },
  });

  if ((input.loyaltyCreditAmountMinor ?? 0) > 0) {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: input.paymentStatus,
        method: PaymentMethod.LOYALTY_CREDIT,
        provider: PaymentProvider.INTERNAL,
        amountMinor: input.loyaltyCreditAmountMinor ?? 0,
        currencyCode: "EUR",
        checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
      },
    });
  }

  if ((input.walletAmountMinor ?? 0) > 0) {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: input.paymentStatus,
        method: PaymentMethod.GIFT_CARD,
        provider: PaymentProvider.INTERNAL,
        amountMinor: input.walletAmountMinor ?? 0,
        currencyCode: "EUR",
        checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
      },
    });
  }

  return { client, checkoutSessionId, orderId: order.id };
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
    expect(state.discountAmountMinor).toBe(0);
    expect(state.totalAmountMinor).toBe(11000);
    expect(state.totalPaidAmountMinor).toBe(11000);
    expect(state.stripePaidAmountMinor).toBe(11000);
    expect(state.currencyCode).toBe("EUR");
    expect(state.couponCodeSnapshot).toBeNull();
    expect(state.loyaltyCreditAmountMinor).toBe(0);
    expect(state.walletAmountMinor).toBe(0);
    expect(state.stripeCheckoutSessionId).toBe(fixture.checkoutSessionId);
    expect(state.hasZeroValuePayment).toBe(false);
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
    expect(pendingState.stripePaidAmountMinor).toBe(0);

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
    expect(failedState.stripePaidAmountMinor).toBe(0);
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

  it("returns coupon, loyalty, wallet, and Stripe reference fields from the server read model", async () => {
    const fixture = await createCartSuccessFixture({
      paymentStatus: PaymentStatus.SUCCEEDED,
      orderStatus: OrderStatus.PAID,
      discountAmountMinor: 2000,
      couponCodeSnapshot: "SAVE20",
      loyaltyCreditAmountMinor: 1500,
      walletAmountMinor: 3000,
    });

    const state = await getCartCheckoutSuccessState({
      checkoutSessionId: fixture.checkoutSessionId,
      userId: fixture.client.id,
    });

    expect(state.discountAmountMinor).toBe(2000);
    expect(state.couponCodeSnapshot).toBe("SAVE20");
    expect(state.loyaltyCreditAmountMinor).toBe(1500);
    expect(state.walletAmountMinor).toBe(3000);
    expect(state.stripePaidAmountMinor).toBe(4500);
    expect(state.stripeCheckoutSessionId).toBe(fixture.checkoutSessionId);
    expect(state.totalAmountMinor).toBe(9000);
    expect(state.totalPaidAmountMinor).toBe(9000);
  });

  it("uses the latest Stripe payment reference when an order has multiple checkout attempts", async () => {
    const fixture = await createCartSuccessFixture({
      paymentStatus: PaymentStatus.SUCCEEDED,
      orderStatus: OrderStatus.PAID,
    });

    const latestCheckoutSessionId = `cs_cart_success_retry_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await prisma.payment.create({
      data: {
        orderId: fixture.orderId,
        status: PaymentStatus.SUCCEEDED,
        method: PaymentMethod.CARD,
        provider: PaymentProvider.STRIPE,
        providerReference: latestCheckoutSessionId,
        stripeCheckoutSessionId: latestCheckoutSessionId,
        amountMinor: 11000,
        currencyCode: "EUR",
        checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
      },
    });

    const state = await getCartCheckoutSuccessState({
      checkoutSessionId: latestCheckoutSessionId,
      userId: fixture.client.id,
    });

    expect(state.stripeCheckoutSessionId).toBe(latestCheckoutSessionId);
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
    expect(state.discountAmountMinor).toBeNull();
    expect(state.totalAmountMinor).toBeNull();
    expect(state.totalPaidAmountMinor).toBeNull();
    expect(state.stripePaidAmountMinor).toBe(0);
    expect(state.currencyCode).toBeNull();
    expect(state.couponCodeSnapshot).toBeNull();
    expect(state.loyaltyCreditAmountMinor).toBe(0);
    expect(state.walletAmountMinor).toBe(0);
    expect(state.stripeCheckoutSessionId).toBeNull();
    expect(state.hasZeroValuePayment).toBe(false);
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
    expect(state.discountAmountMinor).toBeNull();
    expect(state.totalAmountMinor).toBeNull();
    expect(state.totalPaidAmountMinor).toBeNull();
    expect(state.stripePaidAmountMinor).toBe(0);
    expect(state.currencyCode).toBeNull();
    expect(state.couponCodeSnapshot).toBeNull();
    expect(state.loyaltyCreditAmountMinor).toBe(0);
    expect(state.walletAmountMinor).toBe(0);
    expect(state.stripeCheckoutSessionId).toBeNull();
    expect(state.hasZeroValuePayment).toBe(false);
  });
});

describe("cart success state — full-wallet orderId path (Phase 2.1)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function createFullWalletOrderFixture(input: {
    orderStatus: OrderStatus;
    paymentStatus: PaymentStatus;
    discountAmountMinor?: number;
    couponCodeSnapshot?: string | null;
    zeroValuePayment?: boolean;
    productType?: ProductType;
    productName?: string;
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
        name: input.productName ?? "Gift Card",
        slug: `orderid-success-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        productType: input.productType ?? ProductType.GIFT_CARD,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
    });
    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `orderid-price-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        name: `${input.productName ?? "Gift Card"} Price`,
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
        discountAmountMinor: input.discountAmountMinor ?? 0,
        totalAmountMinor: 2500 - (input.discountAmountMinor ?? 0),
        currencyCode: "EUR",
        status: input.orderStatus,
        couponCodeSnapshot: input.couponCodeSnapshot ?? null,
        notes: "Full wallet order test",
        items: {
          create: [
            {
              productId: product.id,
              priceId: price.id,
              quantity: 1,
              productNameSnapshot: input.productName ?? "Gift Card Snapshot",
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
        method: input.zeroValuePayment ? PaymentMethod.MANUAL : PaymentMethod.GIFT_CARD,
        provider: PaymentProvider.INTERNAL,
        amountMinor: input.zeroValuePayment ? 0 : 2500 - (input.discountAmountMinor ?? 0),
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
    expect(state.loyaltyCreditAmountMinor).toBe(0);
    expect(state.walletAmountMinor).toBe(2500);
    expect(state.stripePaidAmountMinor).toBe(0);
    expect(state.totalPaidAmountMinor).toBe(2500);
    expect(state.hasZeroValuePayment).toBe(false);
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

  it("returns zero-value internal payment state without Stripe reference for coupon-only orderId success", async () => {
    const fixture = await createFullWalletOrderFixture({
      orderStatus: OrderStatus.PAID,
      paymentStatus: PaymentStatus.SUCCEEDED,
      discountAmountMinor: 2500,
      couponCodeSnapshot: "FREE100",
      zeroValuePayment: true,
      productType: ProductType.CLASS_PACK,
      productName: "Class Pack Snapshot",
    });

    const state = await getCartCheckoutSuccessStateForOrder({
      orderId: fixture.order.id,
      userId: fixture.client.id,
    });

    expect(state.discountAmountMinor).toBe(2500);
    expect(state.couponCodeSnapshot).toBe("FREE100");
    expect(state.loyaltyCreditAmountMinor).toBe(0);
    expect(state.walletAmountMinor).toBe(0);
    expect(state.totalAmountMinor).toBe(0);
    expect(state.totalPaidAmountMinor).toBe(0);
    expect(state.stripePaidAmountMinor).toBe(0);
    expect(state.stripeCheckoutSessionId).toBeNull();
    expect(state.hasZeroValuePayment).toBe(true);
    expect(state.hasGiftCardItems).toBe(false);
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
