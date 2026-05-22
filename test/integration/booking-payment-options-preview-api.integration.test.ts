import "./helpers/setup-env";
import {
  BillingInterval,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  PaymentProvider,
  PriceType,
  ProductType,
  Role,
  SubscriptionStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

vi.mock("../../src/auth", () => ({
  auth: vi.fn(async () => null),
}));

import { auth } from "../../src/auth";
import { GET as previewPaymentOptions } from "../../src/app/api/bookings/payment-options-preview/route";

async function seedCatalogue(serviceSlug = "vinyasa-yoga") {
  const category = await createClassCategory(prisma, {
    name: "Yoga Collective Classes",
    slug: `yoga-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });

  await createClassType(prisma, {
    categoryId: category.id,
    name: "Vinyasa Yoga",
    slug: serviceSlug,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const dropInProduct = await prisma.product.create({
    data: {
      name: "Drop-In",
      slug: `dropin-${Date.now()}`,
      productType: ProductType.DROP_IN_CLASS,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  await prisma.price.create({
    data: {
      productId: dropInProduct.id,
      lookupKey: `dropin-${Date.now()}`,
      name: "Drop-In One-Time",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 2200,
      isActive: true,
      isArchived: false,
    },
  });

  await prisma.entitlementRule.create({
    data: {
      productId: dropInProduct.id,
      entitlementType: EntitlementType.SINGLE_USE,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: 1,
      isActive: true,
    },
  });

  const packProduct = await prisma.product.create({
    data: {
      name: "10-Class Pack",
      slug: `pack-${Date.now()}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 2,
    },
  });

  await prisma.price.create({
    data: {
      productId: packProduct.id,
      lookupKey: `pack-${Date.now()}`,
      name: "Pack One-Time",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 15000,
      isActive: true,
      isArchived: false,
    },
  });

  await prisma.entitlementRule.create({
    data: {
      productId: packProduct.id,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: 10,
      isActive: true,
    },
  });

  return { serviceSlug, packProductId: packProduct.id };
}

describe("GET /api/bookings/payment-options-preview", () => {
  beforeEach(async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await resetDb();
  });

  it("returns inline options for no-plan user", async () => {
    const { serviceSlug } = await seedCatalogue(`service-${Date.now()}`);

    const response = await previewPaymentOptions(
      new Request(
        `http://localhost:3000/api/bookings/payment-options-preview?serviceSlug=${serviceSlug}&bookingIntent=SINGLE_BOOKING`,
      ),
    );
    const body = (await response.json()) as {
      paymentOptions: {
        singleSession: unknown;
        newPlanOptions: unknown[];
        existingPlans: unknown[];
      };
    };

    expect(response.status).toBe(200);
    expect(body.paymentOptions.singleSession).not.toBeNull();
    expect(body.paymentOptions.newPlanOptions.length).toBeGreaterThan(0);
    expect(body.paymentOptions.existingPlans).toHaveLength(0);
  });

  it("works without sessionId query parameter", async () => {
    const { serviceSlug } = await seedCatalogue(`service-${Date.now()}`);

    const response = await previewPaymentOptions(
      new Request(
        `http://localhost:3000/api/bookings/payment-options-preview?serviceSlug=${serviceSlug}&bookingIntent=USE_ENTITLEMENT`,
      ),
    );

    expect(response.status).toBe(200);
  });

  it("rejects legacy USE_PLAN preview intent after contract", async () => {
    const { serviceSlug } = await seedCatalogue(`service-${Date.now()}`);

    const response = await previewPaymentOptions(
      new Request(
        `http://localhost:3000/api/bookings/payment-options-preview?serviceSlug=${serviceSlug}&bookingIntent=USE_PLAN`,
      ),
    );

    expect(response.status).toBe(400);
  });

  it("returns existing eligible plans for authenticated user", async () => {
    const { serviceSlug, packProductId } = await seedCatalogue(`service-${Date.now()}`);
    const client = await prisma.user.create({
      data: {
        name: "Client",
        email: `client.preview.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const entitlement = await prisma.clientEntitlement.create({
      data: {
        clientId: client.id,
        productId: packProductId,
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        status: ClientEntitlementStatus.ACTIVE,
        activatedAt: new Date(),
      },
    });

    await prisma.creditLedgerEntry.create({
      data: {
        clientId: client.id,
        entitlementId: entitlement.id,
        entryType: CreditLedgerEntryType.GRANT,
        amount: 10,
      },
    });

    vi.mocked(auth).mockResolvedValue({
      user: {
        id: client.id,
        name: client.name,
        email: client.email,
      },
      expires: new Date(Date.now() + 3600000).toISOString(),
    });

    const response = await previewPaymentOptions(
      new Request(
        `http://localhost:3000/api/bookings/payment-options-preview?serviceSlug=${serviceSlug}&bookingIntent=USE_ENTITLEMENT`,
      ),
    );
    const body = (await response.json()) as {
      paymentOptions: {
        existingPlans: Array<{ entitlementId: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.paymentOptions.existingPlans.length).toBeGreaterThan(0);
    expect(body.paymentOptions.existingPlans[0]?.entitlementId).toBe(entitlement.id);
  });

  it("returns active subscription as usable existing plan when no entitlement exists", async () => {
    const { serviceSlug } = await seedCatalogue(`service-${Date.now()}`);
    const client = await prisma.user.create({
      data: {
        name: "Subscriber",
        email: `subscriber.preview.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Monthly Unlimited Collective",
        slug: `monthly-unlimited-${Date.now()}`,
        productType: ProductType.UNLIMITED_MEMBERSHIP,
        isActive: true,
        isArchived: false,
        sortOrder: 3,
      },
    });

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `monthly-unlimited-${Date.now()}`,
        name: "Monthly Unlimited",
        priceType: PriceType.RECURRING,
        currencyCode: "EUR",
        unitAmountMinor: 9900,
        billingInterval: BillingInterval.MONTH,
        billingIntervalCount: 1,
        isActive: true,
        isArchived: false,
      },
    });

    await prisma.entitlementRule.create({
      data: {
        productId: product.id,
        entitlementType: EntitlementType.UNLIMITED_ACCESS,
        entitlementScope: EntitlementScope.ALL_CLASSES,
        isActive: true,
      },
    });

    const now = new Date();
    await prisma.subscriptionContract.create({
      data: {
        clientId: client.id,
        productId: product.id,
        priceId: price.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        currentPeriodStart: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
        provider: PaymentProvider.STRIPE,
      },
    });

    vi.mocked(auth).mockResolvedValue({
      user: {
        id: client.id,
        name: client.name,
        email: client.email,
      },
      expires: new Date(Date.now() + 3600000).toISOString(),
    });

    const response = await previewPaymentOptions(
      new Request(
        `http://localhost:3000/api/bookings/payment-options-preview?serviceSlug=${serviceSlug}&bookingIntent=USE_ENTITLEMENT`,
      ),
    );
    const body = (await response.json()) as {
      paymentOptions: {
        existingPlans: Array<{ planSource: "CREDITS" | "SUBSCRIPTION" }>;
        ux: {
          recommended: {
            mode: "EXISTING_PLAN" | "SINGLE_SESSION" | "NEW_PLAN_PURCHASE" | null;
          };
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.paymentOptions.existingPlans.some((plan) => plan.planSource === "SUBSCRIPTION")).toBe(true);
    expect(body.paymentOptions.ux.recommended.mode).toBe("EXISTING_PLAN");
  });
});
