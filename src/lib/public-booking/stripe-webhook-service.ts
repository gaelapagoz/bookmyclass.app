import {
  BookingPaymentSelection,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  PaymentStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../db";

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
  selectedPriceId: string;
}) {
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
    return;
  }

  if (booking.selectedEntitlementId) {
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
    return;
  }

  const activatedAt = new Date();
  const expiresAt =
    typeof rule.validForDays === "number"
      ? new Date(activatedAt.getTime() + rule.validForDays * 24 * 60 * 60 * 1000)
      : null;

  const entitlement = await prisma.clientEntitlement.create({
    data: {
      clientId: input.clientId,
      productId: price.productId,
      entitlementType: rule.entitlementType,
      entitlementScope: rule.entitlementScope,
      status: ClientEntitlementStatus.ACTIVE,
      activatedAt,
      expiresAt,
      notes: "Activated via Stripe checkout webhook.",
    },
    select: { id: true },
  });

  if (typeof rule.quantity === "number" && rule.quantity > 0) {
    await prisma.creditLedgerEntry.create({
      data: {
        clientId: input.clientId,
        entitlementId: entitlement.id,
        bookingId: input.bookingId,
        entryType: CreditLedgerEntryType.GRANT,
        amount: rule.quantity,
        notes: "Credits granted from Stripe plan purchase.",
      },
    });
  }

  await prisma.booking.update({
    where: { id: input.bookingId },
    data: { selectedEntitlementId: entitlement.id },
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const paymentIdFromMetadata = getStringMetadataValue(session.metadata, "paymentId");
  const bookingIdFromMetadata = getStringMetadataValue(session.metadata, "bookingId");
  const selectedPriceIdFromMetadata = getStringMetadataValue(session.metadata, "selectedPriceId");

  const payment = paymentIdFromMetadata
    ? await prisma.payment.findUnique({
        where: { id: paymentIdFromMetadata },
        select: {
          id: true,
          status: true,
          bookingId: true,
          booking: {
            select: {
              id: true,
              status: true,
              paymentSelection: true,
              clientId: true,
            },
          },
        },
      })
    : await prisma.payment.findFirst({
        where: { providerReference: session.id },
        select: {
          id: true,
          status: true,
          bookingId: true,
          booking: {
            select: {
              id: true,
              status: true,
              paymentSelection: true,
              clientId: true,
            },
          },
        },
      });

  if (!payment) {
    return;
  }

  if (payment.status !== PaymentStatus.SUCCEEDED) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCEEDED,
        capturedAt: new Date(),
      },
    });
  }

  const bookingId = payment.bookingId ?? bookingIdFromMetadata;
  if (!bookingId) {
    return;
  }

  const booking = payment.booking;
  if (!booking) {
    return;
  }

  if (booking.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE) {
    if (!booking.clientId || !selectedPriceIdFromMetadata) {
      return;
    }

    await ensureEntitlementForPlanPurchase({
      bookingId: booking.id,
      clientId: booking.clientId,
      selectedPriceId: selectedPriceIdFromMetadata,
    });
  }

  if (booking.status !== BookingStatus.CONFIRMED) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.CONFIRMED },
    });
  }
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const payment = await prisma.payment.findFirst({
    where: { providerReference: session.id },
    select: { id: true, status: true },
  });

  if (!payment || payment.status !== PaymentStatus.PENDING) {
    return;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: PaymentStatus.FAILED,
      failedAt: new Date(),
      failureReason: "Checkout session expired.",
    },
  });
}

export async function processStripeWebhookEvent(event: Stripe.Event) {
  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    return;
  }

  if (event.type === "checkout.session.expired") {
    await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
  }
}
