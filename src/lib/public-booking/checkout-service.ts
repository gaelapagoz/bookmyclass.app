import {
  BookingPaymentSelection,
  BookingStatus,
  CheckoutSource,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  Role,
  StudioSessionStatus,
  UserActivationStatus,
} from "@prisma/client";
import { prisma } from "../db";
import {
  createStripeCheckoutSessionWithIdempotency,
  getStripeClient,
  getStripeServerEnv,
} from "../payments/stripe";
import { getSubscriptionCheckoutItemByProductId } from "../subscription/subscription-products";
import { hasActiveRecurringSubscriptionForProduct } from "../subscription/ownership";
import { isCatalogPriceCheckoutReady } from "../catalog/checkout-readiness";

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

function buildStripeIdempotencyKey(parts: string[]): string {
  return parts.join(":").slice(0, 255);
}

function isE2ETestModeEnabled(): boolean {
  return process.env.E2E_TEST_MODE === "1";
}

function buildBookingSyntheticCheckoutUrl(input: {
  appUrl: string;
  bookingId: string;
  serviceSlug: string;
  checkoutSessionId: string;
}): string {
  return (
    `${input.appUrl}/book-a-class/${input.serviceSlug}/payment/success` +
    `?bookingId=${encodeURIComponent(input.bookingId)}&session_id=${encodeURIComponent(input.checkoutSessionId)}`
  );
}

