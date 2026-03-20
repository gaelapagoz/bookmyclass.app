import "./helpers/setup-env";
import {
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  PriceType,
  ProductType,
  Role,
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
        `http://localhost:3000/api/bookings/payment-options-preview?serviceSlug=${serviceSlug}&bookingIntent=USE_PLAN`,
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
});
