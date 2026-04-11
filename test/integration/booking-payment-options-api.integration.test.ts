import "./helpers/setup-env";
import {
  BookingIntent,
  BookingPaymentSelection,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  PriceType,
  ProductType,
  Role,
  StudioSessionStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

vi.mock("../../src/auth", () => ({
  auth: vi.fn(async () => null),
}));

import { auth } from "../../src/auth";
import { POST as applyPlan } from "../../src/app/api/bookings/[bookingId]/apply-plan/route";
import { GET as getPaymentOptions } from "../../src/app/api/bookings/[bookingId]/payment-options/route";
import { createAdminPlan } from "../../src/lib/admin/admin-service";
import { backfillMissingPlanEntitlementRules } from "../../src/lib/admin/plan-entitlement-rules";

const sameOriginJsonHeaders = {
  "content-type": "application/json",
  origin: "http://localhost",
  referer: "http://localhost/test",
  "x-forwarded-host": "localhost",
  "x-forwarded-proto": "http",
};

async function createFixture(input: {
  bookingIntent: BookingIntent;
  createActivePlanCount: 0 | 1 | 2;
}) {
  const category = await createClassCategory(prisma, {
    name: "Yoga Collective Classes",
    slug: `yoga-collective-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Vinyasa Yoga",
    slug: `vinyasa-yoga-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Teacher",
      email: `teacher.pay.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Vinyasa Template",
      slug: `vinyasa-template-pay-${Date.now()}`,
      defaultCapacity: 20,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 5);
  startsAt.setUTCHours(18, 0, 0, 0);

  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Vinyasa Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 20,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const bookingUser = await prisma.user.create({
    data: {
      name: "Client User",
      email: `client.pay.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      studioSessionId: session.id,
      clientId: bookingUser.id,
      status: BookingStatus.PENDING,
      bookingIntent: input.bookingIntent,
      customerName: "Guest User",
      customerEmail: "guest@example.test",
      customerPhone: "+32000000010",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
    },
  });

  const dropInProduct = await prisma.product.create({
    data: {
      name: "Drop-In Class",
      slug: `drop-in-${Date.now()}`,
      productType: ProductType.DROP_IN_CLASS,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  await prisma.price.create({
    data: {
      productId: dropInProduct.id,
      lookupKey: `drop-in-${Date.now()}-one-time`,
      name: "Drop-In Single",
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
      slug: `pack-10-${Date.now()}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 2,
    },
  });

  await prisma.price.create({
    data: {
      productId: packProduct.id,
      lookupKey: `pack-10-${Date.now()}-one-time`,
      name: "10-Class Pack One-Time",
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

  const entitlements: string[] = [];
  for (let index = 0; index < input.createActivePlanCount; index += 1) {
    const entitlement = await prisma.clientEntitlement.create({
      data: {
        clientId: bookingUser.id,
        productId: packProduct.id,
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        status: ClientEntitlementStatus.ACTIVE,
        activatedAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.creditLedgerEntry.create({
      data: {
        clientId: bookingUser.id,
        entitlementId: entitlement.id,
        entryType: CreditLedgerEntryType.GRANT,
        amount: 10,
        notes: `Seed credits ${index + 1}`,
      },
    });

    entitlements.push(entitlement.id);
  }

  return {
    booking,
    bookingUser,
    entitlementIds: entitlements,
  };
}

describe("booking payment options api", () => {
  beforeEach(async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await resetDb();
  });

  it("single-booking intent still resolves to a payable default path when no plan exists", async () => {
    const fixture = await createFixture({
      bookingIntent: BookingIntent.SINGLE_BOOKING,
      createActivePlanCount: 0,
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: fixture.bookingUser.id, email: fixture.bookingUser.email, name: fixture.bookingUser.name },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await getPaymentOptions(new Request("http://localhost/api"), {
      params: Promise.resolve({ bookingId: fixture.booking.id }),
    });
    const body = (await response.json()) as {
      paymentOptions: {
        ux: { recommended: { mode: BookingPaymentSelection | null }; requiresChoice: boolean };
      };
    };

    expect(response.status).toBe(200);
    expect(body.paymentOptions.ux.recommended.mode).toBe(BookingPaymentSelection.NEW_PLAN_PURCHASE);
    expect(body.paymentOptions.ux.requiresChoice).toBe(false);
  });

  it("use-plan intent with one eligible plan auto-selects that plan", async () => {
    const fixture = await createFixture({
      bookingIntent: BookingIntent.USE_PLAN,
      createActivePlanCount: 1,
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: fixture.bookingUser.id, email: fixture.bookingUser.email, name: fixture.bookingUser.name },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await getPaymentOptions(new Request("http://localhost/api"), {
      params: Promise.resolve({ bookingId: fixture.booking.id }),
    });
    const body = (await response.json()) as {
      paymentOptions: {
        ux: { recommended: { mode: BookingPaymentSelection | null; entitlementId: string | null }; requiresChoice: boolean };
      };
    };

    expect(response.status).toBe(200);
    expect(body.paymentOptions.ux.recommended.mode).toBe(BookingPaymentSelection.EXISTING_PLAN);
    expect(body.paymentOptions.ux.recommended.entitlementId).toBe(fixture.entitlementIds[0]);
    expect(body.paymentOptions.ux.requiresChoice).toBe(false);
  });

  it("use-plan intent with no eligible plans guides to buy-plan fallback", async () => {
    const fixture = await createFixture({
      bookingIntent: BookingIntent.USE_PLAN,
      createActivePlanCount: 0,
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: fixture.bookingUser.id, email: fixture.bookingUser.email, name: fixture.bookingUser.name },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await getPaymentOptions(new Request("http://localhost/api"), {
      params: Promise.resolve({ bookingId: fixture.booking.id }),
    });
    const body = (await response.json()) as {
      paymentOptions: {
        existingPlans: unknown[];
        newPlanOptions: unknown[];
        ux: { recommended: { mode: BookingPaymentSelection | null } };
      };
    };

    expect(response.status).toBe(200);
    expect(body.paymentOptions.existingPlans).toHaveLength(0);
    expect(body.paymentOptions.newPlanOptions.length).toBeGreaterThan(0);
    expect(body.paymentOptions.ux.recommended.mode).toBe(BookingPaymentSelection.NEW_PLAN_PURCHASE);
  });

  it("includes admin-created class-pack plans in new plan options when scope matches", async () => {
    const fixture = await createFixture({
      bookingIntent: BookingIntent.USE_PLAN,
      createActivePlanCount: 0,
    });

    const adminPlan = await createAdminPlan({
      name: "Admin Collective Pack",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 9,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 12500,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: fixture.bookingUser.id, email: fixture.bookingUser.email, name: fixture.bookingUser.name },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await getPaymentOptions(new Request("http://localhost/api"), {
      params: Promise.resolve({ bookingId: fixture.booking.id }),
    });
    const body = (await response.json()) as {
      paymentOptions: {
        newPlanOptions: Array<{ productId: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.paymentOptions.newPlanOptions.some((option) => option.productId === adminPlan?.id)).toBe(true);
  });

  it("keeps admin-created private-class plans out of collective booking options", async () => {
    const fixture = await createFixture({
      bookingIntent: BookingIntent.USE_PLAN,
      createActivePlanCount: 0,
    });

    const privatePlan = await createAdminPlan({
      name: "Admin Private Session",
      productType: ProductType.PRIVATE_CLASS,
      isActive: true,
      sortOrder: 10,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 18900,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: fixture.bookingUser.id, email: fixture.bookingUser.email, name: fixture.bookingUser.name },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await getPaymentOptions(new Request("http://localhost/api"), {
      params: Promise.resolve({ bookingId: fixture.booking.id }),
    });
    const body = (await response.json()) as {
      paymentOptions: {
        newPlanOptions: Array<{ productId: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.paymentOptions.newPlanOptions.some((option) => option.productId === privatePlan?.id)).toBe(false);
  });

  it("backfills a legacy admin class-pack with missing entitlement rule so it appears in collective options", async () => {
    const fixture = await createFixture({
      bookingIntent: BookingIntent.USE_PLAN,
      createActivePlanCount: 0,
    });

    const legacyPlan = await prisma.product.create({
      data: {
        name: "Test Class",
        slug: `test-class-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
        isActive: true,
        isArchived: false,
        sortOrder: 50,
      },
      select: {
        id: true,
      },
    });

    await prisma.price.create({
      data: {
        productId: legacyPlan.id,
        lookupKey: `legacy-test-class-${Date.now()}`,
        name: "Test Class Price",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 5000,
        isActive: true,
        isArchived: false,
      },
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: fixture.bookingUser.id, email: fixture.bookingUser.email, name: fixture.bookingUser.name },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const beforeBackfillResponse = await getPaymentOptions(new Request("http://localhost/api"), {
      params: Promise.resolve({ bookingId: fixture.booking.id }),
    });
    const beforeBackfillBody = (await beforeBackfillResponse.json()) as {
      paymentOptions: {
        newPlanOptions: Array<{ productId: string }>;
      };
    };

    expect(beforeBackfillResponse.status).toBe(200);
    expect(
      beforeBackfillBody.paymentOptions.newPlanOptions.some((option) => option.productId === legacyPlan.id),
    ).toBe(false);

    await backfillMissingPlanEntitlementRules(prisma);

    const afterBackfillResponse = await getPaymentOptions(new Request("http://localhost/api"), {
      params: Promise.resolve({ bookingId: fixture.booking.id }),
    });
    const afterBackfillBody = (await afterBackfillResponse.json()) as {
      paymentOptions: {
        newPlanOptions: Array<{ productId: string }>;
      };
    };

    expect(afterBackfillResponse.status).toBe(200);
    expect(afterBackfillBody.paymentOptions.newPlanOptions.some((option) => option.productId === legacyPlan.id)).toBe(
      true,
    );
  });

  it("rejects apply-plan when Origin is cross-site", async () => {
    const fixture = await createFixture({
      bookingIntent: BookingIntent.USE_PLAN,
      createActivePlanCount: 1,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: fixture.bookingUser.id, email: fixture.bookingUser.email, name: fixture.bookingUser.name },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await applyPlan(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { ...sameOriginJsonHeaders, origin: "https://evil.example", referer: "https://evil.example/test" },
        body: JSON.stringify({ mode: "EXISTING_PLAN", entitlementId: fixture.entitlementIds[0] }),
      }),
      { params: Promise.resolve({ bookingId: fixture.booking.id }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CSRF_ORIGIN_MISMATCH" });
  });

  it("rejects apply-plan when both Origin and Referer are missing", async () => {
    const fixture = await createFixture({
      bookingIntent: BookingIntent.USE_PLAN,
      createActivePlanCount: 1,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: fixture.bookingUser.id, email: fixture.bookingUser.email, name: fixture.bookingUser.name },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await applyPlan(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { ...sameOriginJsonHeaders, origin: "", referer: "" },
        body: JSON.stringify({ mode: "EXISTING_PLAN", entitlementId: fixture.entitlementIds[0] }),
      }),
      { params: Promise.resolve({ bookingId: fixture.booking.id }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CSRF_ORIGIN_MISMATCH" });
  });

  it("applying active existing plan confirms booking and consumes one credit", async () => {
    const fixture = await createFixture({
      bookingIntent: BookingIntent.USE_PLAN,
      createActivePlanCount: 1,
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: fixture.bookingUser.id, email: fixture.bookingUser.email, name: fixture.bookingUser.name },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await applyPlan(
      new Request("http://localhost/api", {
        method: "POST",
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({
          mode: "EXISTING_PLAN",
          entitlementId: fixture.entitlementIds[0],
        }),
      }),
      { params: Promise.resolve({ bookingId: fixture.booking.id }) },
    );

    expect(response.status).toBe(200);

    const updated = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const consumeEntries = await prisma.creditLedgerEntry.findMany({
      where: {
        bookingId: fixture.booking.id,
        entitlementId: fixture.entitlementIds[0],
        entryType: CreditLedgerEntryType.CONSUME,
      },
    });

    expect(updated?.status).toBe(BookingStatus.CONFIRMED);
    expect(updated?.paymentSelection).toBe(BookingPaymentSelection.EXISTING_PLAN);
    expect(consumeEntries).toHaveLength(1);
    expect(consumeEntries[0]?.amount).toBe(-1);
  });
  it("keeps credit consume idempotent when existing-plan apply is submitted concurrently", async () => {
    const fixture = await createFixture({
      bookingIntent: BookingIntent.USE_PLAN,
      createActivePlanCount: 1,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: fixture.bookingUser.id, email: fixture.bookingUser.email, name: fixture.bookingUser.name },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await Promise.allSettled(
      Array.from({ length: 4 }).map(() =>
        applyPlan(
          new Request("http://localhost/api", {
            method: "POST",
            headers: sameOriginJsonHeaders,
            body: JSON.stringify({
              mode: "EXISTING_PLAN",
              entitlementId: fixture.entitlementIds[0],
            }),
          }),
          { params: Promise.resolve({ bookingId: fixture.booking.id }) },
        ),
      ),
    );

    const consumeEntries = await prisma.creditLedgerEntry.findMany({
      where: {
        bookingId: fixture.booking.id,
        entitlementId: fixture.entitlementIds[0],
        entryType: CreditLedgerEntryType.CONSUME,
      },
    });

    expect(consumeEntries).toHaveLength(1);
    expect(consumeEntries[0]?.idempotencyKey).toBeTruthy();
  });
});
