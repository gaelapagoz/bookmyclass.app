import {
  BookingPaymentSelection,
  OrderStatus,
  PaymentStatus,
  Prisma,
} from "@prisma/client";

import { settleCouponRedemptionForCartCheckout } from "@/lib/coupons/coupon-validation-service";
import { prisma } from "@/lib/db";
import { fulfillPaidCartOrder } from "@/lib/fulfillment/order-fulfillment-service";
import type { GiftCardActor } from "@/lib/gift-cards/gift-card-types";
import { captureGiftCardRedemption } from "@/lib/gift-cards/gift-card-wallet-service";
import { transitionBookingToConfirmedAndQueueEmail } from "@/lib/public-booking/booking-confirmation-transition-service";
import { ensureCartOrderOwnershipFromPersistedItems } from "@/lib/public-booking/checkout-ownership-service";

type DbClient = Prisma.TransactionClient | typeof prisma;

export class CouponSettlementAfterPaymentError extends Error {
  constructor(message: string, readonly cause: unknown) {
    super(message);
    this.name = "CouponSettlementAfterPaymentError";
  }
}

export async function settleSuccessfulCheckoutOrder(input: {
  orderId: string;
  paymentId?: string | null;
  stripeCheckoutSessionId?: string | null;
  internalPaymentIds?: Array<string | null | undefined>;
  giftCardCapture?:
    | {
        actor: GiftCardActor;
        redemptionId: string;
        paymentId: string;
        idempotencyKey: string;
        metadata?: Record<string, string>;
      }
    | undefined;
  tx?: DbClient;
}) {
  if (input.giftCardCapture) {
    await captureGiftCardRedemption({
      actor: input.giftCardCapture.actor,
      redemptionId: input.giftCardCapture.redemptionId,
      paymentId: input.giftCardCapture.paymentId,
      idempotencyKey: input.giftCardCapture.idempotencyKey,
      metadata: input.giftCardCapture.metadata,
    });
  }

  const db = input.tx ?? prisma;
  const internalPaymentIds = Array.from(
    new Set((input.internalPaymentIds ?? []).filter((paymentId): paymentId is string => Boolean(paymentId))),
  );

  await db.$transaction(async (tx) => {
    const capturedAt = new Date();

    if (internalPaymentIds.length > 0) {
      await tx.payment.updateMany({
        where: {
          id: { in: internalPaymentIds },
        },
        data: {
          status: PaymentStatus.SUCCEEDED,
          capturedAt,
        },
      });
    }

    await tx.order.update({
      where: { id: input.orderId },
      data: { status: OrderStatus.PAID },
    });

    try {
      await settleCouponRedemptionForCartCheckout({
        tx,
        orderId: input.orderId,
        paymentId: input.paymentId,
        stripeCheckoutSessionId: input.stripeCheckoutSessionId,
        nextStatus: "APPLIED",
      });
    } catch (error) {
      throw new CouponSettlementAfterPaymentError(
        "Coupon settlement failed after payment success.",
        error,
      );
    }
  });
}

export async function finalizeCartOrderCompletion(input: {
  orderId: string;
  clientId: string;
  giftCardPaymentId?: string | null;
  booking:
    | {
        id: string;
        paymentSelection: BookingPaymentSelection | null;
        selectedPriceId: string | null;
      }
    | null;
}) {
  if (input.booking) {
    await ensureCartOrderOwnershipFromPersistedItems({
      orderId: input.orderId,
      clientId: input.clientId,
      booking: input.booking,
    });
    await prisma.booking.update({
      where: { id: input.booking.id },
      data: { orderId: input.orderId },
    });
    await transitionBookingToConfirmedAndQueueEmail({ bookingId: input.booking.id });
    return;
  }

  await fulfillPaidCartOrder({
    orderId: input.orderId,
    clientId: input.clientId,
    giftCardPaymentId: input.giftCardPaymentId ?? undefined,
  });
}
