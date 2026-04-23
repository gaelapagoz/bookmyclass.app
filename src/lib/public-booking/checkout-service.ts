import {
  BookingPaymentSelection,
  BookingStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  Role,
  UserActivationStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { createStripeCheckoutSession, getStripeServerEnv } from "../payments/stripe";
import { getSubscriptionCheckoutItemByProductId } from "../subscription/subscription-products";
import { hasActiveRecurringSubscriptionForProduct } from "../subscription/ownership";

type CheckoutErrorCode =
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_PENDING"
  | "INVALID_SELECTION"
  | "MISSING_DRAFT_TOTAL"
  | "AUTH_REQUIRED"
  | "ALREADY_SUBSCRIBED";

export class CheckoutError extends Error {
  constructor(
    public readonly code: CheckoutErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type CatalogCheckoutErrorCode =
  | "AUTH_REQUIRED"
  | "PRODUCT_NOT_FOUND"
  | "CHECKOUT_NOT_CONFIGURED"
  | "ALREADY_SUBSCRIBED";

export class CatalogCheckoutError extends Error {
  constructor(
    public readonly code: CatalogCheckoutErrorCode,
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

type CheckoutDraftBooking = {
  clientId: string | null;
  draftAmountMinor: number | null;
  draftCurrencyCode: string | null;
  id: string;
  paymentSelection: BookingPaymentSelection | null;
  selectedPriceId: string | null;
  serviceSlug: string;
  status: BookingStatus;
};

async function assertClientCheckoutEligibility(input: {
  userId: string | null;
  buildAuthError: (message: string) => CheckoutError | CatalogCheckoutError;
}): Promise<string> {
  if (!input.userId) {
    throw input.buildAuthError("Authentication required.");
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      role: true,
      activationStatus: true,
    },
  });

  if (
    !user ||
    user.role !== Role.CLIENT ||
    user.activationStatus !== UserActivationStatus.ACTIVE
  ) {
    throw input.buildAuthError("Sign in with an active client account to continue.");
  }

  return input.userId;
}

type ReadyCheckoutDraftBooking = {
  clientId: string;
  draftAmountMinor: number;
  draftCurrencyCode: string;
  id: string;
  paymentSelection: Exclude<BookingPaymentSelection, "EXISTING_PLAN">;
  selectedPriceId: string;
  serviceSlug: string;
  status: "PENDING";
};

function requireBookingCheckoutReady(input: {
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
}): { booking: ReadyCheckoutDraftBooking; userId: string } {
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

  return {
    booking: {
      ...booking,
      clientId: booking.clientId,
      draftAmountMinor: booking.draftAmountMinor,
      draftCurrencyCode: booking.draftCurrencyCode,
      paymentSelection: booking.paymentSelection,
      selectedPriceId: booking.selectedPriceId,
      status: BookingStatus.PENDING,
    },
    userId,
  };
}

export async function createCheckoutSessionForBooking(input: {
  bookingId: string;
  userId: string | null;
}): Promise<CheckoutResult> {
  const { bookingId, userId } = input;
  const checkoutUserId = await assertClientCheckoutEligibility({
    userId,
    buildAuthError: (message) => new CheckoutError("AUTH_REQUIRED", message),
  });
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
          priceType: true,
          stripePriceId: true,
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

  const readyCheckout = requireBookingCheckoutReady({ booking: normalizedBooking, userId: checkoutUserId });
  if (!booking?.selectedPrice || !booking.clientId) {
    throw new CheckoutError("INVALID_SELECTION", "Selected price is missing.");
  }
  const selectedPrice = booking.selectedPrice;
  const isRecurringPlanPurchase =
    readyCheckout.booking.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE &&
    selectedPrice.priceType === PriceType.RECURRING;
  if (isRecurringPlanPurchase && !selectedPrice.stripePriceId) {
    throw new CheckoutError(
      "INVALID_SELECTION",
      "Selected recurring plan is not checkout-ready.",
    );
  }
  if (isRecurringPlanPurchase) {
    const alreadySubscribed = await hasActiveRecurringSubscriptionForProduct({
      userId: readyCheckout.userId,
      productId: selectedPrice.product.id,
    });
    if (alreadySubscribed) {
      throw new CheckoutError(
        "ALREADY_SUBSCRIBED",
        "You already have an active recurring subscription for this plan.",
      );
    }
  }

  const env = getStripeServerEnv();
  const serviceLabel = booking.studioSession.classType.name;
  const orderAndPayment = await prisma.$transaction(async (tx) => {
    const readyBooking = readyCheckout.booking;
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
          clientId: readyBooking.clientId,
          subtotalAmountMinor: readyBooking.draftAmountMinor,
          discountAmountMinor: 0,
          totalAmountMinor: readyBooking.draftAmountMinor,
          currencyCode: readyBooking.draftCurrencyCode,
          status: OrderStatus.PLACED,
          notes:
            readyBooking.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
              ? "Plan purchase order created from booking checkout."
              : "Single-session order created from booking checkout.",
        },
        select: { id: true },
      });
      orderId = order.id;

      await tx.orderItem.create({
        data: {
          orderId,
          productId: selectedPrice.product.id,
          priceId: selectedPrice.id,
          quantity: 1,
          productNameSnapshot: selectedPrice.product.name,
          priceNameSnapshot: selectedPrice.name,
          unitAmountMinor: selectedPrice.unitAmountMinor,
          lineSubtotalAmountMinor: readyBooking.draftAmountMinor,
          lineDiscountAmountMinor: 0,
          lineTotalAmountMinor: readyBooking.draftAmountMinor,
          currencyCode: readyBooking.draftCurrencyCode,
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
          amountMinor: readyCheckout.booking.draftAmountMinor,
          currencyCode: readyCheckout.booking.draftCurrencyCode,
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
        amountMinor: readyCheckout.booking.draftAmountMinor,
        currencyCode: readyCheckout.booking.draftCurrencyCode,
      },
      select: { id: true, orderId: true },
    });

    return {
      paymentId: createdPayment.id,
      orderId: createdPayment.orderId ?? orderId,
    };
  });

  const metadata = {
    bookingId: readyCheckout.booking.id,
    paymentId: orderAndPayment.paymentId,
    orderId: orderAndPayment.orderId ?? "",
    paymentSelection: readyCheckout.booking.paymentSelection,
    selectedPriceId: readyCheckout.booking.selectedPriceId,
    serviceSlug: readyCheckout.booking.serviceSlug,
    userId: readyCheckout.userId,
    productId: selectedPrice.product.id,
    priceId: selectedPrice.id,
    source: "booking-flow",
  };

  if (process.env.E2E_TEST_MODE === "1") {
    const syntheticCheckoutSessionId = `cs_e2e_${Date.now()}_${orderAndPayment.paymentId.slice(-8)}`;
    const checkoutUrl =
      `${env.appUrl}/book-a-class/${readyCheckout.booking.serviceSlug}/payment/success` +
      `?bookingId=${encodeURIComponent(readyCheckout.booking.id)}&session_id=${encodeURIComponent(syntheticCheckoutSessionId)}`;

    await prisma.payment.update({
      where: { id: orderAndPayment.paymentId },
      data: {
        providerReference: syntheticCheckoutSessionId,
        stripeCheckoutSessionId: syntheticCheckoutSessionId,
        stripeCheckoutMode: isRecurringPlanPurchase ? "SUBSCRIPTION" : "PAYMENT",
      },
    });

    return {
      checkoutSessionId: syntheticCheckoutSessionId,
      checkoutUrl,
      paymentId: orderAndPayment.paymentId,
    };
  }

  const checkoutSession = await createStripeCheckoutSession(
    isRecurringPlanPurchase
      ? {
          mode: "subscription",
          line_items: [
            {
              price: selectedPrice.stripePriceId!,
              quantity: 1,
            },
          ],
          metadata,
          client_reference_id: readyCheckout.userId,
          subscription_data: {
            metadata,
          },
          success_url: `${env.appUrl}/book-a-class/${readyCheckout.booking.serviceSlug}/payment/success?bookingId=${readyCheckout.booking.id}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${env.appUrl}/book-a-class/${readyCheckout.booking.serviceSlug}/payment/cancel?bookingId=${readyCheckout.booking.id}`,
        }
      : {
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: readyCheckout.booking.draftCurrencyCode.toLowerCase(),
                unit_amount: readyCheckout.booking.draftAmountMinor,
                product_data: {
                  name: serviceLabel,
                  description:
                    readyCheckout.booking.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
                      ? "Plan purchase for booking flow"
                      : "Single-session booking payment",
                },
              },
            },
          ],
          metadata,
          success_url: `${env.appUrl}/book-a-class/${readyCheckout.booking.serviceSlug}/payment/success?bookingId=${readyCheckout.booking.id}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${env.appUrl}/book-a-class/${readyCheckout.booking.serviceSlug}/payment/cancel?bookingId=${readyCheckout.booking.id}`,
        },
  );

  if (!checkoutSession.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }

  await prisma.payment.update({
    where: { id: orderAndPayment.paymentId },
    data: {
      providerReference: checkoutSession.id,
      stripeCheckoutSessionId: checkoutSession.id,
      stripeCheckoutMode: isRecurringPlanPurchase ? "SUBSCRIPTION" : "PAYMENT",
    },
  });

  return {
    checkoutSessionId: checkoutSession.id,
    checkoutUrl: checkoutSession.url,
    paymentId: orderAndPayment.paymentId,
  };
}

