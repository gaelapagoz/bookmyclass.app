import {
  BookingPaymentSelection,
  BookingStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { createStripeCheckoutSession, getStripeEnv } from "../payments/stripe";

type CheckoutErrorCode =
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_PENDING"
  | "INVALID_SELECTION"
  | "MISSING_DRAFT_TOTAL"
  | "AUTH_REQUIRED";

export class CheckoutError extends Error {
  constructor(
    public readonly code: CheckoutErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type CheckoutResult = {
  checkoutSessionId: string;
  checkoutUrl: string;
  paymentId: string;
};

function assertBookingCheckoutReady(input: {
  booking: {
    clientId: string | null;
    draftAmountMinor: number | null;
    draftCurrencyCode: string | null;
    id: string;
    paymentSelection: BookingPaymentSelection | null;
    selectedPriceId: string | null;
    serviceSlug: string;
    status: BookingStatus;
  } | null;
  userId: string | null;
}) {
  const { booking, userId } = input;
  if (!booking) {
    throw new CheckoutError("BOOKING_NOT_FOUND", "Booking draft not found.");
  }

  if (booking.status !== BookingStatus.PENDING) {
    throw new CheckoutError("BOOKING_NOT_PENDING", "Booking draft is not pending.");
  }

  if (!booking.paymentSelection) {
    throw new CheckoutError("INVALID_SELECTION", "Select a payment method before checkout.");
  }

  if (booking.paymentSelection === BookingPaymentSelection.EXISTING_PLAN) {
    throw new CheckoutError(
      "INVALID_SELECTION",
      "Stripe checkout is not used for existing plan/credit bookings.",
    );
  }

  if (
    !userId ||
    !booking.clientId ||
    booking.clientId !== userId
  ) {
    throw new CheckoutError(
      "AUTH_REQUIRED",
      "Sign in with the booking account to continue checkout.",
    );
  }

  if (
    booking.draftAmountMinor === null ||
    booking.draftAmountMinor < 0 ||
    !booking.draftCurrencyCode
  ) {
    throw new CheckoutError("MISSING_DRAFT_TOTAL", "Booking draft total is missing.");
  }

  if (!booking.selectedPriceId) {
    throw new CheckoutError("INVALID_SELECTION", "Selected price is missing.");
  }
}

export async function createCheckoutSessionForBooking(input: {
  bookingId: string;
  userId: string | null;
}): Promise<CheckoutResult> {
  const { bookingId, userId } = input;
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      clientId: true,
      paymentSelection: true,
      selectedPriceId: true,
      draftAmountMinor: true,
      draftCurrencyCode: true,
      orderId: true,
      selectedPrice: {
        select: {
          id: true,
          name: true,
          unitAmountMinor: true,
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      studioSession: {
        select: {
          classType: {
            select: {
              slug: true,
              name: true,
            },
          },
        },
      },
      payments: {
        where: {
          provider: PaymentProvider.STRIPE,
          status: PaymentStatus.PENDING,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, orderId: true },
        take: 1,
      },
    },
  });

  const normalizedBooking = booking
    ? {
        id: booking.id,
        status: booking.status,
        clientId: booking.clientId,
        paymentSelection: booking.paymentSelection,
        selectedPriceId: booking.selectedPriceId,
        draftAmountMinor: booking.draftAmountMinor,
        draftCurrencyCode: booking.draftCurrencyCode,
        serviceSlug: booking.studioSession.classType.slug,
      }
    : null;

  assertBookingCheckoutReady({ booking: normalizedBooking, userId });
  if (!booking?.selectedPrice || !booking.clientId) {
    throw new CheckoutError("INVALID_SELECTION", "Selected price is missing.");
  }

  const env = getStripeEnv();
  const serviceLabel = booking?.studioSession.classType.name ?? "Studio Class";
  const orderAndPayment = await prisma.$transaction(async (tx) => {
    let orderId = booking.orderId;
    if (orderId) {
      const existingOrder = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (!existingOrder || existingOrder.status !== OrderStatus.PLACED) {
        orderId = null;
      }
    }

    if (!orderId) {
      const order = await tx.order.create({
        data: {
          clientId: booking.clientId,
          subtotalAmountMinor: normalizedBooking.draftAmountMinor,
          discountAmountMinor: 0,
          totalAmountMinor: normalizedBooking.draftAmountMinor,
          currencyCode: normalizedBooking.draftCurrencyCode,
          status: OrderStatus.PLACED,
          notes:
            normalizedBooking.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
              ? "Plan purchase order created from booking checkout."
              : "Single-session order created from booking checkout.",
        },
        select: { id: true },
      });
      orderId = order.id;

      await tx.orderItem.create({
        data: {
          orderId,
          productId: booking.selectedPrice.product.id,
          priceId: booking.selectedPrice.id,
          quantity: 1,
          productNameSnapshot: booking.selectedPrice.product.name,
          priceNameSnapshot: booking.selectedPrice.name,
          unitAmountMinor: booking.selectedPrice.unitAmountMinor,
          lineSubtotalAmountMinor: normalizedBooking.draftAmountMinor,
          lineDiscountAmountMinor: 0,
          lineTotalAmountMinor: normalizedBooking.draftAmountMinor,
          currencyCode: normalizedBooking.draftCurrencyCode,
        },
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: { orderId },
      });
    }

    const existingPendingPayment = booking.payments[0] ?? null;
    if (existingPendingPayment) {
      const updated = await tx.payment.update({
        where: { id: existingPendingPayment.id },
        data: {
          orderId: existingPendingPayment.orderId ?? orderId,
          amountMinor: normalizedBooking.draftAmountMinor,
          currencyCode: normalizedBooking.draftCurrencyCode,
        },
        select: { id: true, orderId: true },
      });

      return {
        paymentId: updated.id,
        orderId: updated.orderId ?? orderId,
      };
    }

    const createdPayment = await tx.payment.create({
      data: {
        bookingId,
        orderId,
        status: PaymentStatus.PENDING,
        method: PaymentMethod.CARD,
        provider: PaymentProvider.STRIPE,
        amountMinor: normalizedBooking.draftAmountMinor,
        currencyCode: normalizedBooking.draftCurrencyCode,
      },
      select: { id: true, orderId: true },
    });

    return {
      paymentId: createdPayment.id,
      orderId: createdPayment.orderId ?? orderId,
    };
  });

  const checkoutSession = await createStripeCheckoutSession({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: normalizedBooking.draftCurrencyCode.toLowerCase(),
          unit_amount: normalizedBooking.draftAmountMinor,
          product_data: {
            name: serviceLabel,
            description:
              normalizedBooking.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
                ? "Plan purchase for booking flow"
                : "Single-session booking payment",
          },
        },
      },
    ],
    metadata: {
      bookingId: normalizedBooking.id,
      paymentId: orderAndPayment.paymentId,
      orderId: orderAndPayment.orderId ?? "",
      paymentSelection: normalizedBooking.paymentSelection,
      selectedPriceId: normalizedBooking.selectedPriceId,
      serviceSlug: normalizedBooking.serviceSlug,
    },
    success_url: `${env.appUrl}/book-a-class/${normalizedBooking.serviceSlug}/payment/success?bookingId=${normalizedBooking.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.appUrl}/book-a-class/${normalizedBooking.serviceSlug}/payment/cancel?bookingId=${normalizedBooking.id}`,
  });

  if (!checkoutSession.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }

  await prisma.payment.update({
    where: { id: orderAndPayment.paymentId },
    data: {
      providerReference: checkoutSession.id,
    },
  });

  return {
    checkoutSessionId: checkoutSession.id,
    checkoutUrl: checkoutSession.url,
    paymentId: orderAndPayment.paymentId,
  };
}
