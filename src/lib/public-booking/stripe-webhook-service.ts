import {
  BookingPaymentSelection,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementType,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  SubscriptionStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../db";
import { getStripeClient } from "../payments/stripe";

type CatalogCheckoutMetadata = {
  userId: string;
  productId: string;
  priceId: string;
};

function logInfo(message: string, context?: Record<string, unknown>) {
  console.info("[stripe/webhook]", message, context ?? {});
}

function logWarn(message: string, context?: Record<string, unknown>) {
  console.warn("[stripe/webhook]", message, context ?? {});
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

async function grantEntitlementForSuccessfulPricePurchase(input: {
  clientId: string;
  orderId: string | null;
  selectedPriceId: string;
  bookingId?: string | null;
  consumeCreditForBooking: boolean;
}) {
  const price = await prisma.price.findUnique({
    where: { id: input.selectedPriceId },
    select: {
      productId: true,
      product: {
        select: {
          entitlementRules: {
            where: { isActive: true },
            orderBy: { updatedAt: "desc" },
            select: {
              entitlementType: true,
              entitlementScope: true,
              quantity: true,
              validForDays: true,
            },
            take: 1,
          },
        },
      },
    },
  });

  const rule = price?.product.entitlementRules[0];
  if (!price || !rule) {
    return null;
  }

  const activatedAt = new Date();
  const expiresAt =
    typeof rule.validForDays === "number"
      ? new Date(activatedAt.getTime() + rule.validForDays * 24 * 60 * 60 * 1000)
      : null;

  const existingEntitlement = input.orderId
    ? await prisma.clientEntitlement.findFirst({
        where: {
          clientId: input.clientId,
          orderId: input.orderId,
          productId: price.productId,
          status: ClientEntitlementStatus.ACTIVE,
        },
        select: { id: true },
      })
    : null;

  const entitlement =
    existingEntitlement ??
    (await prisma.clientEntitlement.create({
      data: {
        clientId: input.clientId,
        productId: price.productId,
        orderId: input.orderId,
        entitlementType: rule.entitlementType,
        entitlementScope: rule.entitlementScope,
        status: ClientEntitlementStatus.ACTIVE,
        activatedAt,
        expiresAt,
        notes: "Activated via Stripe checkout finalization.",
      },
      select: { id: true },
    }));

  if (typeof rule.quantity === "number" && rule.quantity > 0) {
    const grantExists = await prisma.creditLedgerEntry.findFirst({
      where: {
        clientId: input.clientId,
        entitlementId: entitlement.id,
        orderId: input.orderId,
        bookingId: input.bookingId ?? null,
        entryType: CreditLedgerEntryType.GRANT,
      },
      select: { id: true },
    });
    if (!grantExists) {
      await prisma.creditLedgerEntry.create({
        data: {
          clientId: input.clientId,
          entitlementId: entitlement.id,
          orderId: input.orderId,
          bookingId: input.bookingId ?? null,
          entryType: CreditLedgerEntryType.GRANT,
          amount: rule.quantity,
          notes: "Credits granted from successful Stripe product purchase.",
        },
      });
    }
  }

  if (
    input.consumeCreditForBooking &&
    input.bookingId &&
    (rule.entitlementType === EntitlementType.CREDIT_PACK ||
      rule.entitlementType === EntitlementType.SINGLE_USE)
  ) {
    const consumeExists = await prisma.creditLedgerEntry.findFirst({
      where: {
        clientId: input.clientId,
        entitlementId: entitlement.id,
        bookingId: input.bookingId,
        entryType: CreditLedgerEntryType.CONSUME,
      },
      select: { id: true },
    });

    if (!consumeExists) {
      await prisma.creditLedgerEntry.create({
        data: {
          clientId: input.clientId,
          entitlementId: entitlement.id,
          bookingId: input.bookingId,
          entryType: CreditLedgerEntryType.CONSUME,
          amount: -1,
          notes: "Credit consumed for booking confirmed by Stripe purchase.",
        },
      });
    }
  }

  if (input.bookingId) {
    await prisma.booking.update({
      where: { id: input.bookingId },
      data: { selectedEntitlementId: entitlement.id },
    });
  }

  return entitlement.id;
}

async function ensureEntitlementForPlanPurchase(input: {
  bookingId: string;
  clientId: string;
  orderId: string | null;
  selectedPriceId: string;
}) {
  logInfo("ensure booking entitlement start", input);

  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      selectedEntitlementId: true,
      selectedPriceId: true,
    },
  });

  if (!booking || booking.selectedPriceId !== input.selectedPriceId) {
    logWarn("ensure booking entitlement skipped: booking missing or selected price mismatch", {
      bookingId: input.bookingId,
      selectedPriceId: input.selectedPriceId,
    });
    return;
  }

  if (booking.selectedEntitlementId) {
    logInfo("ensure booking entitlement skipped: booking already linked", {
      bookingId: input.bookingId,
      selectedEntitlementId: booking.selectedEntitlementId,
    });
    return;
  }

  const entitlementId = await grantEntitlementForSuccessfulPricePurchase({
    bookingId: input.bookingId,
    clientId: input.clientId,
    orderId: input.orderId,
    selectedPriceId: input.selectedPriceId,
    consumeCreditForBooking: true,
  });

  if (entitlementId) {
    logInfo("booking entitlement ensured", {
      bookingId: input.bookingId,
      entitlementId,
    });
  }
}

async function ensureEntitlementForCatalogPurchase(input: {
  clientId: string;
  orderId: string | null;
  selectedPriceId: string;
}) {
  const entitlementId = await grantEntitlementForSuccessfulPricePurchase({
    clientId: input.clientId,
    orderId: input.orderId,
    selectedPriceId: input.selectedPriceId,
    consumeCreditForBooking: false,
  });

  if (entitlementId) {
    logInfo("catalog entitlement ensured", {
      clientId: input.clientId,
      orderId: input.orderId,
      selectedPriceId: input.selectedPriceId,
      entitlementId,
    });
  }
}

