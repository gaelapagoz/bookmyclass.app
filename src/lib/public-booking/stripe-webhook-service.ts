import {
  BookingPaymentSelection,
  BookingStatus,
  CheckoutSource,
  CouponRedemptionStatus,
  GiftCardRedemptionStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  StripeWebhookReceiptStatus,
  SubscriptionStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import {
  CART_CHECKOUT_SOURCE,
  isActiveSubscriptionForCartConstraint,
} from "@/lib/cart/cart-contract";
import { prisma } from "../db";
import {
  captureGiftCardRedemption,
  releaseGiftCardRedemption,
} from "@/lib/gift-cards/gift-card-wallet-service";
import {
  createGiftCardManualReviewCase,
  recordGiftCardWebhookRetry,
} from "@/lib/gift-cards/gift-card-reconciliation-service";
import { emitGiftCardAlertEvent } from "@/lib/gift-cards/gift-card-events";
import { giftCardErrorCodes, GiftCardError } from "@/lib/gift-cards/gift-card-errors";
import { fulfillPaidCartOrder } from "@/lib/fulfillment/order-fulfillment-service";
import { getStripeClient } from "../payments/stripe";
import { isE2ETestModeEnabled } from "@/lib/e2e/e2e-test-guard";
import { emitCouponAlertEvent } from "@/lib/coupons/coupon-events";
import { settleCouponRedemptionForCartCheckout } from "@/lib/coupons/coupon-validation-service";
import {
  captureLoyaltyCreditReservation,
  releaseLoyaltyCreditReservation,
} from "@/lib/loyalty/loyalty-redemption-service";
import { transitionBookingToConfirmedAndQueueEmail } from "@/lib/public-booking/booking-confirmation-transition-service";
import {
  CouponSettlementAfterPaymentError,
  finalizeCartOrderCompletion,
  settleSuccessfulCheckoutOrder,
} from "@/lib/public-booking/checkout-finalization-service";
import { ensureOwnershipForSuccessfulPricePurchase } from "@/lib/public-booking/checkout-ownership-service";

type CatalogCheckoutMetadata = {
  userId: string;
  productId: string;
  priceId: string;
};

export type CheckoutReconciliationState = "PENDING" | "CONFIRMED" | "FAILED";

type GenericCheckoutMetadata = {
  userId: string | null;
  productId: string | null;
  priceId: string | null;
  selectedPriceId: string | null;
  paymentId: string | null;
  orderId: string | null;
  source: string | null;
};

const STALE_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000;
const E2E_SYNTHETIC_CHECKOUT_SESSION_PREFIX = "cs_e2e_";

function isE2ESyntheticCheckoutSessionId(checkoutSessionId: string): boolean {
  return checkoutSessionId.startsWith(E2E_SYNTHETIC_CHECKOUT_SESSION_PREFIX);
}

async function createPaidAfterReleaseManualReviewCase(input: {
  orderId: string;
  clientId: string;
  walletId: string | null;
  redemptionId: string;
  stripePaymentId: string;
  giftCardPaymentId: string;
  checkoutSessionId: string;
  paymentIntentId: string | null;
}) {
  await createGiftCardManualReviewCase({
    orderId: input.orderId,
    clientId: input.clientId,
    walletId: input.walletId,
    redemptionId: input.redemptionId,
    paymentId: input.stripePaymentId,
    reason: "STRIPE_PAID_AFTER_GIFT_CARD_RELEASE",
    idempotencyKey: `gift-card:manual-review:paid-after-release:${input.checkoutSessionId}:${input.redemptionId}`,
    metadata: {
      checkoutSessionId: input.checkoutSessionId,
      paymentIntentId: input.paymentIntentId,
      stripePaymentId: input.stripePaymentId,
      giftCardPaymentId: input.giftCardPaymentId,
      source: "stripe-webhook",
    },
  });
}

function logInfo(message: string, context?: Record<string, unknown>) {
  console.info("[stripe/webhook]", message, context ?? {});
}

function logWarn(message: string, context?: Record<string, unknown>) {
  console.warn("[stripe/webhook]", message, context ?? {});
}

async function acquireWebhookEventLease(eventId: string): Promise<"skip" | "proceed"> {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_PROCESSING_THRESHOLD_MS);

  const existing = await prisma.stripeWebhookEventReceipt.findUnique({
    where: { eventId },
    select: { status: true, updatedAt: true },
  });

  if (!existing) {
    try {
      await prisma.stripeWebhookEventReceipt.create({
        data: { eventId, status: StripeWebhookReceiptStatus.PROCESSING },
      });
      return "proceed";
    } catch {
      return "skip";
    }
  }

  if (existing.status === StripeWebhookReceiptStatus.PROCESSED) {
    logInfo("webhook event already processed, skipping", { eventId });
    return "skip";
  }

  if (
    existing.status === StripeWebhookReceiptStatus.PROCESSING &&
    existing.updatedAt > staleThreshold
  ) {
    logInfo("webhook event already in progress, skipping", { eventId });
    return "skip";
  }

  await prisma.stripeWebhookEventReceipt.update({
    where: { eventId },
    data: { status: StripeWebhookReceiptStatus.PROCESSING },
  });
  return "proceed";
}

async function markWebhookEventStatus(
  eventId: string,
  status: StripeWebhookReceiptStatus,
): Promise<void> {
  const result = await prisma.stripeWebhookEventReceipt.updateMany({
    where: { eventId },
    data: { status },
  });

  if (result.count === 0) {
    logWarn("webhook receipt missing during status update", {
      eventId,
      status,
    });
  }
}

async function markWebhookEventProcessed(eventId: string): Promise<void> {
  await markWebhookEventStatus(eventId, StripeWebhookReceiptStatus.PROCESSED);
}

async function markWebhookEventRetryable(eventId: string): Promise<void> {
  await markWebhookEventStatus(eventId, StripeWebhookReceiptStatus.RETRYABLE_FAILED);
}