function buildSubscriptionSyntheticCheckoutUrl(input: {
  appUrl: string;
  checkoutSessionId: string;
}): string {
  return `${input.appUrl}/subscription/success?session_id=${encodeURIComponent(input.checkoutSessionId)}`;
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
  const env = getStripeServerEnv();
  const sessionContext = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;

    const booking = await tx.booking.findUnique({
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
            currencyCode: true,
            stripePriceId: true,
            stripeSyncStatus: true,
            unitAmountMinor: true,
            billingInterval: true,
            billingIntervalCount: true,
            isActive: true,
            isArchived: true,
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
            status: true,
            isPublished: true,
            startsAt: true,
            classType: {
              select: {
                slug: true,
              },
            },
          },
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
    if (
      booking.studioSession.status !== StudioSessionStatus.SCHEDULED ||
      !booking.studioSession.isPublished ||
      booking.studioSession.startsAt <= new Date()
    ) {
      throw new CheckoutError("INVALID_SELECTION", "Selected session is no longer bookable.");
    }

    const selectedPrice = booking.selectedPrice;
    if (
      !selectedPrice.isActive ||
      selectedPrice.isArchived ||
      !isCatalogPriceCheckoutReady(selectedPrice)
    ) {
      throw new CheckoutError("INVALID_SELECTION", "Selected price is no longer checkout-ready.");
    }

    const isRecurringPlanPurchase =
      readyCheckout.booking.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE &&
      selectedPrice.priceType === PriceType.RECURRING;

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

    const chargeAmountMinor = selectedPrice.unitAmountMinor;
    const chargeCurrencyCode = selectedPrice.currencyCode;

    if (!orderId) {
      const order = await tx.order.create({
        data: {
          clientId: readyCheckout.booking.clientId,
          subtotalAmountMinor: chargeAmountMinor,
          discountAmountMinor: 0,
          totalAmountMinor: chargeAmountMinor,
          currencyCode: chargeCurrencyCode,
          status: OrderStatus.PLACED,
          notes:
            readyCheckout.booking.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
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
          unitAmountMinor: chargeAmountMinor,
          lineSubtotalAmountMinor: chargeAmountMinor,
          lineDiscountAmountMinor: 0,
          lineTotalAmountMinor: chargeAmountMinor,
          currencyCode: chargeCurrencyCode,
        },
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          orderId,
          draftAmountMinor: chargeAmountMinor,
          draftCurrencyCode: chargeCurrencyCode,
        },
      });
    } else {
      await tx.order.update({
        where: { id: orderId },
        data: {
          subtotalAmountMinor: chargeAmountMinor,
          totalAmountMinor: chargeAmountMinor,
          currencyCode: chargeCurrencyCode,
        },
      });
      await tx.orderItem.updateMany({
        where: { orderId, productId: selectedPrice.product.id, priceId: selectedPrice.id },
        data: {
          unitAmountMinor: chargeAmountMinor,
          lineSubtotalAmountMinor: chargeAmountMinor,
          lineTotalAmountMinor: chargeAmountMinor,
          currencyCode: chargeCurrencyCode,
        },
      });
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          draftAmountMinor: chargeAmountMinor,
          draftCurrencyCode: chargeCurrencyCode,
        },
      });
    }

    const existingPendingPayment = await tx.payment.findFirst({
      where: {
        bookingId,
        provider: PaymentProvider.STRIPE,
        status: PaymentStatus.PENDING,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, orderId: true },
    });

    const payment = existingPendingPayment
      ? await tx.payment.update({
          where: { id: existingPendingPayment.id },
          data: {
            orderId: existingPendingPayment.orderId ?? orderId,
            amountMinor: chargeAmountMinor,
            currencyCode: chargeCurrencyCode,
          },
          select: { id: true, orderId: true, stripeCheckoutSessionId: true },
        })
      : await tx.payment.create({
          data: {
            bookingId,
            orderId,
            status: PaymentStatus.PENDING,
            method: PaymentMethod.CARD,
            provider: PaymentProvider.STRIPE,
            checkoutSource: CheckoutSource.BOOKING_FLOW,
            amountMinor: chargeAmountMinor,
            currencyCode: chargeCurrencyCode,
          },
          select: { id: true, orderId: true, stripeCheckoutSessionId: true },
        });

    return {
      bookingId: readyCheckout.booking.id,
      serviceSlug: readyCheckout.booking.serviceSlug,
      paymentSelection: readyCheckout.booking.paymentSelection,
      userId: readyCheckout.userId,
      selectedPrice,
      isRecurringPlanPurchase,
      orderId: payment.orderId ?? orderId,
      paymentId: payment.id,
      existingCheckoutSessionId: payment.stripeCheckoutSessionId,
    };
  });

  const metadata = {
    bookingId: sessionContext.bookingId,
    paymentId: sessionContext.paymentId,
    orderId: sessionContext.orderId ?? "",
    paymentSelection: sessionContext.paymentSelection,
    selectedPriceId: sessionContext.selectedPrice.id,
    serviceSlug: sessionContext.serviceSlug,
    userId: sessionContext.userId,
    productId: sessionContext.selectedPrice.product.id,
    priceId: sessionContext.selectedPrice.id,
    source: "booking-flow",
  };

  const stripeIdempotencyKey = buildStripeIdempotencyKey([
    "booking-checkout",
    sessionContext.paymentId,
  ]);

  if (sessionContext.existingCheckoutSessionId) {
    if (isE2ETestModeEnabled()) {
      return {
        checkoutSessionId: sessionContext.existingCheckoutSessionId,
        checkoutUrl: buildBookingSyntheticCheckoutUrl({
          appUrl: env.appUrl,
          bookingId: sessionContext.bookingId,
          serviceSlug: sessionContext.serviceSlug,
          checkoutSessionId: sessionContext.existingCheckoutSessionId,
        }),
        paymentId: sessionContext.paymentId,
      };
    }

    const existingSession = await getStripeClient().checkout.sessions.retrieve(
      sessionContext.existingCheckoutSessionId,
    );
    if (!existingSession.url) {
      throw new Error("Existing Stripe checkout session is missing a checkout URL.");
    }
    return {
      checkoutSessionId: existingSession.id,
      checkoutUrl: existingSession.url,
      paymentId: sessionContext.paymentId,
    };
  }

  if (isE2ETestModeEnabled()) {
    const syntheticCheckoutSessionId = `cs_e2e_${Date.now()}_${sessionContext.paymentId.slice(-8)}`;
    const checkoutUrl = buildBookingSyntheticCheckoutUrl({
      appUrl: env.appUrl,
      bookingId: sessionContext.bookingId,
      serviceSlug: sessionContext.serviceSlug,
      checkoutSessionId: syntheticCheckoutSessionId,
    });

    await prisma.payment.update({
      where: { id: sessionContext.paymentId },
      data: {
        providerReference: syntheticCheckoutSessionId,
        stripeCheckoutSessionId: syntheticCheckoutSessionId,
        stripeCheckoutMode: sessionContext.isRecurringPlanPurchase ? "SUBSCRIPTION" : "PAYMENT",
      },
    });

    return {
      checkoutSessionId: syntheticCheckoutSessionId,
      checkoutUrl,
      paymentId: sessionContext.paymentId,
    };
  }

  const checkoutSession = await createStripeCheckoutSessionWithIdempotency({
    idempotencyKey: stripeIdempotencyKey,
    params: sessionContext.isRecurringPlanPurchase
      ? {
          mode: "subscription",
          line_items: [
            {
              price: sessionContext.selectedPrice.stripePriceId!,
              quantity: 1,
            },
          ],
          metadata,
          client_reference_id: sessionContext.userId,
          subscription_data: {
            metadata,
          },
          success_url: `${env.appUrl}/book-a-class/${sessionContext.serviceSlug}/payment/success?bookingId=${sessionContext.bookingId}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${env.appUrl}/book-a-class/${sessionContext.serviceSlug}/payment/cancel?bookingId=${sessionContext.bookingId}`,
        }
      : {
          mode: "payment",
          line_items: [
            {
              price: sessionContext.selectedPrice.stripePriceId!,
              quantity: 1,
            },
          ],
          metadata,
          success_url: `${env.appUrl}/book-a-class/${sessionContext.serviceSlug}/payment/success?bookingId=${sessionContext.bookingId}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${env.appUrl}/book-a-class/${sessionContext.serviceSlug}/payment/cancel?bookingId=${sessionContext.bookingId}`,
        },
  });

  if (!checkoutSession.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }

  await prisma.payment.update({
    where: { id: sessionContext.paymentId },
    data: {
      providerReference: checkoutSession.id,
      stripeCheckoutSessionId: checkoutSession.id,
      stripeCheckoutMode: sessionContext.isRecurringPlanPurchase ? "SUBSCRIPTION" : "PAYMENT",
    },
  });

  return {
    checkoutSessionId: checkoutSession.id,
    checkoutUrl: checkoutSession.url,
    paymentId: sessionContext.paymentId,
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

  const orderAndPayment = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

    const latestPrice = await tx.price.findFirst({
      where: {
        id: product.priceId,
        productId: product.productId,
        isActive: true,
        isArchived: false,
        product: {
          isActive: true,
          isArchived: false,
        },
      },
      select: {
        id: true,
        unitAmountMinor: true,
        currencyCode: true,
        priceType: true,
        billingInterval: true,
        billingIntervalCount: true,
        stripePriceId: true,
        stripeSyncStatus: true,
      },
    });
    if (!latestPrice || !isCatalogPriceCheckoutReady(latestPrice)) {
      throw new CatalogCheckoutError(
        "CHECKOUT_NOT_CONFIGURED",
        "Checkout is unavailable until Stripe pricing is configured.",
      );
    }

    const existingPending = await tx.payment.findFirst({
      where: {
        provider: PaymentProvider.STRIPE,
        status: PaymentStatus.PENDING,
        checkoutSource: CheckoutSource.SUBSCRIPTION_CATALOG,
        order: {
          clientId: userId,
          status: OrderStatus.PLACED,
          items: {
            some: {
              productId: product.productId,
              priceId: product.priceId,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderId: true,
        stripeCheckoutSessionId: true,
      },
    });

    if (existingPending?.orderId) {
      await tx.payment.update({
        where: { id: existingPending.id },
        data: {
          amountMinor: latestPrice.unitAmountMinor,
          currencyCode: latestPrice.currencyCode,
        },
      });
      await tx.order.update({
        where: { id: existingPending.orderId },
        data: {
          subtotalAmountMinor: latestPrice.unitAmountMinor,
          totalAmountMinor: latestPrice.unitAmountMinor,
          currencyCode: latestPrice.currencyCode,
        },
      });
      await tx.orderItem.updateMany({
        where: {
          orderId: existingPending.orderId,
          productId: product.productId,
          priceId: product.priceId,
        },
        data: {
          unitAmountMinor: latestPrice.unitAmountMinor,
          lineSubtotalAmountMinor: latestPrice.unitAmountMinor,
          lineTotalAmountMinor: latestPrice.unitAmountMinor,
          currencyCode: latestPrice.currencyCode,
        },
      });
      return {
        orderId: existingPending.orderId,
        paymentId: existingPending.id,
        existingCheckoutSessionId: existingPending.stripeCheckoutSessionId,
      };
    }

    const createdOrder = await tx.order.create({
      data: {
        clientId: userId,
        subtotalAmountMinor: latestPrice.unitAmountMinor,
        discountAmountMinor: 0,
        totalAmountMinor: latestPrice.unitAmountMinor,
        currencyCode: latestPrice.currencyCode,
        status: OrderStatus.PLACED,
        notes: "Product catalog order created from /subscription checkout.",
        items: {
          create: {
            productId: product.productId,
            priceId: product.priceId,
            quantity: 1,
            productNameSnapshot: product.name,
            priceNameSnapshot: product.priceName,
            unitAmountMinor: latestPrice.unitAmountMinor,
            lineSubtotalAmountMinor: latestPrice.unitAmountMinor,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: latestPrice.unitAmountMinor,
            currencyCode: latestPrice.currencyCode,
          },
        },
      },
      select: {
        id: true,
      },
    });
    const createdPayment = await tx.payment.create({
      data: {
        orderId: createdOrder.id,
        status: PaymentStatus.PENDING,
        method: PaymentMethod.CARD,
        provider: PaymentProvider.STRIPE,
        checkoutSource: CheckoutSource.SUBSCRIPTION_CATALOG,
        amountMinor: latestPrice.unitAmountMinor,
        currencyCode: latestPrice.currencyCode,
      },
      select: { id: true, stripeCheckoutSessionId: true },
    });

    return {
      orderId: createdOrder.id,
      paymentId: createdPayment.id,
      existingCheckoutSessionId: createdPayment.stripeCheckoutSessionId,
    };
  });

  const metadata = {
    userId,
    productId: product.productId,
    priceId: product.priceId,
    selectedPriceId: product.priceId,
    orderId: orderAndPayment.orderId,
    paymentId: orderAndPayment.paymentId,
    source: "subscription-catalog",
  };
  const stripeIdempotencyKey = buildStripeIdempotencyKey([
    "subscription-checkout",
    orderAndPayment.paymentId,
  ]);

  if (orderAndPayment.existingCheckoutSessionId) {
    if (isE2ETestModeEnabled()) {
      return {
        checkoutSessionId: orderAndPayment.existingCheckoutSessionId,
        checkoutUrl: buildSubscriptionSyntheticCheckoutUrl({
          appUrl: env.appUrl,
          checkoutSessionId: orderAndPayment.existingCheckoutSessionId,
        }),
        paymentId: orderAndPayment.paymentId,
        orderId: orderAndPayment.orderId,
      };
    }

    const existingSession = await getStripeClient().checkout.sessions.retrieve(
      orderAndPayment.existingCheckoutSessionId,
    );
    if (!existingSession.url) {
      throw new Error("Existing Stripe checkout session is missing a checkout URL.");
    }
    return {
      checkoutSessionId: existingSession.id,
      checkoutUrl: existingSession.url,
      paymentId: orderAndPayment.paymentId,
      orderId: orderAndPayment.orderId,
    };
  }

  if (isE2ETestModeEnabled()) {
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
      checkoutUrl: buildSubscriptionSyntheticCheckoutUrl({
        appUrl: env.appUrl,
        checkoutSessionId: syntheticCheckoutSessionId,
      }),
      paymentId: orderAndPayment.paymentId,
      orderId: orderAndPayment.orderId,
    };
  }

  const checkoutSession = await createStripeCheckoutSessionWithIdempotency({
    idempotencyKey: stripeIdempotencyKey,
    params: {
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
    },
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
