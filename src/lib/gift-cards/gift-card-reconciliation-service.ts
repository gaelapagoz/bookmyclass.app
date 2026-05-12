import {
  GiftCardReconciliationStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { emitGiftCardAlertEvent } from "./gift-card-events";

export const GIFT_CARD_RECONCILIATION_RETRY_MAX = 3;

type ReconciliationCaseInput = {
  readonly orderId: string;
  readonly clientId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly walletId?: string | null;
  readonly redemptionId?: string | null;
  readonly paymentId?: string | null;
  readonly metadata?: Prisma.InputJsonObject;
};

export async function openGiftCardReconciliationCase(
  input: ReconciliationCaseInput,
): Promise<void> {
  await prisma.giftCardReconciliationCase.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      orderId: input.orderId,
      clientId: input.clientId,
      walletId: input.walletId ?? null,
      redemptionId: input.redemptionId ?? null,
      paymentId: input.paymentId ?? null,
      status: GiftCardReconciliationStatus.OPEN,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? {},
    },
    update: {
      status: GiftCardReconciliationStatus.OPEN,
      metadata: input.metadata ?? {},
    },
  });

  await emitGiftCardAlertEvent({
    eventName: "gift_card.reconciliation_required",
    entityType: "GiftCardReconciliationCase",
    entityId: input.idempotencyKey,
    metadata: {
      orderId: input.orderId,
      clientId: input.clientId,
      reason: input.reason,
      ...(input.metadata ?? {}),
    },
  });
}

export async function createGiftCardManualReviewCase(
  input: ReconciliationCaseInput,
): Promise<void> {
  await prisma.giftCardReconciliationCase.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      orderId: input.orderId,
      clientId: input.clientId,
      walletId: input.walletId ?? null,
      redemptionId: input.redemptionId ?? null,
      paymentId: input.paymentId ?? null,
      status: GiftCardReconciliationStatus.MANUAL_REVIEW,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? {},
    },
    update: {
      status: GiftCardReconciliationStatus.MANUAL_REVIEW,
      metadata: input.metadata ?? {},
    },
  });

  await emitGiftCardAlertEvent({
    eventName: "gift_card.reconciliation_manual_review",
    entityType: "GiftCardReconciliationCase",
    entityId: input.idempotencyKey,
    metadata: {
      orderId: input.orderId,
      clientId: input.clientId,
      reason: input.reason,
      ...(input.metadata ?? {}),
    },
  });
}

export async function recordGiftCardWebhookRetry(input: {
  readonly orderId: string;
  readonly clientId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly paymentId?: string | null;
  readonly redemptionId?: string | null;
  readonly walletId?: string | null;
  readonly metadata?: Prisma.InputJsonObject;
  readonly error?: unknown;
}): Promise<{ exhausted: boolean; retryCount: number }> {
  const now = new Date();
  const existing = await prisma.giftCardReconciliationCase.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { retryCount: true },
  });
  const retryCount = (existing?.retryCount ?? 0) + 1;
  const exhausted = retryCount > GIFT_CARD_RECONCILIATION_RETRY_MAX;
  const status = exhausted
    ? GiftCardReconciliationStatus.MANUAL_REVIEW
    : GiftCardReconciliationStatus.RETRYING;

  await prisma.giftCardReconciliationCase.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      orderId: input.orderId,
      clientId: input.clientId,
      walletId: input.walletId ?? null,
      redemptionId: input.redemptionId ?? null,
      paymentId: input.paymentId ?? null,
      status,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      retryCount,
      lastRetryAt: now,
      metadata: {
        retryCount,
        ...(input.metadata ?? {}),
      },
    },
    update: {
      status,
      retryCount,
      lastRetryAt: now,
      metadata: {
        retryCount,
        ...(input.metadata ?? {}),
      },
    },
  });

  if (retryCount === 1) {
    await emitGiftCardAlertEvent({
      eventName: "gift_card.reconciliation_required",
      entityType: "GiftCardReconciliationCase",
      entityId: input.idempotencyKey,
      metadata: {
        orderId: input.orderId,
        clientId: input.clientId,
        reason: input.reason,
        retryCount,
        ...(input.metadata ?? {}),
      },
      error: input.error,
    });
  }

  if (exhausted) {
    await emitGiftCardAlertEvent({
      eventName: "gift_card.reconciliation_manual_review",
      entityType: "GiftCardReconciliationCase",
      entityId: input.idempotencyKey,
      metadata: {
        orderId: input.orderId,
        clientId: input.clientId,
        reason: input.reason,
        retryCount,
        ...(input.metadata ?? {}),
      },
      error: input.error,
    });
  }

  return { exhausted, retryCount };
}
