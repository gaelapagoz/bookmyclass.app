import {
  BookingPaymentSelection,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementType,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../db";
import { getStripeClient } from "../payments/stripe";

function logInfo(message: string, context?: Record<string, unknown>) {
  console.info("[stripe/webhook]", message, context ?? {});
}

function logWarn(message: string, context?: Record<string, unknown>) {
  console.warn("[stripe/webhook]", message, context ?? {});
}

function logError(message: string, context?: Record<string, unknown>) {
  console.error("[stripe/webhook]", message, context ?? {});
}

function getStringMetadataValue(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function ensureEntitlementForPlanPurchase(input: {
  bookingId: string;
  clientId: string;
  orderId: string | null;
  selectedPriceId: string;
}) {
  logInfo("ensure entitlement start", {
    bookingId: input.bookingId,
    clientId: input.clientId,
    orderId: input.orderId,
    selectedPriceId: input.selectedPriceId,
  });

  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      selectedEntitlementId: true,
      selectedPriceId: true,
      studioSession: {
        select: {
          classType: {
            select: {
              category: {
                select: { slug: true },
              },
            },
          },
        },
      },
    },
  });

  if (!booking || booking.selectedPriceId !== input.selectedPriceId) {
    logWarn("ensure entitlement skipped: booking missing or selected price mismatch", {
      bookingId: input.bookingId,
      selectedPriceId: input.selectedPriceId,
    });
    return;
  }

  if (booking.selectedEntitlementId) {
    logInfo("ensure entitlement skipped: booking already has entitlement", {
      bookingId: input.bookingId,
      selectedEntitlementId: booking.selectedEntitlementId,
    });
    return;
  }

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
              id: true,
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
    logWarn("ensure entitlement skipped: no eligible entitlement rule for selected price", {
      bookingId: input.bookingId,
      selectedPriceId: input.selectedPriceId,
    });
    return;
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
  logInfo("entitlement ensured", {
    bookingId: input.bookingId,
    entitlementId: entitlement.id,
    orderId: input.orderId,
  });

  if (typeof rule.quantity === "number" && rule.quantity > 0) {
    const grantExists = await prisma.creditLedgerEntry.findFirst({
      where: {
        clientId: input.clientId,
        entitlementId: entitlement.id,
        bookingId: input.bookingId,
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
          bookingId: input.bookingId,
          entryType: CreditLedgerEntryType.GRANT,
          amount: rule.quantity,
          notes: "Credits granted from successful Stripe plan purchase.",
        },
      });
      logInfo("credit grant created", {
        bookingId: input.bookingId,
        entitlementId: entitlement.id,
        amount: rule.quantity,
      });
    }
  }

  if (
    rule.entitlementType === EntitlementType.CREDIT_PACK ||
    rule.entitlementType === EntitlementType.SINGLE_USE
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
          notes: "Credit consumed for booking confirmed by Stripe plan purchase.",
        },
      });
      logInfo("credit consume created", {
        bookingId: input.bookingId,
        entitlementId: entitlement.id,
      });
    } else {
      logInfo("credit consume already present", {
        bookingId: input.bookingId,
        entitlementId: entitlement.id,
      });
    }
  }

  await prisma.booking.update({
    where: { id: input.bookingId },
    data: { selectedEntitlementId: entitlement.id },
  });
  logInfo("booking linked to entitlement", {
    bookingId: input.bookingId,
    entitlementId: entitlement.id,
  });
}

