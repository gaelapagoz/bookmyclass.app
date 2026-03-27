import "./helpers/setup-env";
import {
  BookingPaymentSelection,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  OrderStatus,
  PaymentMethod,
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
import {
  getBookingPaymentOptions,
  getMyActivePlans,
} from "../../src/lib/public-booking/booking-payment-options-service";
import { getDashboardMembershipData } from "../../src/lib/dashboard/dashboard-service";

const verifyStripeWebhookEventMock = vi.fn();
const retrieveCheckoutSessionMock = vi.fn();
const retrieveSubscriptionMock = vi.fn();

vi.mock("../../src/lib/payments/stripe", () => ({
  verifyStripeWebhookEvent: (...args: unknown[]) => verifyStripeWebhookEventMock(...args),
  getStripeClient: () => ({
    checkout: {
      sessions: {
        retrieve: (...args: unknown[]) => retrieveCheckoutSessionMock(...args),
      },
    },
    subscriptions: {
      retrieve: (...args: unknown[]) => retrieveSubscriptionMock(...args),
    },
  }),
}));

import { POST as handleStripeWebhook } from "../../src/app/api/stripe/webhook/route";
import { reconcileCheckoutSessionAfterReturn } from "../../src/lib/public-booking/stripe-webhook-service";

async function createWebhookFixture(input: {
  paymentSelection: BookingPaymentSelection;
}) {
  const category = await createClassCategory(prisma, {
    name: "Yoga",
    slug: "yoga",
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Vinyasa",
    slug: `vinyasa-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Teacher",
      email: `teacher.webhook.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Template",
      slug: `template-webhook-${Date.now()}`,
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
      title: "Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const product = await prisma.product.create({
    data: {
      name: input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE ? "10-Class Pack" : "Drop-In",
      slug: `prod-webhook-${Date.now()}`,
      productType:
        input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
          ? ProductType.CLASS_PACK
          : ProductType.DROP_IN_CLASS,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `price-webhook-${Date.now()}`,
      name: "Standard",
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

  const client = await prisma.user.create({
    data: {
      name: "Client",
      email: `client.webhook.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      subtotalAmountMinor: price.unitAmountMinor,
      discountAmountMinor: 0,
      totalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
      notes: "Webhook fixture order",
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      priceId: price.id,
      quantity: 1,
      productNameSnapshot: product.name,
      priceNameSnapshot: price.name,
      unitAmountMinor: price.unitAmountMinor,
      lineSubtotalAmountMinor: price.unitAmountMinor,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  const booking = await prisma.booking.create({
    data: {
      studioSessionId: session.id,
      clientId: client.id,
      orderId: order.id,
      status: BookingStatus.PENDING,
      paymentSelection: input.paymentSelection,
      selectedPriceId: price.id,
      draftAmountMinor: price.unitAmountMinor,
      draftCurrencyCode: "EUR",
      customerName: "Client",
      customerEmail: client.email,
      customerPhone: "+32000000000",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
    },
  });

  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      orderId: order.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: `cs_test_${Date.now()}`,
      amountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  return { booking, payment, price, client, product, order };
}

async function createCatalogCheckoutFixture() {
  const category = await createClassCategory(prisma, {
    name: "Yoga",
    slug: `yoga-catalog-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Vinyasa",
    slug: `vinyasa-catalog-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Teacher Catalog",
      email: `teacher.catalog.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Catalog Template",
      slug: `template-catalog-${Date.now()}`,
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 3);
  startsAt.setUTCHours(18, 0, 0, 0);
  const studioSession = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Catalog Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const product = await prisma.product.create({
    data: {
      name: "Catalog 10-Class Pack",
      slug: `catalog-pack-${Date.now()}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `catalog-pack-${Date.now()}`,
      name: "Catalog 10-Class Pack",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 15000,
      isActive: true,
      isArchived: false,
    },
  });
  await prisma.entitlementRule.create({
    data: {
      productId: product.id,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: 10,
      isActive: true,
    },
  });

  const client = await prisma.user.create({
    data: {
      name: "Catalog Client",
      email: `client.catalog.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      subtotalAmountMinor: price.unitAmountMinor,
      discountAmountMinor: 0,
      totalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
      notes: "Catalog checkout fixture order",
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      priceId: price.id,
      quantity: 1,
      productNameSnapshot: product.name,
      priceNameSnapshot: price.name,
      unitAmountMinor: price.unitAmountMinor,
      lineSubtotalAmountMinor: price.unitAmountMinor,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: `cs_catalog_${Date.now()}`,
      amountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  const booking = await prisma.booking.create({
    data: {
      studioSessionId: studioSession.id,
      clientId: client.id,
      status: BookingStatus.PENDING,
      customerName: "Catalog Client",
      customerEmail: client.email,
      customerPhone: "+32000000000",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
    },
  });

  return { client, product, price, order, payment, booking };
}

async function createRecurringCatalogCheckoutFixture() {
  const product = await prisma.product.create({
    data: {
      name: "Monthly Unlimited Collective",
      slug: `monthly-unlimited-${Date.now()}`,
      productType: ProductType.UNLIMITED_MEMBERSHIP,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `monthly-unlimited-price-${Date.now()}`,
      name: "Monthly Unlimited",
      priceType: PriceType.RECURRING,
      currencyCode: "EUR",
      unitAmountMinor: 12900,
      billingInterval: "MONTH",
      billingIntervalCount: 1,
      stripePriceId: `price_monthly_${Date.now()}`,
      isActive: true,
      isArchived: false,
    },
  });

  await prisma.entitlementRule.create({
    data: {
      productId: product.id,
      entitlementType: EntitlementType.UNLIMITED_ACCESS,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: null,
      isActive: true,
    },
  });

  const client = await prisma.user.create({
    data: {
      name: "Recurring Client",
      email: `client.recurring.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      subtotalAmountMinor: price.unitAmountMinor,
      discountAmountMinor: 0,
      totalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
      notes: "Recurring catalog checkout fixture order",
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      priceId: price.id,
      quantity: 1,
      productNameSnapshot: product.name,
      priceNameSnapshot: price.name,
      unitAmountMinor: price.unitAmountMinor,
      lineSubtotalAmountMinor: price.unitAmountMinor,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: `cs_recurring_${Date.now()}`,
      amountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  return { client, product, price, order, payment };
}
describe("POST /api/stripe/webhook", () => {
  beforeEach(async () => {
    verifyStripeWebhookEventMock.mockReset();
    retrieveCheckoutSessionMock.mockReset();
    retrieveSubscriptionMock.mockReset();
    await resetDb();
  });

  it("confirms booking, payment, and order for single-session checkout", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    expect(payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(payment?.orderId).toBe(fixture.order.id);
    expect(order?.status).toBe(OrderStatus.PAID);
    expect(booking?.status).toBe(BookingStatus.CONFIRMED);
  });

  it("activates entitlement and confirms booking for plan purchase (idempotent)", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    });

    const request = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    });

    const responseOne = await handleStripeWebhook(request);
    expect(responseOne.status).toBe(200);

    const responseTwo = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(responseTwo.status).toBe(200);

    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });
    const entitlements = await prisma.clientEntitlement.findMany({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
    });
    const credits = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
    });
    const creditBalance = await prisma.creditLedgerEntry.aggregate({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
      _sum: { amount: true },
    });

    expect(payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(order?.status).toBe(OrderStatus.PAID);
    expect(booking?.status).toBe(BookingStatus.CONFIRMED);
    expect(booking?.selectedEntitlementId).toBeTruthy();
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0]?.orderId).toBe(fixture.order.id);
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.GRANT)).toHaveLength(1);
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.CONSUME)).toHaveLength(1);
    expect(creditBalance._sum.amount).toBe(9);
  });

  it("marks payment and order failed/cancelled when checkout expires", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.expired",
      data: {
        object: {
          id: fixture.payment.providerReference,
          metadata: {},
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    expect(payment?.status).toBe(PaymentStatus.FAILED);
    expect(order?.status).toBe(OrderStatus.CANCELLED);
    expect(booking?.status).toBe(BookingStatus.PENDING);
  });

  it("does not confirm booking when checkout.session.completed is unpaid", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "unpaid",
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });
    const entitlements = await prisma.clientEntitlement.count({ where: { clientId: fixture.client.id } });

    expect(booking?.status).toBe(BookingStatus.PENDING);
    expect(payment?.status).toBe(PaymentStatus.FAILED);
    expect(order?.status).toBe(OrderStatus.CANCELLED);
    expect(entitlements).toBe(0);
  });

  it("rejects missing stripe signature", async () => {
    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(400);
  });
  it("handles completed checkout with missing metadata by leaving unmatched records unchanged", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_missing_metadata_unmatched",
          payment_status: "paid",
          metadata: {},
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    expect(payment?.status).toBe(PaymentStatus.PENDING);
    expect(booking?.status).toBe(BookingStatus.PENDING);
    expect(order?.status).toBe(OrderStatus.PLACED);
  });

  it("handles invalid metadata identifiers without mutating unrelated records", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: "payment_does_not_exist",
            bookingId: "booking_does_not_exist",
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    expect(payment?.status).toBe(PaymentStatus.PENDING);
    expect(order?.status).toBe(OrderStatus.PLACED);
    expect(booking?.status).toBe(BookingStatus.PENDING);
  });
  it("keeps stable state across replayed completed events followed by expired", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    const completedEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    };

    verifyStripeWebhookEventMock.mockReturnValueOnce(completedEvent);
    const completedResponseOne = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(completedResponseOne.status).toBe(200);

    verifyStripeWebhookEventMock.mockReturnValueOnce(completedEvent);
    const completedResponseTwo = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(completedResponseTwo.status).toBe(200);

    verifyStripeWebhookEventMock.mockReturnValueOnce({
      type: "checkout.session.expired",
      data: {
        object: {
          id: fixture.payment.providerReference,
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            orderId: fixture.order.id,
          },
        },
      },
    });
    const expiredResponse = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(expiredResponse.status).toBe(200);

    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    const entitlements = await prisma.clientEntitlement.findMany({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
    });

    const credits = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
      },
    });

    const relatedPayments = await prisma.payment.findMany({
      where: {
        bookingId: fixture.booking.id,
        provider: PaymentProvider.STRIPE,
      },
    });
    const relatedOrders = await prisma.order.findMany({
      where: {
        bookings: {
          some: {
            id: fixture.booking.id,
          },
        },
      },
    });

    expect(payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(order?.status).toBe(OrderStatus.PAID);
    expect(booking?.status).toBe(BookingStatus.CONFIRMED);

    expect(entitlements).toHaveLength(1);
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.GRANT)).toHaveLength(1);
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.CONSUME)).toHaveLength(1);

    expect(relatedPayments).toHaveLength(1);
    expect(relatedOrders).toHaveLength(1);
  });
  it("activates catalog purchase entitlements and exposes them in booking payment options", async () => {
    const fixture = await createCatalogCheckoutFixture();

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
            productId: fixture.product.id,
            priceId: fixture.price.id,
            selectedPriceId: fixture.price.id,
            source: "subscription-catalog",
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const entitlements = await prisma.clientEntitlement.findMany({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
    });
    expect(entitlements).toHaveLength(1);

    const credits = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
      orderBy: { createdAt: "asc" },
    });
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.GRANT)).toHaveLength(1);
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.CONSUME)).toHaveLength(0);

    const plans = await getMyActivePlans(fixture.client.id);
    expect(plans.some((plan) => plan.productId === fixture.product.id && (plan.remainingCredits ?? 0) > 0)).toBe(true);

    const paymentOptions = await getBookingPaymentOptions({
      bookingId: fixture.booking.id,
      userId: fixture.client.id,
    });

    expect(
      paymentOptions.existingPlans.some(
        (plan) =>
          plan.productId === fixture.product.id &&
          plan.entitlementId === entitlements[0]?.id &&
          (plan.remainingCredits ?? 0) > 0,
      ),
    ).toBe(true);
  });

  it("membership and booking plan purchases create equivalent active entitlement sources", async () => {
    const membershipFixture = await createCatalogCheckoutFixture();
    const bookingFixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    verifyStripeWebhookEventMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          id: membershipFixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: membershipFixture.payment.id,
            orderId: membershipFixture.order.id,
            userId: membershipFixture.client.id,
            productId: membershipFixture.product.id,
            priceId: membershipFixture.price.id,
            selectedPriceId: membershipFixture.price.id,
            source: "subscription-catalog",
          },
        },
      },
    });

    const membershipResponse = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(membershipResponse.status).toBe(200);

    verifyStripeWebhookEventMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          id: bookingFixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: bookingFixture.payment.id,
            bookingId: bookingFixture.booking.id,
            selectedPriceId: bookingFixture.price.id,
            orderId: bookingFixture.order.id,
          },
        },
      },
    });

    const bookingResponse = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(bookingResponse.status).toBe(200);

    const membershipEntitlement = await prisma.clientEntitlement.findFirst({
      where: { clientId: membershipFixture.client.id, productId: membershipFixture.product.id },
      select: { entitlementType: true, entitlementScope: true, status: true, id: true },
    });
    const bookingEntitlement = await prisma.clientEntitlement.findFirst({
      where: { clientId: bookingFixture.client.id, productId: bookingFixture.product.id },
      select: { entitlementType: true, entitlementScope: true, status: true, id: true },
    });

    expect(membershipEntitlement?.status).toBe(ClientEntitlementStatus.ACTIVE);
    expect(bookingEntitlement?.status).toBe(ClientEntitlementStatus.ACTIVE);
    expect(membershipEntitlement?.entitlementType).toBe(bookingEntitlement?.entitlementType);
    expect(membershipEntitlement?.entitlementScope).toBe(bookingEntitlement?.entitlementScope);

    const membershipBalance = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: membershipFixture.client.id, entitlementId: membershipEntitlement?.id },
      _sum: { amount: true },
    });
    const bookingBalance = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: bookingFixture.client.id, entitlementId: bookingEntitlement?.id },
      _sum: { amount: true },
    });

    expect((membershipBalance._sum.amount ?? 0) > 0).toBe(true);
    expect((bookingBalance._sum.amount ?? 0) > 0).toBe(true);
  });

  it("reflects fulfilled class-pack purchase in dashboard active packs and credits", async () => {
    const fixture = await createCatalogCheckoutFixture();

    const beforeFulfillment = await getDashboardMembershipData(fixture.client.id);
    expect(beforeFulfillment.ownedOneTimeProducts).toHaveLength(0);
    expect(beforeFulfillment.activeCreditPacks).toHaveLength(0);
    expect(beforeFulfillment.usableCredits).toBe(0);

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
            productId: fixture.product.id,
            priceId: fixture.price.id,
            selectedPriceId: fixture.price.id,
            source: "subscription-catalog",
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const membership = await getDashboardMembershipData(fixture.client.id);

    expect(membership.usableCredits).toBe(10);
    expect(membership.activeCreditPacks).toHaveLength(1);
    expect(membership.activeCreditPacks[0]?.productName).toBe(fixture.product.name);
    expect(membership.ownedOneTimeProducts).toHaveLength(1);
  });

  it("reflects fulfilled recurring subscription purchase in dashboard subscription state", async () => {
    const fixture = await createRecurringCatalogCheckoutFixture();

    retrieveSubscriptionMock.mockResolvedValue({
      id: "sub_dashboard_test",
      status: "active",
      start_date: Math.floor(Date.now() / 1000) - 60,
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
      items: {
        data: [
          {
            current_period_start: Math.floor(Date.now() / 1000) - 60,
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            price: { id: fixture.price.stripePriceId },
          },
        ],
      },
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          mode: "subscription",
          subscription: "sub_dashboard_test",
          metadata: {
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
            productId: fixture.product.id,
            priceId: fixture.price.id,
            selectedPriceId: fixture.price.id,
            source: "subscription-catalog",
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const membership = await getDashboardMembershipData(fixture.client.id);

    expect(membership.activeSubscription?.productName).toBe(fixture.product.name);
    expect(
      membership.recurringSubscriptions.some((subscription) => subscription.productId === fixture.product.id),
    ).toBe(true);
    expect(membership.usableCredits).toBe(0);
    expect(membership.activeCreditPacks).toHaveLength(0);
  });
  it("handles concurrent duplicate checkout completion deliveries without duplicate grants", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    });

    await Promise.all(
      Array.from({ length: 8 }).map(() =>
        handleStripeWebhook(
          new Request("http://localhost/api/stripe/webhook", {
            method: "POST",
            headers: { "stripe-signature": "sig_test" },
            body: "{}",
          }),
        ),
      ),
    );

    const entitlements = await prisma.clientEntitlement.findMany({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        orderId: fixture.order.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
    });
    expect(entitlements).toHaveLength(1);

    const entries = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
    });
    expect(entries.filter((entry) => entry.entryType === CreditLedgerEntryType.GRANT)).toHaveLength(1);
    expect(entries.filter((entry) => entry.entryType === CreditLedgerEntryType.CONSUME)).toHaveLength(1);
  });

  it("rejects invalid stripe signature with no DB mutation", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    verifyStripeWebhookEventMock.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "bad_sig" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(400);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    expect(payment?.status).toBe(PaymentStatus.PENDING);
    expect(booking?.status).toBe(BookingStatus.PENDING);
    expect(order?.status).toBe(OrderStatus.PLACED);
  });

  it("does not duplicate fulfillment when recovery runs after a successful webhook", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    const checkoutSessionId = fixture.payment.providerReference;

    const checkoutSession = {
      id: checkoutSessionId,
      payment_status: "paid",
      mode: "payment",
      payment_intent: "pi_reconcile_success",
      customer: "cus_reconcile_success",
      metadata: {
        paymentId: fixture.payment.id,
        bookingId: fixture.booking.id,
        selectedPriceId: fixture.price.id,
        orderId: fixture.order.id,
      },
    };

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: checkoutSession },
    });

    const webhookResponse = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(webhookResponse.status).toBe(200);

    const finalizedPayment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    expect(finalizedPayment?.providerReference).toBe("pi_reconcile_success");
    expect(finalizedPayment?.stripeCheckoutSessionId).toBe(checkoutSessionId);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    retrieveCheckoutSessionMock.mockResolvedValue(checkoutSession);
    await reconcileCheckoutSessionAfterReturn({
      checkoutSessionId,
      bookingId: fixture.booking.id,
      userId: fixture.client.id,
    });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();

    const entitlements = await prisma.clientEntitlement.findMany({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        orderId: fixture.order.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
    });
    expect(entitlements).toHaveLength(1);

    const entries = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
    });
    expect(entries.filter((entry) => entry.entryType === CreditLedgerEntryType.GRANT)).toHaveLength(1);
    expect(entries.filter((entry) => entry.entryType === CreditLedgerEntryType.CONSUME)).toHaveLength(1);
  });

  it("keeps catalog finalization idempotent when checkout completion is replayed", async () => {
    const fixture = await createCatalogCheckoutFixture();

    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
            productId: fixture.product.id,
            priceId: fixture.price.id,
            selectedPriceId: fixture.price.id,
            source: "subscription-catalog",
          },
        },
      },
    };

    verifyStripeWebhookEventMock.mockReturnValueOnce(event);
    const responseOne = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(responseOne.status).toBe(200);

    verifyStripeWebhookEventMock.mockReturnValueOnce(event);
    const responseTwo = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(responseTwo.status).toBe(200);

    const entitlements = await prisma.clientEntitlement.findMany({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
    });

    expect(entitlements).toHaveLength(1);

    const credits = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
    });

    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.GRANT)).toHaveLength(1);
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.CONSUME)).toHaveLength(0);

    const balance = await prisma.creditLedgerEntry.aggregate({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
      _sum: { amount: true },
    });

    expect(balance._sum.amount).toBe(10);
  });

});