export async function createCheckoutSessionForCatalogProduct(input: {
  userId: string | null;
  productId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const { productId, successUrl, cancelUrl } = input;
  const userId = await assertClientCheckoutEligibility({
    userId: input.userId,
    buildAuthError: (message) => new CatalogCheckoutError("AUTH_REQUIRED", message),
  });

  const product = await getSubscriptionCheckoutItemByProductId(productId);
  if (!product) {
    throw new CatalogCheckoutError("PRODUCT_NOT_FOUND", "Product not found.");
  }

  if (!product.checkoutEnabled) {
    throw new CatalogCheckoutError(
      "CHECKOUT_NOT_CONFIGURED",
      "Checkout is unavailable until Stripe pricing is configured.",
    );
  }

  const stripePriceId = product.stripePriceId;
  if (!stripePriceId) {
    throw new CatalogCheckoutError(
      "CHECKOUT_NOT_CONFIGURED",
      "Checkout is unavailable until Stripe pricing is configured.",
    );
  }

  if (product.priceType === PriceType.RECURRING) {
    const alreadySubscribed = await hasActiveRecurringSubscriptionForProduct({
      userId,
      productId: product.productId,
    });
    if (alreadySubscribed) {
      throw new CatalogCheckoutError(
        "ALREADY_SUBSCRIBED",
        "You already have an active recurring subscription for this product. Use Manage billing in your dashboard to make changes.",
      );
    }
  }

  const env = getStripeServerEnv();
  if (!successUrl.startsWith(env.appUrl) || !cancelUrl.startsWith(env.appUrl)) {
    throw new CatalogCheckoutError("CHECKOUT_NOT_CONFIGURED", "Invalid checkout redirect configuration.");
  }

  const createdOrder = await prisma.order.create({
    data: {
      clientId: userId,
      subtotalAmountMinor: product.amountMinor,
      discountAmountMinor: 0,
      totalAmountMinor: product.amountMinor,
      currencyCode: product.currencyCode,
      status: OrderStatus.PLACED,
      notes: "Product catalog order created from /subscription checkout.",
      items: {
        create: {
          productId: product.productId,
          priceId: product.priceId,
          quantity: 1,
          productNameSnapshot: product.name,
          priceNameSnapshot: product.priceName,
          unitAmountMinor: product.amountMinor,
          lineSubtotalAmountMinor: product.amountMinor,
          lineDiscountAmountMinor: 0,
          lineTotalAmountMinor: product.amountMinor,
          currencyCode: product.currencyCode,
        },
      },
      payments: {
        create: {
          status: PaymentStatus.PENDING,
          method: PaymentMethod.CARD,
          provider: PaymentProvider.STRIPE,
          amountMinor: product.amountMinor,
          currencyCode: product.currencyCode,
        },
      },
    },
    select: {
      id: true,
      payments: {
        select: { id: true },
        take: 1,
      },
    },
  });
  const paymentId = createdOrder.payments[0]?.id;
  if (!paymentId) {
    throw new Error("Could not create pending payment for catalog checkout.");
  }
  const orderAndPayment = {
    orderId: createdOrder.id,
    paymentId,
  };

  const metadata = {
    userId,
    productId: product.productId,
    priceId: product.priceId,
    selectedPriceId: product.priceId,
    orderId: orderAndPayment.orderId,
    paymentId: orderAndPayment.paymentId,
    source: "subscription-catalog",
  };

  if (process.env.E2E_TEST_MODE === "1") {
    const syntheticCheckoutSessionId = `cs_e2e_${Date.now()}_${orderAndPayment.paymentId.slice(-8)}`;
    await prisma.payment.update({
      where: { id: orderAndPayment.paymentId },
      data: {
        providerReference: syntheticCheckoutSessionId,
        stripeCheckoutSessionId: syntheticCheckoutSessionId,
        stripeCheckoutMode: product.priceType === PriceType.RECURRING ? "SUBSCRIPTION" : "PAYMENT",
      },
    });

    return {
      checkoutSessionId: syntheticCheckoutSessionId,
      checkoutUrl: `${env.appUrl}/subscription/success?session_id=${encodeURIComponent(syntheticCheckoutSessionId)}`,
      paymentId: orderAndPayment.paymentId,
      orderId: orderAndPayment.orderId,
    };
  }

  const checkoutSession = await createStripeCheckoutSession({
    mode: product.priceType === PriceType.RECURRING ? "subscription" : "payment",
    line_items: [
      {
        price: stripePriceId,
        quantity: 1,
      },
    ],
    metadata,
    client_reference_id: userId,
    subscription_data:
      product.priceType === PriceType.RECURRING
        ? {
            metadata,
          }
        : undefined,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  if (!checkoutSession.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }

  await prisma.payment.update({
    where: { id: orderAndPayment.paymentId },
    data: {
      providerReference: checkoutSession.id,
      stripeCheckoutSessionId: checkoutSession.id,
      stripeCheckoutMode: product.priceType === PriceType.RECURRING ? "SUBSCRIPTION" : "PAYMENT",
    },
  });

  return {
    checkoutSessionId: checkoutSession.id,
    checkoutUrl: checkoutSession.url,
    paymentId: orderAndPayment.paymentId,
    orderId: orderAndPayment.orderId,
  };
}

export async function createCheckoutSessionForCart(input: {
  userId: string;
  idempotencyKey: string;
  lines: Array<{ productId: string; priceId: string; quantity: number }>;
  clientCartVersion: string;
}) {
  const { startCartCheckout } = await import("@/lib/cart/cart-checkout-service");
  return startCartCheckout(input);
}
