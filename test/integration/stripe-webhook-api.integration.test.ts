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

const verifyStripeWebhookEventMock = vi.fn();

vi.mock("../../src/lib/payments/stripe", () => ({
  verifyStripeWebhookEvent: (...args: unknown[]) => verifyStripeWebhookEventMock(...args),
}));

import { POST as handleStripeWebhook } from "../../src/app/api/stripe/webhook/route";

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

describe("POST /api/stripe/webhook", () => {
  beforeEach(async () => {
    verifyStripeWebhookEventMock.mockReset();
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
});


