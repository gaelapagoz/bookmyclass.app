import "./helpers/setup-env";

import {
  BookingPaymentSelection,
  BookingStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
  StudioSessionStatus,
  StripeWebhookReceiptStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";
import {
  processStripeWebhookEvent,
  reconcileCheckoutSessionAfterReturn,
} from "../../src/lib/public-booking/stripe-webhook-service";

const mockCheckoutSessionRetrieve = vi.fn();

vi.mock("@/lib/payments/stripe", () => ({
  getStripeClient: () => ({
    checkout: {
      sessions: {
        retrieve: (...args: unknown[]) => mockCheckoutSessionRetrieve(...args),
      },
    },
    subscriptions: {
      retrieve: () => {
        throw new Error("Stripe subscriptions.retrieve should not be called in this test");
      },
    },
  }),
}));

async function createDropInBookingFixture() {
  const ts = Date.now();

  const category = await createClassCategory(prisma, {
    name: "Yoga",
    slug: `yoga-wh-svc-${ts}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Vinyasa",
    slug: `vinyasa-wh-svc-${ts}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Teacher",
      email: `teacher.wh-svc.${ts}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Drop-In Template",
      slug: `template-wh-svc-${ts}`,
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 3);
  startsAt.setUTCHours(10, 0, 0, 0);

  const studioSession = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Drop-In Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const product = await prisma.product.create({
    data: {
      name: "Drop-In Class",
      slug: `drop-in-wh-svc-${ts}`,
      productType: ProductType.DROP_IN_CLASS,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `drop-in-price-wh-svc-${ts}`,
      name: "Drop-In Price",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 2500,
      isActive: true,
      isArchived: false,
    },
  });

  const client = await prisma.user.create({
    data: {
      name: "Client",
      email: `client.wh-svc.${ts}@example.test`,
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
    },
  });

  const booking = await prisma.booking.create({
    data: {
      studioSessionId: studioSession.id,
      clientId: client.id,
      orderId: order.id,
      status: BookingStatus.PENDING,
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
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
      providerReference: `cs_test_wh_svc_${ts}`,
      amountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  return { booking, payment, order, client, price };
}

async function createPlanPurchaseBookingFixture() {
  const ts = Date.now();

  const category = await createClassCategory(prisma, {
    name: "Yoga Plan",
    slug: `yoga-wh-plan-${ts}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Collective Flow",
    slug: `collective-wh-plan-${ts}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Teacher Plan",
      email: `teacher.wh-plan.${ts}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Plan Template",
      slug: `template-wh-plan-${ts}`,
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 3);
  startsAt.setUTCHours(9, 0, 0, 0);

  const studioSession = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Plan Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const product = await prisma.product.create({
    data: {
      name: "Collective 5 Pack",
      slug: `collective-pack-wh-plan-${ts}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `collective-pack-price-wh-plan-${ts}`,
      name: "Collective 5 Pack Price",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 9900,
      isActive: true,
      isArchived: false,
    },
  });
  await prisma.entitlementRule.create({
    data: {
      productId: product.id,
      entitlementType: "CREDIT_PACK",
      entitlementScope: "COLLECTIVE_CLASSES",
      quantity: 5,
      isActive: true,
    },
  });

  const client = await prisma.user.create({
    data: {
      name: "Client Plan",
      email: `client.wh-plan.${ts}@example.test`,
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
      studioSessionId: studioSession.id,
      clientId: client.id,
      orderId: order.id,
      status: BookingStatus.PENDING,
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
      selectedPriceId: price.id,
      draftAmountMinor: price.unitAmountMinor,
      draftCurrencyCode: "EUR",
      customerName: "Client Plan",
      customerEmail: client.email,
      customerPhone: "+32000000001",
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
      checkoutSource: "CART_CHECKOUT_V1",
      providerReference: `cs_test_wh_plan_${ts}`,
      stripeCheckoutSessionId: `cs_test_wh_plan_${ts}`,
      amountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  return { booking, payment, order, client, product };
}

function buildCheckoutCompletedEvent(
  eventId: string,
  sessionId: string,
  paymentIntentId: string,
  paymentId: string,
  bookingId: string,
) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        mode: "payment",
        metadata: {
          paymentId,
          bookingId,
        },
        amount_total: 2500,
        currency: "eur",
        payment_intent: paymentIntentId,
        customer: null,
        subscription: null,
      },
    },
  };
}

describe("processStripeWebhookEvent — checkout.session.completed", () => {
  beforeEach(async () => {
    await Promise.all([resetDb(), prisma.stripeWebhookEventReceipt.deleteMany()]);
    await prisma.emailTemplate.upsert({
      where: { templateKey: "booking.class-booked" },
      update: {
        name: "Booking Confirmation",
        category: "BOOKING",
        subjectTemplate: "You're booked for {{booking.classTitle}}",
        bodyTemplateJson: { blocks: [{ type: "paragraph", text: "Hello {{clientName}}," }] },
        contentSchemaVersion: 1,
        isActive: true,
      },
      create: {
        templateKey: "booking.class-booked",
        name: "Booking Confirmation",
        category: "BOOKING",
        subjectTemplate: "You're booked for {{booking.classTitle}}",
        bodyTemplateJson: { blocks: [{ type: "paragraph", text: "Hello {{clientName}}," }] },
        contentSchemaVersion: 1,
        isActive: true,
      },
    });
    mockCheckoutSessionRetrieve.mockReset();
    mockCheckoutSessionRetrieve.mockImplementation(() => {
      throw new Error("Stripe checkout.sessions.retrieve should not be called in this test");
    });
  });

  it("marks payment SUCCEEDED, order PAID, and booking CONFIRMED", async () => {
    const { booking, payment, order } = await createDropInBookingFixture();

    const event = buildCheckoutCompletedEvent(
      "evt_test_wh_svc_001",
      "cs_test_wh_svc_001",
      "pi_test_wh_svc_001",
      payment.id,
      booking.id,
    );

    await processStripeWebhookEvent(event as unknown as import("stripe").default.Event);

    const [updatedPayment, updatedOrder, updatedBooking] = await Promise.all([
      prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } }),
      prisma.order.findUnique({ where: { id: order.id }, select: { status: true } }),
      prisma.booking.findUnique({ where: { id: booking.id }, select: { status: true } }),
    ]);
    const confirmationOutboxCount = await prisma.emailAutomationEvent.count({
      where: {
        idempotencyKey: `booking-confirmation:${booking.id}:confirmed-v1`,
      },
    });

    expect(updatedPayment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(updatedOrder?.status).toBe(OrderStatus.PAID);
    expect(updatedBooking?.status).toBe(BookingStatus.CONFIRMED);
    expect(confirmationOutboxCount).toBe(1);
  });

  it("confirms only the intended new pending booking when cancelled history exists", async () => {
    const { booking, payment, order, client } = await createDropInBookingFixture();
    const cancelledHistorical = await prisma.booking.create({
      data: {
        studioSessionId: booking.studioSessionId,
        clientId: client.id,
        status: BookingStatus.CANCELLED,
        paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
        customerName: client.name,
        customerEmail: client.email,
        customerPhone: "+32000000000",
        cancelledAt: new Date(),
        cancellationReason: "Client cancelled before rebooking.",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
        consentAcceptedAt: new Date(),
      },
      select: { id: true },
    });

    const event = buildCheckoutCompletedEvent(
      "evt_test_wh_svc_rebook_001",
      "cs_test_wh_svc_rebook_001",
      "pi_test_wh_svc_rebook_001",
      payment.id,
      booking.id,
    );

    await processStripeWebhookEvent(event as unknown as import("stripe").default.Event);

    const [updatedPayment, updatedOrder, updatedBooking, historicalBooking] = await Promise.all([
      prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } }),
      prisma.order.findUnique({ where: { id: order.id }, select: { status: true } }),
      prisma.booking.findUnique({ where: { id: booking.id }, select: { status: true } }),
      prisma.booking.findUnique({ where: { id: cancelledHistorical.id }, select: { status: true } }),
    ]);

    expect(updatedPayment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(updatedOrder?.status).toBe(OrderStatus.PAID);
    expect(updatedBooking?.status).toBe(BookingStatus.CONFIRMED);
    expect(historicalBooking?.status).toBe(BookingStatus.CANCELLED);
  });

  it("skips checkout completion when payment metadata points at a different booking", async () => {
    const { booking, payment, order, client } = await createDropInBookingFixture();
    const cancelledHistorical = await prisma.booking.create({
      data: {
        studioSessionId: booking.studioSessionId,
        clientId: client.id,
        status: BookingStatus.CANCELLED,
        paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
        customerName: client.name,
        customerEmail: client.email,
        customerPhone: "+32000000000",
        cancelledAt: new Date(),
        cancellationReason: "Client cancelled before rebooking.",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
        consentAcceptedAt: new Date(),
      },
      select: { id: true },
    });

    const event = buildCheckoutCompletedEvent(
      "evt_test_wh_svc_rebook_mismatch_001",
      "cs_test_wh_svc_rebook_mismatch_001",
      "pi_test_wh_svc_rebook_mismatch_001",
      payment.id,
      cancelledHistorical.id,
    );

    await processStripeWebhookEvent(event as unknown as import("stripe").default.Event);

    const [updatedPayment, updatedOrder, updatedBooking, historicalBooking] = await Promise.all([
      prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } }),
      prisma.order.findUnique({ where: { id: order.id }, select: { status: true } }),
      prisma.booking.findUnique({ where: { id: booking.id }, select: { status: true } }),
      prisma.booking.findUnique({ where: { id: cancelledHistorical.id }, select: { status: true } }),
    ]);

    expect(updatedPayment?.status).toBe(PaymentStatus.PENDING);
    expect(updatedOrder?.status).toBe(OrderStatus.PLACED);
    expect(updatedBooking?.status).toBe(BookingStatus.PENDING);
    expect(historicalBooking?.status).toBe(BookingStatus.CANCELLED);
  });

  it("skips checkout completion when payment metadata points at a different order", async () => {
    const { booking, payment, order } = await createDropInBookingFixture();
    const otherClient = await prisma.user.create({
      data: {
        name: "Other Client",
        email: `other-order.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });
    const otherOrder = await prisma.order.create({
      data: {
        clientId: otherClient.id,
        subtotalAmountMinor: 2500,
        discountAmountMinor: 0,
        totalAmountMinor: 2500,
        currencyCode: "EUR",
        status: OrderStatus.PLACED,
      },
      select: { id: true },
    });
    const event = buildCheckoutCompletedEvent(
      "evt_test_wh_svc_order_mismatch_001",
      "cs_test_wh_svc_order_mismatch_001",
      "pi_test_wh_svc_order_mismatch_001",
      payment.id,
      booking.id,
    ) as ReturnType<typeof buildCheckoutCompletedEvent> & {
      data: { object: { metadata: { orderId?: string } } };
    };
    event.data.object.metadata.orderId = otherOrder.id;

    await processStripeWebhookEvent(event as unknown as import("stripe").default.Event);

    const [updatedPayment, updatedOrder, updatedBooking] = await Promise.all([
      prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } }),
      prisma.order.findUnique({ where: { id: order.id }, select: { status: true } }),
      prisma.booking.findUnique({ where: { id: booking.id }, select: { status: true } }),
    ]);

    expect(updatedPayment?.status).toBe(PaymentStatus.PENDING);
    expect(updatedOrder?.status).toBe(OrderStatus.PLACED);
    expect(updatedBooking?.status).toBe(BookingStatus.PENDING);
  });

  it("checks booking order when payment order is missing during metadata validation", async () => {
    const { booking, payment, order } = await createDropInBookingFixture();
    await prisma.payment.update({
      where: { id: payment.id },
      data: { orderId: null },
    });
    const otherClient = await prisma.user.create({
      data: {
        name: "Other Missing Payment Order Client",
        email: `other-missing-order.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });
    const otherOrder = await prisma.order.create({
      data: {
        clientId: otherClient.id,
        subtotalAmountMinor: 2500,
        discountAmountMinor: 0,
        totalAmountMinor: 2500,
        currencyCode: "EUR",
        status: OrderStatus.PLACED,
      },
      select: { id: true },
    });
    const event = buildCheckoutCompletedEvent(
      "evt_test_wh_svc_booking_order_mismatch_001",
      "cs_test_wh_svc_booking_order_mismatch_001",
      "pi_test_wh_svc_booking_order_mismatch_001",
      payment.id,
      booking.id,
    ) as ReturnType<typeof buildCheckoutCompletedEvent> & {
      data: { object: { metadata: { orderId?: string } } };
    };
    event.data.object.metadata.orderId = otherOrder.id;

    await processStripeWebhookEvent(event as unknown as import("stripe").default.Event);

    const [updatedPayment, updatedOrder, updatedBooking] = await Promise.all([
      prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true, orderId: true } }),
      prisma.order.findUnique({ where: { id: order.id }, select: { status: true } }),
      prisma.booking.findUnique({ where: { id: booking.id }, select: { status: true } }),
    ]);

    expect(updatedPayment?.status).toBe(PaymentStatus.PENDING);
    expect(updatedPayment?.orderId).toBeNull();
    expect(updatedOrder?.status).toBe(OrderStatus.PLACED);
    expect(updatedBooking?.status).toBe(BookingStatus.PENDING);
  });

  it("records the event receipt as PROCESSED after handling", async () => {
    const { booking, payment } = await createDropInBookingFixture();

    const event = buildCheckoutCompletedEvent(
      "evt_test_wh_svc_002",
      "cs_test_wh_svc_002",
      "pi_test_wh_svc_002",
      payment.id,
      booking.id,
    );

    await processStripeWebhookEvent(event as unknown as import("stripe").default.Event);

    const receipt = await prisma.stripeWebhookEventReceipt.findUnique({
      where: { eventId: event.id },
      select: { status: true },
    });

    expect(receipt?.status).toBe(StripeWebhookReceiptStatus.PROCESSED);
  });

  it("is idempotent: processing the same event twice does not cause errors or duplicate state changes", async () => {
    const { booking, payment, order } = await createDropInBookingFixture();

    const event = buildCheckoutCompletedEvent(
      "evt_test_wh_svc_003",
      "cs_test_wh_svc_003",
      "pi_test_wh_svc_003",
      payment.id,
      booking.id,
    );

    await processStripeWebhookEvent(event as unknown as import("stripe").default.Event);
    await processStripeWebhookEvent(event as unknown as import("stripe").default.Event);

    const updatedPayment = await prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id }, select: { status: true } });
    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    const receipt = await prisma.stripeWebhookEventReceipt.findUnique({
      where: { eventId: event.id },
      select: { status: true },
    });
    const confirmationOutboxCount = await prisma.emailAutomationEvent.count({
      where: {
        idempotencyKey: `booking-confirmation:${booking.id}:confirmed-v1`,
      },
    });

    expect(updatedPayment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(updatedOrder?.status).toBe(OrderStatus.PAID);
    expect(updatedBooking?.status).toBe(BookingStatus.CONFIRMED);
    expect(receipt?.status).toBe(StripeWebhookReceiptStatus.PROCESSED);
    expect(confirmationOutboxCount).toBe(1);
  });

  it("booking plan purchase grants credits and consumes exactly one credit", async () => {
    const { booking, payment, client, order, product } = await createPlanPurchaseBookingFixture();
    const event = buildCheckoutCompletedEvent(
      "evt_test_wh_plan_001",
      payment.stripeCheckoutSessionId as string,
      "pi_test_wh_plan_001",
      payment.id,
      booking.id,
    );
    event.data.object.metadata.selectedPriceId = booking.selectedPriceId as string;
    event.data.object.metadata.source = "CART_CHECKOUT_V1";

    await processStripeWebhookEvent(event as unknown as import("stripe").default.Event);

    const entitlement = await prisma.clientEntitlement.findFirst({
      where: { clientId: client.id, productId: product.id, orderId: order.id },
      select: { id: true },
    });
    expect(entitlement?.id).toBeTruthy();

    const balance = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: client.id, entitlementId: entitlement?.id },
      _sum: { amount: true },
    });
    expect(balance._sum.amount).toBe(4);

    const consumes = await prisma.creditLedgerEntry.count({
      where: {
        clientId: client.id,
        bookingId: booking.id,
        entryType: "CONSUME",
      },
    });
    expect(consumes).toBe(1);
  });

  it("booking plan purchase replay does not consume a second credit", async () => {
    const { booking, payment, client, order, product } = await createPlanPurchaseBookingFixture();
    const event = buildCheckoutCompletedEvent(
      "evt_test_wh_plan_002",
      payment.stripeCheckoutSessionId as string,
      "pi_test_wh_plan_002",
      payment.id,
      booking.id,
    );
    event.data.object.metadata.selectedPriceId = booking.selectedPriceId as string;
    event.data.object.metadata.source = "CART_CHECKOUT_V1";

    await processStripeWebhookEvent(event as unknown as import("stripe").default.Event);
    await processStripeWebhookEvent(event as unknown as import("stripe").default.Event);

    const entitlement = await prisma.clientEntitlement.findFirst({
      where: { clientId: client.id, productId: product.id, orderId: order.id },
      select: { id: true },
    });
    const balance = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: client.id, entitlementId: entitlement?.id },
      _sum: { amount: true },
    });
    expect(balance._sum.amount).toBe(4);
  });

  it("does not enqueue confirmation events for non-confirmed paths (PENDING, EXPIRED, CANCELLED, payment FAILED)", async () => {
    const pendingFixture = await createDropInBookingFixture();
    const expiredFixture = await createDropInBookingFixture();
    const cancelledFixture = await createDropInBookingFixture();
    const failedPaymentFixture = await createDropInBookingFixture();

    await prisma.booking.update({
      where: { id: expiredFixture.booking.id },
      data: { status: BookingStatus.EXPIRED },
    });
    await prisma.booking.update({
      where: { id: cancelledFixture.booking.id },
      data: { status: BookingStatus.CANCELLED },
    });
    await prisma.payment.update({
      where: { id: failedPaymentFixture.payment.id },
      data: { status: PaymentStatus.FAILED },
    });

    const events = [
      buildCheckoutCompletedEvent(
        "evt_test_wh_negative_pending",
        "cs_test_wh_negative_pending",
        "pi_test_wh_negative_pending",
        pendingFixture.payment.id,
        pendingFixture.booking.id,
      ),
      buildCheckoutCompletedEvent(
        "evt_test_wh_negative_expired",
        "cs_test_wh_negative_expired",
        "pi_test_wh_negative_expired",
        expiredFixture.payment.id,
        expiredFixture.booking.id,
      ),
      buildCheckoutCompletedEvent(
        "evt_test_wh_negative_cancelled",
        "cs_test_wh_negative_cancelled",
        "pi_test_wh_negative_cancelled",
        cancelledFixture.payment.id,
        cancelledFixture.booking.id,
      ),
      buildCheckoutCompletedEvent(
        "evt_test_wh_negative_failed_payment",
        "cs_test_wh_negative_failed_payment",
        "pi_test_wh_negative_failed_payment",
        failedPaymentFixture.payment.id,
        failedPaymentFixture.booking.id,
      ),
    ];

    for (const event of events) {
      event.data.object.payment_status = "unpaid";
      await processStripeWebhookEvent(event as unknown as import("stripe").default.Event);
    }

    const outboxCount = await prisma.emailAutomationEvent.count({
      where: {
        idempotencyKey: {
          in: [
            `booking-confirmation:${pendingFixture.booking.id}:confirmed-v1`,
            `booking-confirmation:${expiredFixture.booking.id}:confirmed-v1`,
            `booking-confirmation:${cancelledFixture.booking.id}:confirmed-v1`,
            `booking-confirmation:${failedPaymentFixture.booking.id}:confirmed-v1`,
          ],
        },
      },
    });
    expect(outboxCount).toBe(0);
  });

  it("webhook and manual reconciliation race for same booking still enqueue one confirmation event", async () => {
    const { booking, payment, client } = await createDropInBookingFixture();
    const event = buildCheckoutCompletedEvent(
      "evt_test_wh_reconcile_race_001",
      "cs_test_wh_reconcile_race_001",
      "pi_test_wh_reconcile_race_001",
      payment.id,
      booking.id,
    );
    mockCheckoutSessionRetrieve.mockResolvedValue({
      ...event.data.object,
      metadata: {
        ...event.data.object.metadata,
        bookingId: booking.id,
      },
    });

    await Promise.all([
      processStripeWebhookEvent(event as unknown as import("stripe").default.Event),
      reconcileCheckoutSessionAfterReturn({
        checkoutSessionId: event.data.object.id,
        bookingId: booking.id,
        userId: client.id,
      }),
    ]);

    const outboxCount = await prisma.emailAutomationEvent.count({
      where: {
        idempotencyKey: `booking-confirmation:${booking.id}:confirmed-v1`,
      },
    });
    expect(outboxCount).toBe(1);
  });
});