async function resolveGiftCardRetryContext(event: Stripe.Event): Promise<{
  orderId: string;
  clientId: string;
  paymentId: string | null;
  redemptionId: string | null;
  walletId: string | null;
} | null> {
  const dataObject =
    event.data && typeof event.data === "object" && event.data.object && typeof event.data.object === "object"
      ? (event.data.object as { id?: unknown; metadata?: Stripe.Metadata | null })
      : null;
  const metadata = dataObject?.metadata ?? null;
  const paymentId = getStringMetadataValue(metadata, "paymentId");
  const orderId = getStringMetadataValue(metadata, "orderId");
  const checkoutSessionId = typeof dataObject?.id === "string" ? dataObject.id : null;

  const payment = paymentId
    ? await prisma.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          orderId: true,
          order: { select: { clientId: true } },
        },
      })
    : checkoutSessionId
      ? await prisma.payment.findFirst({
          where: {
            provider: PaymentProvider.STRIPE,
            OR: [
              { providerReference: checkoutSessionId },
              { stripeCheckoutSessionId: checkoutSessionId },
            ],
          },
          select: {
            id: true,
            orderId: true,
            order: { select: { clientId: true } },
          },
        })
      : null;

  const resolvedOrderId = payment?.orderId ?? orderId;
  if (!resolvedOrderId) {
    return null;
  }

  const order = payment?.order ?? (await prisma.order.findUnique({
    where: { id: resolvedOrderId },
    select: { clientId: true },
  }));
  if (!order?.clientId) {
    return null;
  }

  const redemption = await prisma.giftCardRedemption.findFirst({
    where: { orderId: resolvedOrderId },
    orderBy: { createdAt: "desc" },
    select: { id: true, walletId: true },
  });

  return {
    orderId: resolvedOrderId,
    clientId: order.clientId,
    paymentId: payment?.id ?? null,
    redemptionId: redemption?.id ?? null,
    walletId: redemption?.walletId ?? null,
  };
}

async function recordWebhookProcessingFailure(
  event: Stripe.Event,
  error: unknown,
): Promise<{ exhausted: boolean }> {
  const context = await resolveGiftCardRetryContext(event);
  if (!context) {
    return { exhausted: false };
  }

  return recordGiftCardWebhookRetry({
    orderId: context.orderId,
    clientId: context.clientId,
    walletId: context.walletId,
    redemptionId: context.redemptionId,
    paymentId: context.paymentId,
    reason: "STRIPE_WEBHOOK_PROCESSING_FAILED",
    idempotencyKey: [
      "gift-card:reconciliation:webhook",
      "reason:STRIPE_WEBHOOK_PROCESSING_FAILED",
      `order:${context.orderId}`,
      `redemption:${context.redemptionId ?? "none"}`,
      `payment:${context.paymentId ?? "none"}`,
    ].join(":"),
    metadata: {
      eventId: event.id,
      eventType: event.type,
      source: "stripe-webhook",
    },
    error,
  });
}

function getStringMetadataValue(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseCatalogCheckoutMetadata(
  metadata: Stripe.Metadata | null | undefined,
): CatalogCheckoutMetadata | null {
  const userId = getStringMetadataValue(metadata, "userId");
  const productId = getStringMetadataValue(metadata, "productId");
  const priceId = getStringMetadataValue(metadata, "priceId");

  if (!userId || !productId || !priceId) {
    return null;
  }

  return { userId, productId, priceId };
}

function parseGenericCheckoutMetadata(
  metadata: Stripe.Metadata | null | undefined,
): GenericCheckoutMetadata {
  return {
    userId: getStringMetadataValue(metadata, "userId"),
    productId: getStringMetadataValue(metadata, "productId"),
    priceId: getStringMetadataValue(metadata, "priceId"),
    selectedPriceId: getStringMetadataValue(metadata, "selectedPriceId"),
    paymentId: getStringMetadataValue(metadata, "paymentId"),
    orderId: getStringMetadataValue(metadata, "orderId"),
    source: getStringMetadataValue(metadata, "source"),
  };
}

function normalizeCheckoutSource(source: string | null): CheckoutSource | null {
  if (source === "booking-flow") {
    return CheckoutSource.BOOKING_FLOW;
  }

  if (source === "subscription-catalog") {
    return CheckoutSource.SUBSCRIPTION_CATALOG;
  }

  if (source === CART_CHECKOUT_SOURCE) {
    return CheckoutSource.CART_CHECKOUT_V1;
  }

  return null;
}

function resolveCheckoutSource(input: {
  localCheckoutSource: CheckoutSource | null | undefined;
  metadataSource: string | null;
}): CheckoutSource | null {
  if (input.localCheckoutSource) {
    return input.localCheckoutSource;
  }

  return normalizeCheckoutSource(input.metadataSource);
}

function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return SubscriptionStatus.ACTIVE;
    case "canceled":
      return SubscriptionStatus.CANCELLED;
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
      return SubscriptionStatus.PAST_DUE;
    default:
      return SubscriptionStatus.PENDING;
  }
}

function fromUnixSeconds(value: number | null | undefined, fallback: Date): Date {
  if (!value) {
    return fallback;
  }

  return new Date(value * 1000);
}

async function upsertSubscriptionContract(input: {
  stripeSubscription: Stripe.Subscription;
  metadata: CatalogCheckoutMetadata | null;
  checkoutSource?: CheckoutSource | null;
  userIdHint?: string | null;
}) {
  const { stripeSubscription, metadata } = input;
  const stripeSubscriptionId = stripeSubscription.id;
  const stripePriceId = stripeSubscription.items.data[0]?.price?.id ?? null;

  let resolvedPriceId = metadata?.priceId ?? null;
  let resolvedProductId = metadata?.productId ?? null;

  if (!resolvedPriceId && stripePriceId) {
    const price = await prisma.price.findUnique({
      where: { stripePriceId },
      select: { id: true, productId: true },
    });
    resolvedPriceId = price?.id ?? null;
    resolvedProductId = price?.productId ?? null;
  }

  if (!resolvedPriceId || !resolvedProductId) {
    return;
  }

  const existingContract = await prisma.subscriptionContract.findUnique({
    where: {
      provider_providerSubscriptionReference: {
        provider: PaymentProvider.STRIPE,
        providerSubscriptionReference: stripeSubscriptionId,
      },
    },
    select: { clientId: true },
  });

  const resolvedUserId = metadata?.userId ?? input.userIdHint ?? existingContract?.clientId ?? null;
  if (!resolvedUserId) {
    return;
  }

  const subscriptionItem = stripeSubscription.items.data[0];
  const currentPeriodStart = fromUnixSeconds(subscriptionItem?.current_period_start, new Date());
  const currentPeriodEnd = fromUnixSeconds(subscriptionItem?.current_period_end, currentPeriodStart);
  const startsAt = fromUnixSeconds(stripeSubscription.start_date, currentPeriodStart);
  const cancelledAt = stripeSubscription.canceled_at
    ? fromUnixSeconds(stripeSubscription.canceled_at, currentPeriodEnd)
    : null;
  const endedAt = stripeSubscription.ended_at
    ? fromUnixSeconds(stripeSubscription.ended_at, currentPeriodEnd)
    : null;
  const nextStatus = mapStripeSubscriptionStatus(stripeSubscription.status);

  if (
    input.checkoutSource === CheckoutSource.CART_CHECKOUT_V1 &&
    nextStatus === SubscriptionStatus.ACTIVE
  ) {
    const activeContracts = await prisma.subscriptionContract.findMany({
      where: { clientId: resolvedUserId },
      select: {
        id: true,
        status: true,
        currentPeriodEnd: true,
        endedAt: true,
        provider: true,
        providerSubscriptionReference: true,
      },
    });

    const hasOtherActiveContract = activeContracts.some((contract) => {
      if (
        contract.provider === PaymentProvider.STRIPE &&
        contract.providerSubscriptionReference === stripeSubscriptionId
      ) {
        return false;
      }

      return isActiveSubscriptionForCartConstraint({
        status: contract.status,
        currentPeriodEnd: contract.currentPeriodEnd,
        endedAt: contract.endedAt,
      });
    });

    if (hasOtherActiveContract) {
      logWarn("cart subscription ownership skipped: active subscription already exists", {
        clientId: resolvedUserId,
        stripeSubscriptionId,
      });
      return;
    }
  }

  await prisma.subscriptionContract.upsert({
    where: {
      provider_providerSubscriptionReference: {
        provider: PaymentProvider.STRIPE,
        providerSubscriptionReference: stripeSubscriptionId,
      },
    },
    update: {
      status: nextStatus,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      cancelledAt,
      endedAt,
      productId: resolvedProductId,
      priceId: resolvedPriceId,
    },
    create: {
      clientId: resolvedUserId,
      productId: resolvedProductId,
      priceId: resolvedPriceId,
      status: nextStatus,
      startsAt,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      cancelledAt,
      endedAt,
      provider: PaymentProvider.STRIPE,
      providerSubscriptionReference: stripeSubscriptionId,
    },
  });
}

