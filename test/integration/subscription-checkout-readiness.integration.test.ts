import "./helpers/setup-env";

import {
  BillingInterval,
  CheckoutSource,
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

const createStripeCheckoutSessionMock = vi.fn();
const retrieveStripeCheckoutSessionMock = vi.fn();

vi.mock("../../src/lib/payments/stripe", () => ({
  getStripeServerEnv: () => ({
    appUrl: "http://localhost:3000",
    secretKey: "sk_test_123",
    webhookSecret: "whsec_123",
  }),
  getStripePublicEnv: () => ({
    publishableKey: "pk_test_123",
  }),
  getStripeEnv: () => ({
    appUrl: "http://localhost:3000",
    publishableKey: "pk_test_123",
    secretKey: "sk_test_123",
  }),
  createStripeCheckoutSessionWithIdempotency: (...args: unknown[]) =>
    createStripeCheckoutSessionMock(...args),
  getStripeClient: () => ({
    checkout: {
      sessions: {
        retrieve: (...args: unknown[]) => retrieveStripeCheckoutSessionMock(...args),
      },
    },
  }),
}));

import { createCheckoutSessionForCatalogProduct } from "../../src/lib/public-booking/checkout-service";
import { getActiveSubscriptionCatalogProducts } from "../../src/lib/subscription/subscription-products";
import { prisma as appPrisma } from "../../src/lib/db";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("subscription catalog readiness and checkout", () => {
  beforeEach(async () => {
    await resetDb();
    createStripeCheckoutSessionMock.mockReset();
    retrieveStripeCheckoutSessionMock.mockReset();
    createStripeCheckoutSessionMock.mockResolvedValue({
      id: "cs_test_subscription_123",
      url: "https://checkout.stripe.com/pay/cs_test_subscription_123",
    });
    retrieveStripeCheckoutSessionMock.mockImplementation(async (id: string) => ({
      id,
      url: "https://checkout.stripe.com/pay/cs_test_subscription_123",
    }));
  });

  async function createClient() {
    return prisma.user.create({
      data: {
        name: "Client",
        email: `client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });
  }

  async function createAdminUser() {
    return prisma.user.create({
      data: {
        name: "Admin",
        email: `admin.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });
  }

  async function createProduct(input: {
    name: string;
    stripePriceId: string | null;
    stripeSyncStatus?: StripeSyncStatus;
    priceType?: PriceType;
    billingInterval?: BillingInterval | null;
    billingIntervalCount?: number | null;
  }) {
    const product = await prisma.product.create({
      data: {
        name: input.name,
        slug: `${input.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
        productType: ProductType.UNLIMITED_MEMBERSHIP,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
    });

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `lookup-${product.id}`,
        name: `${input.name} Price`,
        priceType: input.priceType ?? PriceType.RECURRING,
        currencyCode: "EUR",
        unitAmountMinor: 7900,
        billingInterval: input.billingInterval === undefined ? BillingInterval.MONTH : input.billingInterval,
        billingIntervalCount: input.billingIntervalCount === undefined ? 1 : input.billingIntervalCount,
        stripePriceId: input.stripePriceId,
        stripeSyncStatus: input.stripeSyncStatus ?? (input.stripePriceId ? StripeSyncStatus.SYNCED : StripeSyncStatus.PENDING),
        isActive: true,
        isArchived: false,
      },
    });

    return { product, price };
  }

  it("shows only checkout-ready products in public subscription catalog", async () => {
    const ready = await createProduct({ name: "Ready Plan", stripePriceId: "price_ready_1" });
    await createProduct({ name: "Not Ready Plan", stripePriceId: null });

    const catalog = await getActiveSubscriptionCatalogProducts();

    expect(catalog.map((item) => item.productId)).toEqual([ready.product.id]);
    expect(catalog[0]?.checkoutEnabled).toBe(true);
  });

  it("creates checkout session for admin-created ready plan", async () => {
    const client = await createClient();
    const ready = await createProduct({ name: "Ready Plan", stripePriceId: "price_ready_2" });

    const result = await createCheckoutSessionForCatalogProduct({
      userId: client.id,
      productId: ready.product.id,
      successUrl: `http://localhost:3000/subscription/success?productId=${ready.product.id}`,
      cancelUrl: `http://localhost:3000/subscription/cancel?productId=${ready.product.id}`,
    });

    expect(result.checkoutUrl).toContain("checkout.stripe.com");
    const stripeArgs = createStripeCheckoutSessionMock.mock.calls[0]?.[0] as
      | { params?: { line_items?: Array<{ price?: string; quantity?: number }> } }
      | undefined;
    expect(stripeArgs?.params?.line_items?.[0]?.price).toBe(ready.price.stripePriceId);
    expect(stripeArgs?.params?.line_items?.[0]?.quantity).toBe(1);

    const payment = await prisma.payment.findUnique({ where: { id: result.paymentId } });
    expect(payment?.providerReference).toBe("cs_test_subscription_123");
  });

  it("rejects checkout for non-ready plan", async () => {
    const client = await createClient();
    const notReady = await createProduct({ name: "Not Ready Plan", stripePriceId: null });

    await expect(
      createCheckoutSessionForCatalogProduct({
        userId: client.id,
        productId: notReady.product.id,
        successUrl: `http://localhost:3000/subscription/success?productId=${notReady.product.id}`,
        cancelUrl: `http://localhost:3000/subscription/cancel?productId=${notReady.product.id}`,
      }),
    ).rejects.toMatchObject({ code: "CHECKOUT_NOT_CONFIGURED" });
  });

  it("reuses pending payment/order under concurrent duplicate submits", async () => {
    const client = await createClient();
    const ready = await createProduct({ name: "Ready Race Plan", stripePriceId: "price_ready_race_1" });

    const [first, second] = await Promise.all([
      createCheckoutSessionForCatalogProduct({
        userId: client.id,
        productId: ready.product.id,
        successUrl: `http://localhost:3000/subscription/success?productId=${ready.product.id}`,
        cancelUrl: `http://localhost:3000/subscription/cancel?productId=${ready.product.id}`,
      }),
      createCheckoutSessionForCatalogProduct({
        userId: client.id,
        productId: ready.product.id,
        successUrl: `http://localhost:3000/subscription/success?productId=${ready.product.id}`,
        cancelUrl: `http://localhost:3000/subscription/cancel?productId=${ready.product.id}`,
      }),
    ]);

    expect(first.checkoutSessionId).toBeTruthy();
    expect(second.checkoutSessionId).toBeTruthy();

    const orderCount = await prisma.order.count({
      where: {
        clientId: client.id,
        items: {
          some: {
            productId: ready.product.id,
            priceId: ready.price.id,
          },
        },
      },
    });
    const paymentCount = await prisma.payment.count({
      where: {
        order: {
          clientId: client.id,
          items: {
            some: {
              productId: ready.product.id,
              priceId: ready.price.id,
            },
          },
        },
        provider: PaymentProvider.STRIPE,
        status: PaymentStatus.PENDING,
      },
    });
    expect(orderCount).toBe(1);
    expect(paymentCount).toBe(1);
  });

  it("does not reuse cart pending payment for subscription checkout", async () => {
    const client = await createClient();
    const ready = await createProduct({ name: "Ready Isolation Plan", stripePriceId: "price_ready_iso_1" });

    const cartOrder = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: ready.price.unitAmountMinor,
        discountAmountMinor: 0,
        totalAmountMinor: ready.price.unitAmountMinor,
        currencyCode: ready.price.currencyCode,
        status: OrderStatus.PLACED,
        notes: "cart pending order",
        items: {
          create: {
            productId: ready.product.id,
            priceId: ready.price.id,
            quantity: 1,
            productNameSnapshot: ready.product.name,
            priceNameSnapshot: ready.price.name,
            unitAmountMinor: ready.price.unitAmountMinor,
            lineSubtotalAmountMinor: ready.price.unitAmountMinor,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: ready.price.unitAmountMinor,
            currencyCode: ready.price.currencyCode,
          },
        },
      },
    });
    const cartPayment = await prisma.payment.create({
      data: {
        orderId: cartOrder.id,
        status: PaymentStatus.PENDING,
        method: PaymentMethod.CARD,
        provider: PaymentProvider.STRIPE,
        checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
        amountMinor: ready.price.unitAmountMinor,
        currencyCode: ready.price.currencyCode,
      },
    });

    const result = await createCheckoutSessionForCatalogProduct({
      userId: client.id,
      productId: ready.product.id,
      successUrl: `http://localhost:3000/subscription/success?productId=${ready.product.id}`,
      cancelUrl: `http://localhost:3000/subscription/cancel?productId=${ready.product.id}`,
    });

    expect(result.paymentId).not.toBe(cartPayment.id);

    const refreshedCartPayment = await prisma.payment.findUnique({
      where: { id: cartPayment.id },
      select: { orderId: true, checkoutSource: true, amountMinor: true },
    });
    expect(refreshedCartPayment?.orderId).toBe(cartOrder.id);
    expect(refreshedCartPayment?.checkoutSource).toBe(CheckoutSource.CART_CHECKOUT_V1);
    expect(refreshedCartPayment?.amountMinor).toBe(ready.price.unitAmountMinor);
  });

  it("reuses synthetic E2E subscription session without Stripe retrieval on retry", async () => {
    const previousE2EMode = process.env.E2E_TEST_MODE;
    process.env.E2E_TEST_MODE = "1";

    try {
      const client = await createClient();
      const ready = await createProduct({ name: "Ready E2E Reuse Plan", stripePriceId: "price_ready_e2e_reuse_1" });

      const first = await createCheckoutSessionForCatalogProduct({
        userId: client.id,
        productId: ready.product.id,
        successUrl: `http://localhost:3000/subscription/success?productId=${ready.product.id}`,
        cancelUrl: `http://localhost:3000/subscription/cancel?productId=${ready.product.id}`,
      });

      const second = await createCheckoutSessionForCatalogProduct({
        userId: client.id,
        productId: ready.product.id,
        successUrl: `http://localhost:3000/subscription/success?productId=${ready.product.id}`,
        cancelUrl: `http://localhost:3000/subscription/cancel?productId=${ready.product.id}`,
      });

      expect(first.checkoutSessionId).toContain("cs_e2e_");
      expect(second.checkoutSessionId).toBe(first.checkoutSessionId);
      expect(second.checkoutUrl).toContain("/subscription/success?session_id=");
      expect(createStripeCheckoutSessionMock).not.toHaveBeenCalled();
      expect(retrieveStripeCheckoutSessionMock).not.toHaveBeenCalled();
    } finally {
      if (previousE2EMode === undefined) {
        delete process.env.E2E_TEST_MODE;
      } else {
        process.env.E2E_TEST_MODE = previousE2EMode;
      }
    }
  });

  it("rejects checkout when price has stripePriceId but sync is not SYNCED", async () => {
    const client = await createClient();
    const notSynced = await createProduct({
      name: "Unsynced Plan",
      stripePriceId: "price_unsynced_1",
      stripeSyncStatus: StripeSyncStatus.FAILED,
    });

    const catalog = await getActiveSubscriptionCatalogProducts();
    expect(catalog.find((item) => item.productId === notSynced.product.id)).toBeUndefined();

    await expect(
      createCheckoutSessionForCatalogProduct({
        userId: client.id,
        productId: notSynced.product.id,
        successUrl: `http://localhost:3000/subscription/success?productId=${notSynced.product.id}`,
        cancelUrl: `http://localhost:3000/subscription/cancel?productId=${notSynced.product.id}`,
      }),
    ).rejects.toMatchObject({ code: "CHECKOUT_NOT_CONFIGURED" });
  });

  it("rejects checkout when checkout invariants are invalid even with stripePriceId", async () => {
    const client = await createClient();
    const productId = `invalid-shape-product-${Date.now()}`;
    const findFirstSpy = vi.spyOn(appPrisma.product, "findFirst");
    findFirstSpy.mockResolvedValueOnce({
      id: productId,
      name: "Invalid Shape Plan",
      description: null,
      productType: ProductType.UNLIMITED_MEMBERSHIP,
      prices: [
        {
          id: `invalid-shape-price-${Date.now()}`,
          name: "Invalid Shape Price",
          priceType: PriceType.ONE_TIME,
          stripePriceId: "price_invalid_shape_1",
          stripeSyncStatus: StripeSyncStatus.SYNCED,
          unitAmountMinor: 7900,
          currencyCode: "EUR",
          billingInterval: BillingInterval.MONTH,
          billingIntervalCount: 1,
        },
      ],
    } as never);

    try {
      await expect(
        createCheckoutSessionForCatalogProduct({
          userId: client.id,
          productId,
          successUrl: `http://localhost:3000/subscription/success?productId=${productId}`,
          cancelUrl: `http://localhost:3000/subscription/cancel?productId=${productId}`,
        }),
      ).rejects.toMatchObject({ code: "CHECKOUT_NOT_CONFIGURED" });
    } finally {
      findFirstSpy.mockRestore();
    }
  });

  it("returns not-found error for missing product", async () => {
    const client = await createClient();

    await expect(
      createCheckoutSessionForCatalogProduct({
        userId: client.id,
        productId: "missing-product-id",
        successUrl: "http://localhost:3000/subscription/success?productId=missing",
        cancelUrl: "http://localhost:3000/subscription/cancel?productId=missing",
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });

  it("requires auth for catalog checkout", async () => {
    const ready = await createProduct({ name: "Ready Plan", stripePriceId: "price_ready_3" });

    await expect(
      createCheckoutSessionForCatalogProduct({
        userId: null,
        productId: ready.product.id,
        successUrl: `http://localhost:3000/subscription/success?productId=${ready.product.id}`,
        cancelUrl: `http://localhost:3000/subscription/cancel?productId=${ready.product.id}`,
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rejects catalog checkout for non-client authenticated users", async () => {
    const admin = await createAdminUser();
    const ready = await createProduct({ name: "Ready Plan", stripePriceId: "price_ready_4" });

    await expect(
      createCheckoutSessionForCatalogProduct({
        userId: admin.id,
        productId: ready.product.id,
        successUrl: `http://localhost:3000/subscription/success?productId=${ready.product.id}`,
        cancelUrl: `http://localhost:3000/subscription/cancel?productId=${ready.product.id}`,
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rejects catalog checkout for inactive client account", async () => {
    const client = await createClient();
    const ready = await createProduct({ name: "Ready Plan", stripePriceId: "price_ready_5" });

    await prisma.user.update({
      where: { id: client.id },
      data: {
        activationStatus: UserActivationStatus.DISABLED,
      },
    });

    await expect(
      createCheckoutSessionForCatalogProduct({
        userId: client.id,
        productId: ready.product.id,
        successUrl: `http://localhost:3000/subscription/success?productId=${ready.product.id}`,
        cancelUrl: `http://localhost:3000/subscription/cancel?productId=${ready.product.id}`,
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

