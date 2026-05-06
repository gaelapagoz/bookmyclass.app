import "./helpers/setup-env";

import {
  BookingPaymentSelection,
  BookingStatus,
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
import { expireStaleBookingDrafts } from "../../src/lib/public-booking/booking-draft-service";
import { POST as handleStripeWebhook } from "../../src/app/api/stripe/webhook/route";

const verifyStripeWebhookEventMock = vi.fn();
const retrieveCheckoutSessionMock = vi.fn();

vi.mock("@/lib/payments/stripe", () => ({
  verifyStripeWebhookEvent: (...args: unknown[]) => {
    const event = verifyStripeWebhookEventMock(...args) as { id?: unknown; type?: unknown } | null | undefined;
    const id = typeof event?.id === "string" && event.id.length > 0 ? event.id : `evt_test_${Date.now()}`;
    return { ...event, id };
  },
  getStripeClient: () => ({
    checkout: {
      sessions: {
        retrieve: (...args: unknown[]) => retrieveCheckoutSessionMock(...args),
      },
    },
  }),
}));

async function createExpiredDraftWithPayment() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const category = await createClassCategory(prisma, {
    name: "Yoga",
    slug: `yoga-late-${unique}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Flow",
    slug: `flow-late-${unique}`,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: `Teacher Late ${unique}`,
      email: `teacher.late.${unique}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Late Template",
      slug: `late-template-${unique}`,
      defaultCapacity: 5,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });
  const startsAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Late Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 5,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const product = await prisma.product.create({
    data: {
      name: `Drop-In Late ${unique}`,
      slug: `drop-in-late-${unique}`,
      productType: ProductType.DROP_IN_CLASS,
      isActive: true,
      isArchived: false,
      sortOrder: 0,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `price-late-${unique}`,
      name: "Standard",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 2200,
      isActive: true,
      isArchived: false,
    },
  });
  const client = await prisma.user.create({
    data: {
      name: `Client Late ${unique}`,
      email: `client.late.${unique}@example.test`,
      role: Role.CLIENT,
    },
  });

  // Create booking with an expired createdAt (30 min ago = past the hold window)
  const expiredCreatedAt = new Date(Date.now() - 30 * 60 * 1000);
  const booking = await prisma.booking.create({
    data: {
      studioSessionId: session.id,
      clientId: client.id,
      status: BookingStatus.PENDING,
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
      selectedPriceId: price.id,
      draftAmountMinor: price.unitAmountMinor,
      draftCurrencyCode: "EUR",
      customerName: client.name,
      customerEmail: client.email,
      customerPhone: "+10000000000",
      bookingIntent: "SINGLE_BOOKING",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
      createdAt: expiredCreatedAt,
    },
  });

  const checkoutSessionId = `cs_late_${unique}`;
  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: checkoutSessionId,
      stripeCheckoutSessionId: checkoutSessionId,
      amountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  return { booking, payment, price, client };
}

describe("Late Stripe checkout.session.completed for an expired draft", () => {
  beforeEach(async () => {
    verifyStripeWebhookEventMock.mockReset();
    retrieveCheckoutSessionMock.mockReset();
    await resetDb();
  });

  it("does not confirm a booking that was expired by the expiry job before the webhook arrived", async () => {
    const { booking, payment, price } = await createExpiredDraftWithPayment();

    // Run the expiry job - booking moves to EXPIRED
    await expireStaleBookingDrafts();

    const afterExpiry = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(afterExpiry?.status).toBe(BookingStatus.EXPIRED);

    // Simulate Stripe sending checkout.session.completed for the now-expired booking
    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: payment.id,
            bookingId: booking.id,
            selectedPriceId: price.id,
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test_late" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    // Booking must remain EXPIRED - a late payment cannot resurrect an expired draft
    const afterWebhook = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(afterWebhook?.status).toBe(BookingStatus.EXPIRED);
  });
});
