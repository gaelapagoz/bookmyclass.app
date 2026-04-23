import "./helpers/setup-env";

import { BillingInterval, PriceType, ProductType, Role, StripeSyncStatus, UserActivationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createStripeCheckoutSessionMock = vi.fn();

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
  createStripeCheckoutSession: (...args: unknown[]) => createStripeCheckoutSessionMock(...args),
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
    createStripeCheckoutSessionMock.mockResolvedValue({
      id: "cs_test_subscription_123",
      url: "https://checkout.stripe.com/pay/cs_test_subscription_123",
    });
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