async function upsertSyntheticSubscriptionContractForE2ETests(input: {
  userId: string;
  priceId: string;
  productId: string;
  checkoutSessionId: string;
}) {
  const now = new Date();
  const currentPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const providerSubscriptionReference = `e2e-subscription-${input.checkoutSessionId}`;

  await prisma.subscriptionContract.upsert({
    where: {
      provider_providerSubscriptionReference: {
        provider: PaymentProvider.STRIPE,
        providerSubscriptionReference,
      },
    },
    update: {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      endedAt: null,
      productId: input.productId,
      priceId: input.priceId,
    },
    create: {
      clientId: input.userId,
      productId: input.productId,
      priceId: input.priceId,
      status: SubscriptionStatus.ACTIVE,
      startsAt: now,
      currentPeriodStart: now,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      endedAt: null,
      provider: PaymentProvider.STRIPE,
      providerSubscriptionReference,
    },
  });
}

async function ensureCatalogPaymentForCompletedSession(input: {
  session: Stripe.Checkout.Session;
  metadata: CatalogCheckoutMetadata;
}) {
  const { session, metadata } = input;
  const price = await prisma.price.findFirst({
    where: {
      id: metadata.priceId,
      productId: metadata.productId,
      isActive: true,
      isArchived: false,
    },
    select: {
      id: true,
      name: true,
      unitAmountMinor: true,
      currencyCode: true,
      product: { select: { name: true } },
    },
  });

  if (!price) {
    return null;
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const amountMinor = typeof session.amount_total === "number" ? session.amount_total : price.unitAmountMinor;
  const currencyCode =
    typeof session.currency === "string" ? session.currency.toUpperCase() : price.currencyCode.toUpperCase();
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  const payment = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        clientId: metadata.userId,
        subtotalAmountMinor: amountMinor,
        discountAmountMinor: 0,
        totalAmountMinor: amountMinor,
        currencyCode,
        status: OrderStatus.PAID,
        notes: "Recovered order from Stripe webhook (catalog checkout).",
      },
      select: { id: true },
    });

    await tx.orderItem.create({
      data: {
        orderId: order.id,
        productId: metadata.productId,
        priceId: metadata.priceId,
        quantity: 1,
        productNameSnapshot: price.product.name,
        priceNameSnapshot: price.name,
        unitAmountMinor: amountMinor,
        lineSubtotalAmountMinor: amountMinor,
        lineDiscountAmountMinor: 0,
        lineTotalAmountMinor: amountMinor,
        currencyCode,
      },
    });

    return tx.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.SUCCEEDED,
        provider: PaymentProvider.STRIPE,
        method: PaymentMethod.CARD,
        providerReference: paymentIntentId ?? session.id,
        stripeCheckoutSessionId: session.id,
        stripeCustomerId,
        stripeCheckoutMode: session.mode === "subscription" ? "SUBSCRIPTION" : "PAYMENT",
        amountMinor,
        currencyCode,
        capturedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        bookingId: true,
        orderId: true,
        checkoutSource: true,
        booking: {
          select: {
            id: true,
            status: true,
            paymentSelection: true,
            selectedPriceId: true,
            clientId: true,
            orderId: true,
          },
        },
      },
    });
  });

  return payment;
}

