import "./helpers/setup-env";
import {
  BookingPaymentSelection,
  BookingStatus,
  EntitlementScope,
  EntitlementType,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
  StudioSessionStatus,
  UserActivationStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

const createStripeCheckoutSessionMock = vi.fn();
const retrieveStripeCheckoutSessionMock = vi.fn();

vi.mock("../../src/auth", () => ({
  auth: vi.fn(async () => null),
}));

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
    webhookSecret: "whsec_123",
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

import { auth } from "../../src/auth";
import { POST as createCheckoutSession } from "../../src/app/api/checkout/session/route";

const sameOriginJsonHeaders = {
  "content-type": "application/json",
  origin: "http://localhost",
  referer: "http://localhost/test",
  "x-forwarded-host": "localhost",
  "x-forwarded-proto": "http",
};

async function createBookingWithSelection(input: {
  paymentSelection: BookingPaymentSelection;
  withClient?: boolean;
  stripePriceId?: string | null;
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
      stripePriceId:
        input.stripePriceId === undefined ? `price_checkout_${Date.now()}` : input.stripePriceId,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
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

  return { booking, client, price, serviceSlug: classType.slug };
}

describe("POST /api/checkout/session", () => {
  beforeEach(async () => {
    createStripeCheckoutSessionMock.mockReset();
    retrieveStripeCheckoutSessionMock.mockReset();
    createStripeCheckoutSessionMock.mockResolvedValue({
      id: `cs_test_${Date.now()}`,
      url: "https://checkout.stripe.com/pay/cs_test_123",
    });
    retrieveStripeCheckoutSessionMock.mockImplementation(async (id: string) => ({
      id,
      url: "https://checkout.stripe.com/pay/cs_test_123",
    }));
    vi.mocked(auth).mockResolvedValue(null);
    await resetDb();
  });


  it("rejects checkout session creation when Origin is cross-site", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
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
        headers: { ...sameOriginJsonHeaders, origin: "https://evil.example", referer: "https://evil.example/test" },
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CSRF_ORIGIN_MISMATCH" });
  });

  it("rejects checkout session creation when both Origin and Referer are missing", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
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
        headers: { ...sameOriginJsonHeaders, origin: "", referer: "" },
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CSRF_ORIGIN_MISMATCH" });
  });

  it("creates checkout session for SINGLE_SESSION and creates payment record", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
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
        headers: sameOriginJsonHeaders,
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
    expect(payments[0]?.orderId).toBeTruthy();

    const booking = await prisma.booking.findUnique({
      where: { id: fixture.booking.id },
      select: { orderId: true },
    });
    expect(booking?.orderId).toBeTruthy();

    const order = await prisma.order.findUnique({
      where: { id: booking?.orderId ?? "" },
      select: { status: true },
    });
    expect(order?.status).toBe(OrderStatus.PLACED);
    const stripeArgs = createStripeCheckoutSessionMock.mock.calls[0]?.[0] as
      | { params?: { line_items?: Array<{ price?: string; quantity?: number }> } }
      | undefined;
    expect(stripeArgs?.params?.line_items?.[0]?.price).toBe(fixture.price.stripePriceId);
    expect(stripeArgs?.params?.line_items?.[0]?.quantity).toBe(1);
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
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("persists booking order/payment totals from selected DB price when draft totals drift", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
      withClient: true,
    });

    await prisma.booking.update({
      where: { id: fixture.booking.id },
      data: {
        draftAmountMinor: fixture.price.unitAmountMinor + 999,
        draftCurrencyCode: "USD",
      },
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
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findFirst({
      where: { bookingId: fixture.booking.id, provider: PaymentProvider.STRIPE },
      select: { amountMinor: true, currencyCode: true, orderId: true },
    });
    expect(payment?.amountMinor).toBe(fixture.price.unitAmountMinor);
    expect(payment?.currencyCode).toBe(fixture.price.currencyCode);

    const order = await prisma.order.findUnique({
      where: { id: payment?.orderId ?? "" },
      select: { totalAmountMinor: true, currencyCode: true },
    });
    expect(order?.totalAmountMinor).toBe(fixture.price.unitAmountMinor);
    expect(order?.currencyCode).toBe(fixture.price.currencyCode);
  });

  it("rejects checkout for booking price without DB stripePriceId", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
      withClient: true,
      stripePriceId: null,
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
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );
    const body = (await response.json()) as { code?: string; error?: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("INVALID_SELECTION");
    expect(createStripeCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("rejects checkout when authenticated user is not a client", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
      withClient: true,
    });
    const admin = await prisma.user.create({
      data: {
        name: "Admin Checkout",
        email: `admin.checkout.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    await prisma.booking.update({
      where: { id: fixture.booking.id },
      data: { clientId: admin.id },
    });

    vi.mocked(auth).mockResolvedValue({
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );
    const body = (await response.json()) as { code?: string };

    expect(response.status).toBe(401);
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  it("rejects checkout when authenticated client is inactive", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
      withClient: true,
    });

    await prisma.user.update({
      where: { id: fixture.client!.id },
      data: {
        activationStatus: UserActivationStatus.DISABLED,
      },
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
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );
    const body = (await response.json()) as { code?: string };

    expect(response.status).toBe(401);
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  it("rejects checkout creation for EXISTING_PLAN", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.EXISTING_PLAN,
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
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("reuses existing pending payment record on retry", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
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

    await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: { ...sameOriginJsonHeaders, "Idempotency-Key": "booking_retry_01" },
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );
    await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: { ...sameOriginJsonHeaders, "Idempotency-Key": "booking_retry_01" },
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );

    const payments = await prisma.payment.findMany({
      where: { bookingId: fixture.booking.id, provider: PaymentProvider.STRIPE },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.orderId).toBeTruthy();

    const orderCount = await prisma.order.count({
      where: { bookings: { some: { id: fixture.booking.id } } },
    });
    expect(orderCount).toBe(1);
    expect(createStripeCheckoutSessionMock).toHaveBeenCalledTimes(1);
    expect(retrieveStripeCheckoutSessionMock).toHaveBeenCalledTimes(1);
  });

  it("reuses existing Stripe session when idempotency header changes", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
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

    const first = await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: { ...sameOriginJsonHeaders, "Idempotency-Key": "booking_idem_AAA" },
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );
    const second = await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: { ...sameOriginJsonHeaders, "Idempotency-Key": "booking_idem_BBB" },
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(createStripeCheckoutSessionMock).toHaveBeenCalledTimes(1);
    expect(retrieveStripeCheckoutSessionMock).toHaveBeenCalledTimes(1);

    const firstCall = createStripeCheckoutSessionMock.mock.calls[0]?.[0] as
      | { idempotencyKey?: string }
      | undefined;
    expect(firstCall?.idempotencyKey).toContain("booking-checkout:");
    expect(firstCall?.idempotencyKey).not.toContain("booking_idem_AAA");
    expect(firstCall?.idempotencyKey).not.toContain("booking_idem_BBB");
  });

  it("keeps server-side idempotency stable when Idempotency-Key is missing or malformed", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
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

    const first = await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );
    const second = await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: { ...sameOriginJsonHeaders, "Idempotency-Key": "*** malformed ###" },
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(createStripeCheckoutSessionMock).toHaveBeenCalledTimes(1);
    expect(retrieveStripeCheckoutSessionMock).toHaveBeenCalledTimes(1);
  });

  it("reuses synthetic E2E checkout session without Stripe retrieval on retry", async () => {
    const previousE2EMode = process.env.E2E_TEST_MODE;
    process.env.E2E_TEST_MODE = "1";

    try {
      const fixture = await createBookingWithSelection({
        paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
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

      const first = await createCheckoutSession(
        new Request("http://localhost/api/checkout/session", {
          method: "POST",
          headers: sameOriginJsonHeaders,
          body: JSON.stringify({ bookingId: fixture.booking.id }),
        }),
      );
      const firstBody = (await first.json()) as { checkout?: { checkoutUrl?: string; checkoutSessionId?: string } };
      expect(first.status).toBe(200);
      const firstSessionId = firstBody.checkout?.checkoutSessionId;
      expect(firstSessionId).toContain("cs_e2e_");

      const second = await createCheckoutSession(
        new Request("http://localhost/api/checkout/session", {
          method: "POST",
          headers: sameOriginJsonHeaders,
          body: JSON.stringify({ bookingId: fixture.booking.id }),
        }),
      );
      const secondBody = (await second.json()) as { checkout?: { checkoutUrl?: string; checkoutSessionId?: string } };
      expect(second.status).toBe(200);
      expect(secondBody.checkout?.checkoutSessionId).toBe(firstSessionId);
      expect(secondBody.checkout?.checkoutUrl).toContain(`/payment/success?bookingId=${fixture.booking.id}&session_id=`);
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

  it("keeps a single pending payment/order under concurrent duplicate submits", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
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

    const requestBody = JSON.stringify({ bookingId: fixture.booking.id });
    const requestHeaders = { ...sameOriginJsonHeaders, "Idempotency-Key": "booking_race_01" };
    const [first, second] = await Promise.all([
      createCheckoutSession(
        new Request("http://localhost/api/checkout/session", {
          method: "POST",
          headers: requestHeaders,
          body: requestBody,
        }),
      ),
      createCheckoutSession(
        new Request("http://localhost/api/checkout/session", {
          method: "POST",
          headers: requestHeaders,
          body: requestBody,
        }),
      ),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 200]);

    const paymentCount = await prisma.payment.count({
      where: { bookingId: fixture.booking.id, provider: PaymentProvider.STRIPE },
    });
    const orderCount = await prisma.order.count({
      where: { bookings: { some: { id: fixture.booking.id } } },
    });
    expect(paymentCount).toBe(1);
    expect(orderCount).toBe(1);
  });
  it("returns 409 for already-processed (non-pending) booking and does not create checkout", async () => {
    const fixture = await createBookingWithSelection({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
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

    await prisma.booking.update({
      where: { id: fixture.booking.id },
      data: { status: BookingStatus.CONFIRMED },
    });

    const response = await createCheckoutSession(
      new Request("http://localhost/api/checkout/session", {
        method: "POST",
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({ bookingId: fixture.booking.id }),
      }),
    );
    const body = (await response.json()) as { code?: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("BOOKING_NOT_PENDING");
    expect(createStripeCheckoutSessionMock).not.toHaveBeenCalled();

    const paymentCount = await prisma.payment.count({
      where: { bookingId: fixture.booking.id, provider: PaymentProvider.STRIPE },
    });
    expect(paymentCount).toBe(0);
  });
});