async function upsertSubscriptionContract(input: {
  stripeSubscription: Stripe.Subscription;
  metadata: CatalogCheckoutMetadata | null;
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

  const resolvedUserId = metadata?.userId ?? existingContract?.clientId ?? null;
  if (!resolvedUserId) {
    return;
  }

  const currentPeriodStart = fromUnixSeconds(stripeSubscription.current_period_start, new Date());
  const currentPeriodEnd = fromUnixSeconds(stripeSubscription.current_period_end, currentPeriodStart);
  const startsAt = fromUnixSeconds(stripeSubscription.start_date, currentPeriodStart);
  const cancelledAt = stripeSubscription.canceled_at
    ? fromUnixSeconds(stripeSubscription.canceled_at, currentPeriodEnd)
    : null;
  const endedAt = stripeSubscription.ended_at
    ? fromUnixSeconds(stripeSubscription.ended_at, currentPeriodEnd)
    : null;

  await prisma.subscriptionContract.upsert({
    where: {
      provider_providerSubscriptionReference: {
        provider: PaymentProvider.STRIPE,
        providerSubscriptionReference: stripeSubscriptionId,
      },
    },
    update: {
      status: mapStripeSubscriptionStatus(stripeSubscription.status),
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
      status: mapStripeSubscriptionStatus(stripeSubscription.status),
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
        booking: {
          select: {
            id: true,
            status: true,
            paymentSelection: true,
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
}) {
  logInfo("mark payment failed", input);
  const payment = await prisma.payment.findFirst({
    where: { providerReference: input.checkoutSessionId, provider: PaymentProvider.STRIPE },
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
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: OrderStatus.CANCELLED },
      });
    }
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  logInfo("checkout.session.completed received", {
    checkoutSessionId: session.id,
    paymentStatus: session.payment_status,
  });

  if (session.payment_status !== "paid") {
    await markPaymentFailedByCheckoutSession({
      checkoutSessionId: session.id,
      reason: "Checkout completed without successful payment status.",
    });
    return;
  }

  const paymentIdFromMetadata = getStringMetadataValue(session.metadata, "paymentId");
  const bookingIdFromMetadata = getStringMetadataValue(session.metadata, "bookingId");
  const selectedPriceIdFromMetadata =
    getStringMetadataValue(session.metadata, "selectedPriceId") ??
    getStringMetadataValue(session.metadata, "priceId");
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
          booking: {
            select: {
              id: true,
              status: true,
              paymentSelection: true,
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
          booking: {
            select: {
              id: true,
              status: true,
              paymentSelection: true,
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
        booking: {
          select: {
            id: true,
            status: true,
            paymentSelection: true,
            clientId: true,
            orderId: true,
          },
        },
      },
    });
  }

  if (!payment && catalogMetadata) {
    payment = await ensureCatalogPaymentForCompletedSession({
      session,
      metadata: catalogMetadata,
    });
  }

  if (!payment) {
    logWarn("no local payment matched checkout completion", {
      checkoutSessionId: session.id,
      paymentIdFromMetadata,
      paymentIntentId,
      bookingIdFromMetadata,
    });
    return;
  }

  const booking = payment.booking;
  const orderId = payment.orderId ?? booking?.orderId ?? null;

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
        },
      });
    } else if (stripeCustomerId) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          stripeCustomerId,
          stripeCheckoutSessionId: session.id,
        },
      });
    }

    if (orderId) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PAID },
      });
    }
  });

  if (booking && booking.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE) {
    if (booking.clientId && selectedPriceIdFromMetadata) {
      await ensureEntitlementForPlanPurchase({
        bookingId: booking.id,
        clientId: booking.clientId,
        orderId,
        selectedPriceId: selectedPriceIdFromMetadata,
      });
    }
  } else if (catalogMetadata && selectedPriceIdFromMetadata) {
    await ensureEntitlementForCatalogPurchase({
      clientId: catalogMetadata.userId,
      orderId,
      selectedPriceId: selectedPriceIdFromMetadata,
    });
  }

  if (session.mode === "subscription") {
    const stripeSubscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
    if (stripeSubscriptionId) {
      const stripeSubscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
      await upsertSubscriptionContract({
        stripeSubscription,
        metadata: catalogMetadata,
      });
    }
  }

  if (booking && booking.status !== BookingStatus.CONFIRMED) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.CONFIRMED },
    });
  }
}

async function handleSubscriptionContractChange(stripeSubscription: Stripe.Subscription) {
  const metadata = parseCatalogCheckoutMetadata(stripeSubscription.metadata);
  await upsertSubscriptionContract({
    stripeSubscription,
    metadata,
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
          providerReference: input.checkoutSessionId,
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

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  await markPaymentFailedByCheckoutSession({
    checkoutSessionId: session.id,
    reason: "Checkout session expired.",
  });
}

export async function processStripeWebhookEvent(event: Stripe.Event) {
  logInfo("event received", {
    eventId: event.id,
    eventType: event.type,
  });

  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    return;
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    await handleSubscriptionContractChange(event.data.object as Stripe.Subscription);
    return;
  }

  if (event.type === "checkout.session.expired") {
    await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
    return;
  }

  if (event.type === "checkout.session.async_payment_failed") {
    await markPaymentFailedByCheckoutSession({
      checkoutSessionId: (event.data.object as Stripe.Checkout.Session).id,
      reason: "Async payment failed.",
    });
    return;
  }

  logInfo("event ignored", { eventType: event.type });
}