async function markPaymentFailedByCheckoutSession(input: {
  checkoutSessionId: string;
  reason: string;
}) {
  logInfo("mark payment failed", {
    checkoutSessionId: input.checkoutSessionId,
    reason: input.reason,
  });
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
  logInfo("payment marked failed", {
    paymentId: payment.id,
    orderId: payment.orderId,
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  logInfo("checkout.session.completed received", {
    checkoutSessionId: session.id,
    paymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null,
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
  const selectedPriceIdFromMetadata = getStringMetadataValue(session.metadata, "selectedPriceId");
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

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

  if (!payment) {
    logWarn("no local payment matched checkout completion", {
      checkoutSessionId: session.id,
      paymentIdFromMetadata,
      paymentIntentId,
      bookingIdFromMetadata,
    });
    return;
  }
  logInfo("matched local payment", {
    paymentId: payment.id,
    orderId: payment.orderId,
    bookingId: payment.bookingId,
    status: payment.status,
  });

  const bookingId = payment.bookingId ?? bookingIdFromMetadata;
  if (!bookingId) {
    logWarn("matched payment but no booking id", {
      paymentId: payment.id,
      paymentBookingId: payment.bookingId,
      bookingIdFromMetadata,
    });
    return;
  }

  const booking = payment.booking;
  if (!booking) {
    logWarn("matched payment but booking relation missing", {
      paymentId: payment.id,
      bookingId,
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (payment.status !== PaymentStatus.SUCCEEDED) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          capturedAt: new Date(),
          orderId: payment.orderId ?? booking.orderId ?? null,
        },
      });
    }

    const orderId = payment.orderId ?? booking.orderId;
    if (orderId) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PAID },
      });
    }
  });
  logInfo("payment and order finalized", {
    paymentId: payment.id,
    orderId: payment.orderId ?? booking.orderId ?? null,
    bookingId: booking.id,
    bookingPaymentSelection: booking.paymentSelection,
  });

  if (booking.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE) {
    if (!booking.clientId || !selectedPriceIdFromMetadata) {
      return;
    }

    await ensureEntitlementForPlanPurchase({
      bookingId: booking.id,
      clientId: booking.clientId,
      orderId: payment.orderId ?? booking.orderId ?? null,
      selectedPriceId: selectedPriceIdFromMetadata,
    });
  }

  if (booking.status !== BookingStatus.CONFIRMED) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.CONFIRMED },
    });
    logInfo("booking confirmed", {
      bookingId: booking.id,
    });
  }
}

export async function reconcileCheckoutSessionAfterReturn(input: {
  checkoutSessionId: string;
  bookingId: string;
  userId: string;
}) {
  logInfo("manual reconciliation requested", {
    checkoutSessionId: input.checkoutSessionId,
    bookingId: input.bookingId,
    userId: input.userId,
  });

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
    logWarn("manual reconciliation aborted: booking not found for user", {
      checkoutSessionId: input.checkoutSessionId,
      bookingId: input.bookingId,
      userId: input.userId,
    });
    return;
  }

  const payment = booking.payments[0] ?? null;
  if (!payment) {
    logWarn("manual reconciliation aborted: no payment matched checkout session id", {
      checkoutSessionId: input.checkoutSessionId,
      bookingId: input.bookingId,
    });
    return;
  }

  if (booking.status === BookingStatus.CONFIRMED && payment.status === PaymentStatus.SUCCEEDED) {
    logInfo("manual reconciliation skipped: already finalized", {
      checkoutSessionId: input.checkoutSessionId,
      bookingId: input.bookingId,
      paymentId: payment.id,
    });
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
  logInfo("manual reconciliation completed", {
    checkoutSessionId: input.checkoutSessionId,
    bookingId: input.bookingId,
  });
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  logInfo("checkout.session.expired received", {
    checkoutSessionId: session.id,
  });
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

  if (event.type === "checkout.session.expired") {
    await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
    return;
  }

  if (event.type === "checkout.session.async_payment_failed") {
    logInfo("checkout.session.async_payment_failed received", {
      checkoutSessionId: (event.data.object as Stripe.Checkout.Session).id,
    });
    await markPaymentFailedByCheckoutSession({
      checkoutSessionId: (event.data.object as Stripe.Checkout.Session).id,
      reason: "Async payment failed.",
    });
    return;
  }

  logInfo("event ignored", { eventType: event.type });
}