async function markPaymentFailedByCheckoutSession(input: {
  checkoutSessionId: string;
  reason: string;
  couponStatus?: Extract<CouponRedemptionStatus, "EXPIRED" | "REVERSED">;
}) {
  logInfo("mark payment failed", input);
  const payment = await prisma.payment.findFirst({
    where: {
      provider: PaymentProvider.STRIPE,
      OR: [
        { providerReference: input.checkoutSessionId },
        { stripeCheckoutSessionId: input.checkoutSessionId },
      ],
    },
    select: { id: true, status: true, orderId: true },
  });

  if (!payment || payment.status === PaymentStatus.SUCCEEDED) {
    logWarn("mark payment failed skipped", {
      checkoutSessionId: input.checkoutSessionId,
      hasPayment: Boolean(payment),
      status: payment?.status ?? null,
    });
    return;
  }

  const redemption = payment.orderId
    ? await prisma.giftCardRedemption.findFirst({
        where: { orderId: payment.orderId, status: GiftCardRedemptionStatus.RESERVED },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    : null;
  const loyaltyCreditReservation = payment.orderId
    ? await prisma.loyaltyCreditReservation.findFirst({
        where: { orderId: payment.orderId, status: "RESERVED" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    : null;

  if (redemption) {
    try {
      await releaseGiftCardRedemption({
        actor: { type: "SYSTEM", label: "stripe-checkout-failure" },
        redemptionId: redemption.id,
        idempotencyKey: `gift-card:release:redemption:${redemption.id}`,
        metadata: {
          checkoutSessionId: input.checkoutSessionId,
          reason: input.reason,
          source: "stripe-webhook",
        },
      });
    } catch (error) {
      if (
        !(error instanceof GiftCardError) ||
        error.code !== giftCardErrorCodes.invalidTransition
      ) {
        throw error;
      }
    }
  }
  if (loyaltyCreditReservation) {
    try {
      await releaseLoyaltyCreditReservation({
        actor: { type: "SYSTEM", label: "stripe-checkout-failure" },
        reservationId: loyaltyCreditReservation.id,
        idempotencyKey: `loyalty-credit:release:reservation:${loyaltyCreditReservation.id}`,
        metadata: {
          checkoutSessionId: input.checkoutSessionId,
          reason: input.reason,
          source: "stripe-webhook",
        },
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("no longer releasable")) {
        throw error;
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failedAt: new Date(),
        failureReason: input.reason,
      },
    });

    if (payment.orderId) {
      await tx.payment.updateMany({
        where: {
          orderId: payment.orderId,
          provider: PaymentProvider.INTERNAL,
          method: {
            in: [PaymentMethod.GIFT_CARD, PaymentMethod.LOYALTY_CREDIT],
          },
          status: PaymentStatus.PENDING,
        },
        data: {
          status: PaymentStatus.FAILED,
          failedAt: new Date(),
          failureReason: input.reason,
        },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: OrderStatus.CANCELLED },
      });

      if (input.couponStatus) {
        await settleCouponRedemptionForCartCheckout({
          tx,
          orderId: payment.orderId,
          paymentId: payment.id,
          stripeCheckoutSessionId: input.checkoutSessionId,
          nextStatus: input.couponStatus,
          failureReason: input.reason,
        });
      }
    }
  });
}

async function emitCouponSettlementFailureAlert(input: {
  orderId: string;
  paymentId: string;
  stripeCheckoutSessionId: string;
  error: unknown;
}) {
  const redemption = await prisma.couponRedemption.findFirst({
    where: {
      OR: [
        { orderId: input.orderId },
        { paymentId: input.paymentId },
        { stripeCheckoutSessionId: input.stripeCheckoutSessionId },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      couponId: true,
      clientId: true,
      status: true,
    },
  });

  if (!redemption) {
    return;
  }

  await emitCouponAlertEvent({
    eventName: "coupon.reconciliation_required",
    entityType: "CouponRedemption",
    entityId: redemption.id,
    metadata: {
      couponId: redemption.couponId,
      clientId: redemption.clientId,
      orderId: input.orderId,
      paymentId: input.paymentId,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      redemptionStatus: redemption.status,
      stage: "stripe_checkout_success_coupon_settlement",
      source: "stripe-webhook",
    },
    error: input.error,
  });
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  options?: {
    allowStripeRetrieve?: boolean;
  },
) {
  logInfo("checkout.session.completed received", {
    checkoutSessionId: session.id,
    paymentStatus: session.payment_status,
  });

  if (session.payment_status !== "paid") {
    await markPaymentFailedByCheckoutSession({
      checkoutSessionId: session.id,
      reason: "Checkout completed without successful payment status.",
      couponStatus: CouponRedemptionStatus.REVERSED,
    });
    return;
  }

  const genericMetadata = parseGenericCheckoutMetadata(session.metadata);
  const paymentIdFromMetadata = genericMetadata.paymentId;
  const bookingIdFromMetadata = getStringMetadataValue(session.metadata, "bookingId");
  const selectedPriceIdFromMetadata = genericMetadata.selectedPriceId ?? genericMetadata.priceId;
  const catalogMetadata = parseCatalogCheckoutMetadata(session.metadata);
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  let payment = paymentIdFromMetadata
    ? await prisma.payment.findUnique({
        where: { id: paymentIdFromMetadata },
        select: {
          id: true,
          status: true,
          bookingId: true,
          orderId: true,
          checkoutSource: true,
          booking: {
            select: {
              id: true,
              status: true,
              paymentSelection: true,
              selectedPriceId: true,
              clientId: true,
              orderId: true,
            },
          },
        },
      })
    : await prisma.payment.findFirst({
        where: { providerReference: session.id, provider: PaymentProvider.STRIPE },
        select: {
          id: true,
          status: true,
          bookingId: true,
          orderId: true,
          checkoutSource: true,
          booking: {
            select: {
              id: true,
              status: true,
              paymentSelection: true,
              selectedPriceId: true,
              clientId: true,
              orderId: true,
            },
          },
        },
      });

  if (!payment && paymentIntentId) {
    payment = await prisma.payment.findFirst({
      where: {
        provider: PaymentProvider.STRIPE,
        providerReference: paymentIntentId,
      },
      select: {
        id: true,
        status: true,
        bookingId: true,
        orderId: true,
        checkoutSource: true,
        booking: {
          select: {
            id: true,
            status: true,
            paymentSelection: true,
            selectedPriceId: true,
            clientId: true,
            orderId: true,
          },
        },
      },
    });
  }

  const metadataSource = genericMetadata.source;
  const metadataCheckoutSource = normalizeCheckoutSource(metadataSource);

  if (!payment && metadataCheckoutSource === CheckoutSource.CART_CHECKOUT_V1) {
    logWarn("cart-source checkout completion has no local payment; skipping metadata reconstruction", {
      checkoutSessionId: session.id,
      paymentIdFromMetadata,
      paymentIntentId,
    });
    return;
  }

  if (!payment && catalogMetadata) {
    payment = await ensureCatalogPaymentForCompletedSession({
      session,
      metadata: catalogMetadata,
    });
  }

  if (!payment) {
    const allowStripeRetrieve = options?.allowStripeRetrieve ?? true;
    const metadataIsEmpty = !session.metadata || Object.keys(session.metadata).length === 0;
    const sessionLooksThin = metadataIsEmpty || session.amount_total === null;

    if (allowStripeRetrieve && sessionLooksThin) {
      const stripeSession = await getStripeClient().checkout.sessions.retrieve(session.id);
      if (stripeSession && typeof stripeSession.id === "string" && stripeSession.id.length > 0) {
        await handleCheckoutCompleted(stripeSession, { allowStripeRetrieve: false });
        return;
      }
      return;
    }

    logWarn("no local payment matched checkout completion", {
      checkoutSessionId: session.id,
      paymentIdFromMetadata,
      paymentIntentId,
      bookingIdFromMetadata,
    });
    return;
  }

  if (bookingIdFromMetadata && payment.bookingId && bookingIdFromMetadata !== payment.bookingId) {
    logWarn("checkout completion skipped: metadata booking does not match local payment", {
      checkoutSessionId: session.id,
      paymentId: payment.id,
      paymentBookingId: payment.bookingId,
      metadataBookingId: bookingIdFromMetadata,
    });
    return;
  }

  const expectedOrderId = payment.orderId ?? payment.booking?.orderId ?? null;
  if (genericMetadata.orderId && expectedOrderId && genericMetadata.orderId !== expectedOrderId) {
    logWarn("checkout completion skipped: metadata order does not match local payment", {
      checkoutSessionId: session.id,
      paymentId: payment.id,
      paymentOrderId: expectedOrderId,
      metadataOrderId: genericMetadata.orderId,
    });
    return;
  }

  const booking =
    payment.booking ??
    (bookingIdFromMetadata
      ? await prisma.booking.findUnique({
          where: { id: bookingIdFromMetadata },
          select: {
            id: true,
            status: true,
            paymentSelection: true,
            selectedPriceId: true,
            clientId: true,
            orderId: true,
          },
        })
      : null);
  const orderId = payment.orderId ?? booking?.orderId ?? null;
  const checkoutSource = resolveCheckoutSource({
    localCheckoutSource: payment.checkoutSource,
    metadataSource,
  });

  let capturedGiftCardPaymentId: string | null = null;
  let capturedLoyaltyCreditPaymentId: string | null = null;
  if (checkoutSource === CheckoutSource.CART_CHECKOUT_V1 && orderId) {
    const giftCardPayment = await prisma.payment.findFirst({
      where: {
        orderId,
        provider: PaymentProvider.INTERNAL,
        method: PaymentMethod.GIFT_CARD,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    const redemption = await prisma.giftCardRedemption.findFirst({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, clientId: true, walletId: true },
    });

    if (giftCardPayment && !redemption) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { clientId: true },
      });
      if (order?.clientId) {
        await createGiftCardManualReviewCase({
          orderId,
          clientId: order.clientId,
          paymentId: payment.id,
          reason: "GIFT_CARD_PAYMENT_WITHOUT_REDEMPTION",
          idempotencyKey: `gift-card:manual-review:missing-redemption:${orderId}:${giftCardPayment.id}`,
          metadata: {
            checkoutSessionId: session.id,
            stripePaymentId: payment.id,
            giftCardPaymentId: giftCardPayment.id,
            source: "stripe-webhook",
          },
        });
      }
      logWarn("cart checkout completion blocked: gift-card payment has no redemption", {
        checkoutSessionId: session.id,
        orderId,
        giftCardPaymentId: giftCardPayment.id,
      });
      return;
    }

    if (giftCardPayment && redemption?.status === GiftCardRedemptionStatus.RELEASED) {
      await createPaidAfterReleaseManualReviewCase({
        orderId,
        clientId: redemption.clientId,
        walletId: redemption.walletId,
        redemptionId: redemption.id,
        stripePaymentId: payment.id,
        giftCardPaymentId: giftCardPayment.id,
        checkoutSessionId: session.id,
        paymentIntentId,
      });
      logWarn("cart checkout completion blocked: gift-card redemption already released", {
        checkoutSessionId: session.id,
        orderId,
        giftCardPaymentId: giftCardPayment.id,
        redemptionId: redemption.id,
      });
      return;
    }

    if (
      giftCardPayment &&
      redemption?.status === GiftCardRedemptionStatus.CAPTURED &&
      giftCardPayment.status !== PaymentStatus.SUCCEEDED
    ) {
      capturedGiftCardPaymentId = giftCardPayment.id;
    }

    if (
      giftCardPayment &&
      redemption?.status === GiftCardRedemptionStatus.RESERVED &&
      giftCardPayment.status === PaymentStatus.PENDING
    ) {
      try {
        await captureGiftCardRedemption({
          actor: { type: "SYSTEM", label: "stripe-checkout-success" },
          redemptionId: redemption.id,
          paymentId: giftCardPayment.id,
          idempotencyKey: `gift-card:capture:redemption:${redemption.id}`,
          metadata: {
            checkoutSessionId: session.id,
            stripePaymentId: payment.id,
            source: "stripe-webhook",
          },
        });
      } catch (error) {
        await emitGiftCardAlertEvent({
          eventName: "gift_card.capture_failed_after_stripe_success",
          entityType: "GiftCardRedemption",
          entityId: redemption.id,
          metadata: {
            orderId,
            clientId: redemption.clientId,
            walletId: redemption.walletId,
            stripePaymentId: payment.id,
            giftCardPaymentId: giftCardPayment.id,
            checkoutSessionId: session.id,
          },
          error,
        });
        throw error;
      }
      capturedGiftCardPaymentId = giftCardPayment.id;
    }

    if (
      giftCardPayment &&
      giftCardPayment.status !== PaymentStatus.SUCCEEDED &&
      !capturedGiftCardPaymentId
    ) {
      logWarn("cart checkout completion blocked: gift-card payment is not capturable", {
        checkoutSessionId: session.id,
        orderId,
        giftCardPaymentId: giftCardPayment.id,
        giftCardPaymentStatus: giftCardPayment.status,
        redemptionId: redemption?.id ?? null,
        redemptionStatus: redemption?.status ?? null,
      });
      return;
    }

    const loyaltyCreditPayment = await prisma.payment.findFirst({
      where: {
        orderId,
        provider: PaymentProvider.INTERNAL,
        method: PaymentMethod.LOYALTY_CREDIT,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    const loyaltyCreditReservation = await prisma.loyaltyCreditReservation.findFirst({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });

    if (loyaltyCreditPayment && !loyaltyCreditReservation) {
      logWarn("cart checkout completion blocked: loyalty credit payment has no reservation", {
        checkoutSessionId: session.id,
        orderId,
        loyaltyCreditPaymentId: loyaltyCreditPayment.id,
      });
      return;
    }

    if (loyaltyCreditPayment && loyaltyCreditReservation?.status === "RELEASED") {
      logWarn("cart checkout completion blocked: loyalty credit reservation already released", {
        checkoutSessionId: session.id,
        orderId,
        loyaltyCreditPaymentId: loyaltyCreditPayment.id,
        loyaltyCreditReservationId: loyaltyCreditReservation.id,
      });
      return;
    }

    if (
      loyaltyCreditPayment &&
      loyaltyCreditReservation?.status === "CAPTURED" &&
      loyaltyCreditPayment.status !== PaymentStatus.SUCCEEDED
    ) {
      capturedLoyaltyCreditPaymentId = loyaltyCreditPayment.id;
    }

    if (
      loyaltyCreditPayment &&
      loyaltyCreditReservation?.status === "RESERVED" &&
      loyaltyCreditPayment.status === PaymentStatus.PENDING
    ) {
      await captureLoyaltyCreditReservation({
        actor: { type: "SYSTEM", label: "stripe-checkout-success" },
        reservationId: loyaltyCreditReservation.id,
        paymentId: loyaltyCreditPayment.id,
        idempotencyKey: `loyalty-credit:capture:reservation:${loyaltyCreditReservation.id}`,
        metadata: {
          checkoutSessionId: session.id,
          stripePaymentId: payment.id,
          source: "stripe-webhook",
        },
      });
      capturedLoyaltyCreditPaymentId = loyaltyCreditPayment.id;
    }

    if (
      loyaltyCreditPayment &&
      loyaltyCreditPayment.status !== PaymentStatus.SUCCEEDED &&
      !capturedLoyaltyCreditPaymentId
    ) {
      logWarn("cart checkout completion blocked: loyalty credit payment is not capturable", {
        checkoutSessionId: session.id,
        orderId,
        loyaltyCreditPaymentId: loyaltyCreditPayment.id,
        loyaltyCreditPaymentStatus: loyaltyCreditPayment.status,
        loyaltyCreditReservationId: loyaltyCreditReservation?.id ?? null,
        loyaltyCreditReservationStatus: loyaltyCreditReservation?.status ?? null,
      });
      return;
    }
  }

  await prisma.$transaction(async (tx) => {
    if (payment.status !== PaymentStatus.SUCCEEDED) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          capturedAt: new Date(),
          orderId,
          providerReference: paymentIntentId ?? session.id,
          stripeCheckoutSessionId: session.id,
          stripeCheckoutMode: session.mode === "subscription" ? "SUBSCRIPTION" : "PAYMENT",
          stripeCustomerId,
          ...(checkoutSource ? { checkoutSource } : {}),
        },
      });
    } else if (stripeCustomerId) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          stripeCustomerId,
          stripeCheckoutSessionId: session.id,
          ...(checkoutSource ? { checkoutSource } : {}),
        },
      });
    } else if (checkoutSource) {
      await tx.payment.update({
        where: { id: payment.id },
        data: { checkoutSource },
      });
    }

  });

  if (orderId) {
    try {
      await settleSuccessfulCheckoutOrder({
        orderId,
        paymentId: payment.id,
        stripeCheckoutSessionId: session.id,
        internalPaymentIds: [capturedGiftCardPaymentId, capturedLoyaltyCreditPaymentId],
        loyaltyMetadata: {
          source: "stripe-webhook",
          checkoutSource,
          webhookCheckoutSessionId: session.id,
        },
      });
    } catch (error) {
      if (error instanceof CouponSettlementAfterPaymentError) {
        await emitCouponSettlementFailureAlert({
          orderId,
          paymentId: payment.id,
          stripeCheckoutSessionId: session.id,
          error: error.cause,
        });
      }
      throw error;
    }
  }

  if (checkoutSource === CheckoutSource.CART_CHECKOUT_V1) {
    if (orderId) {
      const resolvedClientId =
        booking?.clientId ??
        catalogMetadata?.userId ??
        (
          await prisma.order.findUnique({
            where: { id: orderId },
            select: { clientId: true },
          })
        )?.clientId ??
        null;

      if (resolvedClientId) {
        await finalizeCartOrderCompletion({
          orderId,
          clientId: resolvedClientId,
          giftCardPaymentId: capturedGiftCardPaymentId,
          booking: booking
            ? {
                id: booking.id,
                paymentSelection: booking.paymentSelection,
                selectedPriceId: booking.selectedPriceId ?? selectedPriceIdFromMetadata,
              }
            : null,
        });
      }
    }
  } else if (booking && booking.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE) {
    if (booking.clientId && selectedPriceIdFromMetadata) {
      await ensureOwnershipForSuccessfulPricePurchase({
        clientId: booking.clientId,
        bookingId: booking.id,
        enforceBookingSelectionMatch: true,
        orderId,
        selectedPriceId: selectedPriceIdFromMetadata,
        consumeCreditForBooking: true,
      });
      if (orderId) {
        await fulfillPaidCartOrder({
          orderId,
          clientId: booking.clientId,
          idempotencyKeyPrefix: "stripe-fulfillment",
          issueGiftCardCodes: false,
          grantEntitlements: false,
        });
      }
    }
  } else if (catalogMetadata && selectedPriceIdFromMetadata) {
    await ensureOwnershipForSuccessfulPricePurchase({
      clientId: catalogMetadata.userId,
      orderId,
      selectedPriceId: selectedPriceIdFromMetadata,
      consumeCreditForBooking: false,
    });
    if (orderId) {
      await fulfillPaidCartOrder({
        orderId,
        clientId: catalogMetadata.userId,
        idempotencyKeyPrefix: "stripe-fulfillment",
      });
    }
  }

  if (session.mode === "subscription") {
    const stripeSubscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
    if (stripeSubscriptionId) {
      const stripeSubscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
      let resolvedMetadata = catalogMetadata;
      if (!resolvedMetadata && orderId) {
        const orderItem = await prisma.orderItem.findFirst({
          where: { orderId },
          orderBy: { createdAt: "asc" },
          select: {
            productId: true,
            priceId: true,
            order: {
              select: { clientId: true },
            },
          },
        });
        if (orderItem) {
          resolvedMetadata = {
            userId: orderItem.order.clientId,
            productId: orderItem.productId,
            priceId: orderItem.priceId,
          };
        }
      }
      await upsertSubscriptionContract({
        stripeSubscription,
        metadata: resolvedMetadata,
        checkoutSource,
      });
    } else if (isE2ETestModeEnabled()) {
      const resolvedPriceId = selectedPriceIdFromMetadata ?? null;
      const resolvedUserId = catalogMetadata?.userId ?? booking?.clientId ?? null;
      if (resolvedPriceId && resolvedUserId) {
        const resolvedProductId =
          catalogMetadata?.productId ??
          (
            await prisma.price.findUnique({
              where: { id: resolvedPriceId },
              select: { productId: true },
            })
          )?.productId ??
          null;
        if (resolvedProductId) {
          await upsertSyntheticSubscriptionContractForE2ETests({
            userId: resolvedUserId,
            priceId: resolvedPriceId,
            productId: resolvedProductId,
            checkoutSessionId: session.id,
          });
        }
      }
    }
  }

  if (booking && booking.status === BookingStatus.PENDING) {
    await transitionBookingToConfirmedAndQueueEmail({ bookingId: booking.id });
  }
}

