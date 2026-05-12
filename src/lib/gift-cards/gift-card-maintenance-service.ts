import { GiftCardRedemptionStatus, OrderStatus, PaymentMethod, PaymentProvider, PaymentStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { GiftCardError, giftCardErrorCodes } from "./gift-card-errors";
import { emitGiftCardAlertEvent } from "./gift-card-events";
import { releaseGiftCardRedemption } from "./gift-card-wallet-service";

export const GIFT_CARD_MAINTENANCE_BATCH_SIZE = 100;

const maintenanceActor = { type: "SYSTEM" as const, label: "gift-card-maintenance" };

type CleanupExpiredGiftCardReservationsInput = {
  readonly now?: Date;
  readonly batchSize?: number;
};

export type CleanupExpiredGiftCardReservationsResult = {
  readonly scannedCount: number;
  readonly releasedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly paymentFailedCount: number;
  readonly orderCancelledCount: number;
};

function resolveBatchSize(batchSize: number | undefined): number {
  if (batchSize === undefined) {
    return GIFT_CARD_MAINTENANCE_BATCH_SIZE;
  }

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    return GIFT_CARD_MAINTENANCE_BATCH_SIZE;
  }

  return Math.min(batchSize, GIFT_CARD_MAINTENANCE_BATCH_SIZE);
}

async function markExpiredReservationSideEffects(input: {
  readonly orderId: string;
  readonly redemptionId: string;
  readonly now: Date;
}): Promise<{ paymentFailedCount: number; orderCancelledCount: number }> {
  const paymentUpdate = await prisma.payment.updateMany({
    where: {
      orderId: input.orderId,
      method: PaymentMethod.GIFT_CARD,
      provider: PaymentProvider.INTERNAL,
      status: PaymentStatus.PENDING,
    },
    data: {
      status: PaymentStatus.FAILED,
      failedAt: input.now,
      failureReason: "GIFT_CARD_RESERVATION_EXPIRED",
    },
  });

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: { notes: true },
  });
  const expirationNote = `GIFT_CARD_RESERVATION_EXPIRED:${input.redemptionId}`;
  const nextNotes = order?.notes ? `${order.notes}\n${expirationNote}` : expirationNote;
  const orderUpdate = order
    ? await prisma.order.updateMany({
        where: {
          id: input.orderId,
          status: { in: [OrderStatus.DRAFT, OrderStatus.PLACED] },
        },
        data: {
          status: OrderStatus.CANCELLED,
          notes: nextNotes,
        },
      })
    : { count: 0 };

  return {
    paymentFailedCount: paymentUpdate.count,
    orderCancelledCount: orderUpdate.count,
  };
}

async function isReservationAlreadyCompleted(redemptionId: string): Promise<boolean> {
  const redemption = await prisma.giftCardRedemption.findUnique({
    where: { id: redemptionId },
    select: { status: true },
  });

  return redemption?.status === GiftCardRedemptionStatus.CAPTURED || redemption?.status === GiftCardRedemptionStatus.RELEASED;
}

export async function cleanupExpiredGiftCardReservations(
  input: CleanupExpiredGiftCardReservationsInput = {},
): Promise<CleanupExpiredGiftCardReservationsResult> {
  const now = input.now ?? new Date();
  const batchSize = resolveBatchSize(input.batchSize);
  const expiredReservations = await prisma.giftCardRedemption.findMany({
    where: {
      status: GiftCardRedemptionStatus.RESERVED,
      expiresAt: { lte: now },
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    take: batchSize,
    select: {
      id: true,
      orderId: true,
      clientId: true,
      walletId: true,
    },
  });

  let releasedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let paymentFailedCount = 0;
  let orderCancelledCount = 0;

  for (const reservation of expiredReservations) {
    try {
      const release = await releaseGiftCardRedemption({
        actor: maintenanceActor,
        redemptionId: reservation.id,
        idempotencyKey: `gift-card:release:redemption:${reservation.id}`,
        metadata: { source: "gift-card-maintenance" },
      });

      const sideEffects = await markExpiredReservationSideEffects({
        orderId: release.redemption.orderId,
        redemptionId: release.redemption.id,
        now,
      });
      releasedCount += release.idempotent ? 0 : 1;
      paymentFailedCount += sideEffects.paymentFailedCount;
      orderCancelledCount += sideEffects.orderCancelledCount;
    } catch (error) {
      if (
        error instanceof GiftCardError &&
        error.code === giftCardErrorCodes.invalidTransition &&
        await isReservationAlreadyCompleted(reservation.id)
      ) {
        skippedCount += 1;
        continue;
      }

      failedCount += 1;
      await emitGiftCardAlertEvent({
        eventName: "gift_card.reservation_cleanup_failed",
        entityType: "GiftCardRedemption",
        entityId: reservation.id,
        metadata: {
          clientId: reservation.clientId,
          orderId: reservation.orderId,
          walletId: reservation.walletId,
        },
        error,
      });
    }
  }

  return {
    scannedCount: expiredReservations.length,
    releasedCount,
    skippedCount,
    failedCount,
    paymentFailedCount,
    orderCancelledCount,
  };
}
