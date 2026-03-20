import "./helpers/setup-env";
import {
  BookingPaymentSelection,
  BookingStatus,
  EntitlementScope,
  EntitlementType,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
  StudioSessionStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

const createStripeCheckoutSessionMock = vi.fn();

vi.mock("../../src/auth", () => ({
  auth: vi.fn(async () => null),
}));

vi.mock("../../src/lib/payments/stripe", () => ({
  getStripeEnv: () => ({
    appUrl: "http://localhost:3000",
    publishableKey: "pk_test_123",
    secretKey: "sk_test_123",
    webhookSecret: "whsec_123",
  }),
  createStripeCheckoutSession: (...args: unknown[]) =>
    createStripeCheckoutSessionMock(...args),
}));

import { auth } from "../../src/auth";
import { POST as createCheckoutSession } from "../../src/app/api/checkout/session/route";

async function createBookingWithSelection(input: {
  paymentSelection: BookingPaymentSelection;
  withClient?: boolean;
}) {
  const category = await createClassCategory(prisma, {
    name: "Yoga Collective",
    slug: "yoga-collective",
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Vinyasa Yoga",
    slug: `vinyasa-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Teacher",
      email: `teacher.checkout.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Vinyasa Template",
      slug: `vinyasa-template-checkout-${Date.now()}`,
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 3);
  startsAt.setUTCHours(18, 0, 0, 0);

  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Vinyasa Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const productType =
    input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
      ? ProductType.CLASS_PACK
      : ProductType.DROP_IN_CLASS;
  const product = await prisma.product.create({
    data: {
      name: productType === ProductType.CLASS_PACK ? "10-Class Pack" : "Drop-In Class",
      slug: `${productType.toLowerCase()}-${Date.now()}`,
      productType,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `${product.slug}-price`,
      name: "Standard Price",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE ? 15000 : 2200,
      isActive: true,
      isArchived: false,
    },
  });
  await prisma.entitlementRule.create({
    data: {
      productId: product.id,
      entitlementType:
        input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
          ? EntitlementType.CREDIT_PACK
          : EntitlementType.SINGLE_USE,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE ? 10 : 1,
      isActive: true,
    },
  });

  const client = input.withClient
    ? await prisma.user.create({
        data: {
          name: "Client",
          email: `client.checkout.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      })
    : null;

  const booking = await prisma.booking.create({
    data: {
      studioSessionId: session.id,
      clientId: client?.id ?? null,
      status: BookingStatus.PENDING,
      paymentSelection: input.paymentSelection,
      selectedPriceId: price.id,
      draftAmountMinor: price.unitAmountMinor,
      draftCurrencyCode: "EUR",
      customerName: "Guest User",
      customerEmail: "guest@example.test",
      customerPhone: "+32000000000",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
    },
  });

  return { booking, client, serviceSlug: classType.slug };
}

describe("POST /api/checkout/session", () => {
  beforeEach(async () => {
    createStripeCheckoutSessionMock.mockReset();
    createStripeCheckoutSessionMock.mockResolvedValue({
      id: `cs_test_${Date.now()}`,
      url: "https://checkout.stripe.com/pay/cs_test_123",
    });
    vi.mocked(auth).mockResolvedValue(null);
    await resetDb();
  });

  it("creates checkout session for SINGLE_SESSION and creates payment record", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
      withClient: false,
    });

    const response = await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );
    const body = (await response.json()) as {
      checkout: { checkoutUrl: string };
    };

    expect(response.status).toBe(200);
    expect(body.checkout.checkoutUrl).toContain("checkout.stripe.com");

    const payments = await prisma.payment.findMany({
      where: { bookingId: fixture.booking.id, provider: PaymentProvider.STRIPE },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe(PaymentStatus.PENDING);
  });

  it("creates checkout session for NEW_PLAN_PURCHASE when authenticated", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
      withClient: true,
    });

    vi.mocked(auth).mockResolvedValue({
      user: {
        id: fixture.client!.id,
        name: fixture.client!.name,
        email: fixture.client!.email,
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects checkout creation for EXISTING_PLAN", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.EXISTING_PLAN,
      withClient: true,
    });

    const response = await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("reuses existing pending payment record on retry", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
      withClient: false,
    });

    await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );
    await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );

    const payments = await prisma.payment.findMany({
      where: { bookingId: fixture.booking.id, provider: PaymentProvider.STRIPE },
    });
    expect(payments).toHaveLength(1);
  });
});