async function handleSubscriptionContractChange(stripeSubscription: Stripe.Subscription) {
  const metadata = parseCatalogCheckoutMetadata(stripeSubscription.metadata);
  const genericMetadata = parseGenericCheckoutMetadata(stripeSubscription.metadata);
  await upsertSubscriptionContract({
    stripeSubscription,
    metadata,
    checkoutSource: normalizeCheckoutSource(genericMetadata.source),
    userIdHint: genericMetadata.userId,
  });
}

export async function reconcileCheckoutSessionAfterReturn(input: {
  checkoutSessionId: string;
  bookingId: string;
  userId: string;
}) {
  logInfo("manual reconciliation requested", input);

  const booking = await prisma.booking.findFirst({
    where: {
      id: input.bookingId,
      clientId: input.userId,
    },
    select: {
      id: true,
      status: true,
      payments: {
        where: {
          provider: PaymentProvider.STRIPE,
          OR: [
            { stripeCheckoutSessionId: input.checkoutSessionId },
            { providerReference: input.checkoutSessionId },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true },
      },
    },
  });

  if (!booking) {
    logWarn("manual reconciliation aborted: booking not found for user", input);
    return;
  }

  const payment = booking.payments[0] ?? null;
  if (!payment) {
    logWarn("manual reconciliation aborted: no payment matched checkout session id", input);
    return;
  }

  if (booking.status === BookingStatus.CONFIRMED && payment.status === PaymentStatus.SUCCEEDED) {
    return;
  }

  if (
    isE2ETestModeEnabled() &&
    isE2ESyntheticCheckoutSessionId(input.checkoutSessionId)
  ) {
    return;
  }

  const stripeSession = await getStripeClient().checkout.sessions.retrieve(input.checkoutSessionId);
  const metadataBookingId = getStringMetadataValue(stripeSession.metadata, "bookingId");
  if (metadataBookingId && metadataBookingId !== input.bookingId) {
    logWarn("manual reconciliation aborted: metadata booking mismatch", {
      checkoutSessionId: input.checkoutSessionId,
      bookingId: input.bookingId,
      metadataBookingId,
    });
    return;
  }

  await handleCheckoutCompleted(stripeSession);
}

export async function reconcileCatalogCheckoutSessionAfterReturn(input: {
  checkoutSessionId: string;
  userId: string;
  productId?: string;
}) {
  logInfo("catalog manual reconciliation requested", input);

  const localPayment = await prisma.payment.findFirst({
    where: {
      provider: PaymentProvider.STRIPE,
      OR: [
        { stripeCheckoutSessionId: input.checkoutSessionId },
        { providerReference: input.checkoutSessionId },
      ],
    },
    select: {
      id: true,
      status: true,
      checkoutSource: true,
      booking: {
        select: {
          clientId: true,
        },
      },
      order: {
        select: {
          status: true,
          clientId: true,
          items: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { productId: true },
          },
        },
      },
    },
  });

  if (localPayment) {
    const localClientId = localPayment.order?.clientId ?? localPayment.booking?.clientId ?? null;
    if (localClientId && localClientId !== input.userId) {
      logWarn("catalog manual reconciliation aborted: local payment belongs to different user", {
        checkoutSessionId: input.checkoutSessionId,
        requestedUserId: input.userId,
        paymentId: localPayment.id,
      });
      return;
    }

    if (input.productId) {
      const localProductId = localPayment.order?.items[0]?.productId ?? null;
      if (localProductId && localProductId !== input.productId) {
        logWarn("catalog manual reconciliation aborted: local order product mismatch", {
          checkoutSessionId: input.checkoutSessionId,
          requestedProductId: input.productId,
          localProductId,
        });
        return;
      }
    }

    if (
      localPayment.status === PaymentStatus.SUCCEEDED &&
      localPayment.order?.status === OrderStatus.PAID
    ) {
      return;
    }

    if (
      isE2ETestModeEnabled() &&
      isE2ESyntheticCheckoutSessionId(input.checkoutSessionId)
    ) {
      return;
    }

    const stripeSession = await getStripeClient().checkout.sessions.retrieve(input.checkoutSessionId);
    await handleCheckoutCompleted(stripeSession);
    return;
  }

  if (
    isE2ETestModeEnabled() &&
    isE2ESyntheticCheckoutSessionId(input.checkoutSessionId)
  ) {
    return;
  }

  const stripeSession = await getStripeClient().checkout.sessions.retrieve(input.checkoutSessionId);
  const metadata = parseCatalogCheckoutMetadata(stripeSession.metadata);

  if (!metadata) {
    logWarn("catalog manual reconciliation aborted: missing catalog metadata", {
      checkoutSessionId: input.checkoutSessionId,
    });
    return;
  }

  if (metadata.userId !== input.userId) {
    logWarn("catalog manual reconciliation aborted: metadata user mismatch", {
      checkoutSessionId: input.checkoutSessionId,
      requestedUserId: input.userId,
      metadataUserId: metadata.userId,
    });
    return;
  }

  if (input.productId && metadata.productId !== input.productId) {
    logWarn("catalog manual reconciliation aborted: metadata product mismatch", {
      checkoutSessionId: input.checkoutSessionId,
      requestedProductId: input.productId,
      metadataProductId: metadata.productId,
    });
    return;
  }

  await handleCheckoutCompleted(stripeSession);
}

export async function getCheckoutSessionReconciliationState(input: {
  checkoutSessionId: string;
  userId: string;
}): Promise<{
  reconciliationState: CheckoutReconciliationState;
  paymentStatus: PaymentStatus | null;
  orderStatus: OrderStatus | null;
}> {
  const payment = await prisma.payment.findFirst({
    where: {
      provider: PaymentProvider.STRIPE,
      AND: [
        {
          OR: [
            { stripeCheckoutSessionId: input.checkoutSessionId },
            { providerReference: input.checkoutSessionId },
          ],
        },
        {
          OR: [
            { order: { clientId: input.userId } },
            { booking: { clientId: input.userId } },
          ],
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      order: {
        select: { status: true },
      },
    },
  });

  if (!payment) {
    return {
      reconciliationState: "PENDING",
      paymentStatus: null,
      orderStatus: null,
    };
  }

  const paymentStatus = payment.status;
  const orderStatus = payment.order?.status ?? null;

  if (paymentStatus === PaymentStatus.SUCCEEDED && orderStatus === OrderStatus.PAID) {
    return {
      reconciliationState: "CONFIRMED",
      paymentStatus,
      orderStatus,
    };
  }

  if (
    paymentStatus === PaymentStatus.FAILED ||
    orderStatus === OrderStatus.CANCELLED ||
    orderStatus === OrderStatus.REFUNDED
  ) {
    return {
      reconciliationState: "FAILED",
      paymentStatus,
      orderStatus,
    };
  }

  return {
    reconciliationState: "PENDING",
    paymentStatus,
    orderStatus,
  };
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  await markPaymentFailedByCheckoutSession({
    checkoutSessionId: session.id,
    reason: "Checkout session expired.",
    couponStatus: CouponRedemptionStatus.EXPIRED,
  });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const invoiceAny = invoice as unknown as Record<string, unknown>;
  const sub = invoiceAny["subscription"];
  const stripeSubscriptionId =
    typeof sub === "string"
      ? sub
      : sub !== null && typeof sub === "object" && typeof (sub as Record<string, unknown>)["id"] === "string"
        ? (sub as Record<string, unknown>)["id"] as string
        : null;

  if (!stripeSubscriptionId) {
    logWarn("invoice.payment_failed: no subscription id, ignoring", { invoiceId: invoice.id });
    return;
  }

  const contract = await prisma.subscriptionContract.findUnique({
    where: {
      provider_providerSubscriptionReference: {
        provider: PaymentProvider.STRIPE,
        providerSubscriptionReference: stripeSubscriptionId,
      },
    },
    select: { id: true, status: true },
  });

  if (!contract) {
    logWarn("invoice.payment_failed: no local contract found", { stripeSubscriptionId });
    return;
  }

  if (contract.status === SubscriptionStatus.ACTIVE) {
    logInfo("invoice.payment_failed: contract is ACTIVE, not overriding with PAST_DUE (subscription.updated is canonical)", {
      contractId: contract.id,
      stripeSubscriptionId,
    });
    return;
  }

  if (
    contract.status === SubscriptionStatus.CANCELLED ||
    contract.status === SubscriptionStatus.EXPIRED
  ) {
    logInfo("invoice.payment_failed: contract is terminal, ignoring", {
      contractId: contract.id,
      status: contract.status,
    });
    return;
  }

  await prisma.subscriptionContract.update({
    where: { id: contract.id },
    data: { status: SubscriptionStatus.PAST_DUE },
  });

  logInfo("invoice.payment_failed: marked contract PAST_DUE", {
    contractId: contract.id,
    stripeSubscriptionId,
  });
}

export async function processStripeWebhookEvent(event: Stripe.Event) {
  logInfo("event received", {
    eventId: event.id,
    eventType: event.type,
  });

  const lease = await acquireWebhookEventLease(event.id);
  if (lease === "skip") {
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      await handleSubscriptionContractChange(event.data.object as Stripe.Subscription);
    } else if (event.type === "checkout.session.expired") {
      await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
    } else if (event.type === "checkout.session.async_payment_failed") {
      await markPaymentFailedByCheckoutSession({
        checkoutSessionId: (event.data.object as Stripe.Checkout.Session).id,
        reason: "Async payment failed.",
        couponStatus: CouponRedemptionStatus.REVERSED,
      });
    } else if (event.type === "invoice.payment_failed") {
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
    } else {
      logInfo("event ignored", { eventType: event.type });
    }

    await markWebhookEventProcessed(event.id);
  } catch (error) {
    const retry = await recordWebhookProcessingFailure(event, error);
    if (retry.exhausted) {
      await markWebhookEventProcessed(event.id);
      return;
    }
    await markWebhookEventRetryable(event.id);
    throw error;
  }
}

export async function completeStripeCheckoutSessionForE2ETests(input: {
  checkoutSessionId: string;
}): Promise<{ completed: boolean; reason?: string }> {
  if (!isE2ETestModeEnabled()) {
    return { completed: false, reason: "E2E_TEST_MODE_DISABLED" };
  }

  const payment = await prisma.payment.findFirst({
    where: {
      provider: PaymentProvider.STRIPE,
      OR: [
        { stripeCheckoutSessionId: input.checkoutSessionId },
        { providerReference: input.checkoutSessionId },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      providerReference: true,
      stripeCustomerId: true,
      stripeCheckoutMode: true,
      amountMinor: true,
      currencyCode: true,
      booking: {
        select: {
          id: true,
          clientId: true,
          selectedPriceId: true,
          selectedPrice: {
            select: {
              productId: true,
            },
          },
        },
      },
      order: {
        select: {
          clientId: true,
          items: {
            orderBy: { createdAt: "asc" },
            select: {
              productId: true,
              priceId: true,
            },
            take: 1,
          },
        },
      },
    },
  });

  if (!payment) {
    return { completed: false, reason: "CHECKOUT_PAYMENT_NOT_FOUND" };
  }

  const metadata: Record<string, string> = {
    paymentId: payment.id,
  };

  if (payment.booking?.id) {
    metadata.bookingId = payment.booking.id;
  }

  const bookingPriceId = payment.booking?.selectedPriceId ?? null;
  if (bookingPriceId) {
    metadata.selectedPriceId = bookingPriceId;
    metadata.priceId = bookingPriceId;
  }

  if (payment.booking?.clientId) {
    metadata.userId = payment.booking.clientId;
  } else if (payment.order?.clientId) {
    metadata.userId = payment.order.clientId;
  }

  const orderItem = payment.order?.items[0] ?? null;
  const resolvedProductId = payment.booking?.selectedPrice?.productId ?? orderItem?.productId ?? null;
  const resolvedPriceId = bookingPriceId ?? orderItem?.priceId ?? null;
  if (resolvedProductId) {
    metadata.productId = resolvedProductId;
  }
  if (resolvedPriceId) {
    metadata.priceId = resolvedPriceId;
    if (!metadata.selectedPriceId) {
      metadata.selectedPriceId = resolvedPriceId;
    }
  }

  const syntheticSession = {
    id: input.checkoutSessionId,
    mode: payment.stripeCheckoutMode === "SUBSCRIPTION" ? "subscription" : "payment",
    payment_status: "paid",
    metadata,
    payment_intent: payment.providerReference ?? `pi_e2e_${payment.id}`,
    customer: payment.stripeCustomerId ?? "cus_e2e",
    subscription: null,
    amount_total: payment.amountMinor,
    currency: payment.currencyCode.toLowerCase(),
  } as unknown as Stripe.Checkout.Session;

  try {
    await handleCheckoutCompleted(syntheticSession);
    return { completed: true };
  } catch (error) {
    return {
      completed: false,
      reason: error instanceof Error ? error.message : "CHECKOUT_COMPLETION_FAILED",
    };
  }
}
