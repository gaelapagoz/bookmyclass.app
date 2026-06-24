import {
  LoyaltyCreditReservationStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { ensureExpectedAutomationTemplateExists } from "@/lib/email/email-automation-admin-service";
import { enqueueEmailAutomationEvent } from "@/lib/email/email-automation-outbox-service";
import { resolveAppUrl } from "@/lib/config/app-url";
import { expireLoyaltyPointsEntry } from "./loyalty-points-service";
import { releaseLoyaltyCreditReservation } from "./loyalty-redemption-service";

const LOYALTY_EXPIRATION_REMINDER_TEMPLATE_KEY = "loyalty.points-expiring";
const LOYALTY_MAINTENANCE_BATCH_SIZE = 100;

const maintenanceActor = { type: "SYSTEM" as const, label: "loyalty-maintenance" };

type LoyaltyMaintenanceInput = {
  readonly now?: Date;
  readonly batchSize?: number;
};

export type LoyaltyExpirationMaintenanceResult = {
  readonly scannedCount: number;
  readonly createdCount: number;
  readonly replayedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
};

export type LoyaltyReminderMaintenanceResult = {
  readonly scannedCount: number;
  readonly enqueuedCount: number;
  readonly failedCount: number;
};

export type LoyaltyCreditReservationMaintenanceResult = {
  readonly scannedCount: number;
  readonly releasedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly paymentFailedCount: number;
  readonly orderCancelledCount: number;
};

function resolveBatchSize(batchSize: number | undefined): number {
  if (!Number.isInteger(batchSize) || !batchSize || batchSize <= 0) {
    return LOYALTY_MAINTENANCE_BATCH_SIZE;
  }

  return Math.min(batchSize, LOYALTY_MAINTENANCE_BATCH_SIZE);
}

function startOfUtcDay(value: Date): Date {
  const next = new Date(value);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function endOfUtcDay(value: Date): Date {
  const next = new Date(value);
  next.setUTCHours(23, 59, 59, 999);
  return next;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toEffectiveDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function buildExpirationIdempotencyKey(sourceEntryId: string, effectiveDateKey: string) {
  return `loyalty:expire:entry:${sourceEntryId}:${effectiveDateKey}:maintenance-v1`;
}

function buildReminderIdempotencyKey(sourceEntryId: string, effectiveDateKey: string) {
  return `loyalty:reminder:entry:${sourceEntryId}:${effectiveDateKey}:maintenance-v1`;
}

type PositiveLoyaltySource = {
  id: string;
  clientId: string;
  currencyCode: string;
  amountPoints: number;
  expiresAt: Date | null;
  client: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    name: string;
  };
  derivedEntries: Array<{ amountPoints: number }>;
};

function getRemainingPoints(source: PositiveLoyaltySource) {
  return source.amountPoints
    + source.derivedEntries.reduce((total, entry) => total + Math.min(entry.amountPoints, 0), 0);
}

function resolveClientDisplayName(input: {
  firstName: string | null;
  lastName: string | null;
  name: string;
}) {
  const fromParts = [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(" ").trim();
  return fromParts || input.name.trim();
}

function buildLoyaltyReminderPayload(input: {
  clientName: string;
  pointsExpiring: number;
  expiresAt: Date;
  currencyCode: string;
}) {
  let walletUrl = "";

  try {
    walletUrl = `${resolveAppUrl()}/dashboard/wallet`;
  } catch {
    walletUrl = "";
  }

  const expiresAtLabel = input.expiresAt.toISOString().slice(0, 10);

  return {
    clientName: input.clientName,
    "contact.fullName": input.clientName,
    name: input.clientName,
    "loyalty.pointsExpiring": String(input.pointsExpiring),
    "loyalty.expiresAt": expiresAtLabel,
    "loyalty.currencyCode": input.currencyCode,
    "loyalty.walletUrl": walletUrl,
  };
}

async function markExpiredReservationSideEffects(input: {
  readonly orderId: string;
  readonly now: Date;
  readonly prismaClient?: Prisma.TransactionClient;
}) {
  const db = input.prismaClient ?? prisma;
  const paymentUpdate = await db.payment.updateMany({
    where: {
      orderId: input.orderId,
      provider: PaymentProvider.INTERNAL,
      method: PaymentMethod.LOYALTY_CREDIT,
      status: PaymentStatus.PENDING,
    },
    data: {
      status: PaymentStatus.FAILED,
      failedAt: input.now,
      failureReason: "LOYALTY_CREDIT_RESERVATION_EXPIRED",
    },
  });

  const orderUpdate = await db.order.updateMany({
    where: {
      id: input.orderId,
      status: { in: [OrderStatus.DRAFT, OrderStatus.PLACED] },
    },
    data: { status: OrderStatus.CANCELLED },
  });

  return {
    paymentFailedCount: paymentUpdate.count,
    orderCancelledCount: orderUpdate.count,
  };
}

async function isReservationAlreadyCompleted(reservationId: string) {
  const reservation = await prisma.loyaltyCreditReservation.findUnique({
    where: { id: reservationId },
    select: { status: true },
  });

  return reservation?.status === LoyaltyCreditReservationStatus.CAPTURED
    || reservation?.status === LoyaltyCreditReservationStatus.RELEASED;
}

export async function expireDueLoyaltyPoints(input: LoyaltyMaintenanceInput = {}): Promise<LoyaltyExpirationMaintenanceResult> {
  const now = input.now ?? new Date();
  const batchSize = resolveBatchSize(input.batchSize);
  const effectiveDateKey = toEffectiveDateKey(now);
  const candidates = await prisma.loyaltyPointsLedgerEntry.findMany({
    where: {
      amountPoints: { gt: 0 },
      expiresAt: { lte: now },
    },
    orderBy: [{ expiresAt: "asc" }, { happenedAt: "asc" }, { createdAt: "asc" }],
    take: batchSize,
    select: {
      id: true,
      clientId: true,
      currencyCode: true,
      amountPoints: true,
      expiresAt: true,
      client: {
        select: {
          email: true,
          firstName: true,
          lastName: true,
          name: true,
        },
      },
      derivedEntries: {
        select: { amountPoints: true },
      },
    },
  });

  let createdCount = 0;
  let replayedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const candidate of candidates) {
    try {
      const result = await expireLoyaltyPointsEntry({
        actor: maintenanceActor,
        sourceEntryId: candidate.id,
        idempotencyKey: buildExpirationIdempotencyKey(candidate.id, effectiveDateKey),
        happenedAt: now,
        metadata: {
          source: "loyalty-maintenance",
          effectiveDate: effectiveDateKey,
        },
      });

      if (result.outcome === "created") {
        createdCount += 1;
      } else if (result.outcome === "replayed") {
        replayedCount += 1;
      } else {
        skippedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      console.error("[loyalty-maintenance] loyalty expiration failed", {
        alertCode: "LOYALTY_EXPIRATION_MAINTENANCE_FAILED",
        sourceEntryId: candidate.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    scannedCount: candidates.length,
    createdCount,
    replayedCount,
    skippedCount,
    failedCount,
  };
}

export async function enqueueLoyaltyExpirationReminderNotifications(
  input: LoyaltyMaintenanceInput = {},
): Promise<LoyaltyReminderMaintenanceResult> {
  await ensureExpectedAutomationTemplateExists(LOYALTY_EXPIRATION_REMINDER_TEMPLATE_KEY);

  const now = input.now ?? new Date();
  const batchSize = resolveBatchSize(input.batchSize);
  const effectiveDateKey = toEffectiveDateKey(now);
  const programs = await prisma.loyaltyProgram.findMany({
    where: {
      expirationReminderDays: { not: null },
    },
    select: {
      currencyCode: true,
      expirationReminderDays: true,
    },
    orderBy: { currencyCode: "asc" },
  });

  const reminders: PositiveLoyaltySource[] = [];
  for (const program of programs) {
    const reminderDays = program.expirationReminderDays;
    if (!reminderDays) {
      continue;
    }

    const dueDay = addDays(now, reminderDays);
    const dueStart = startOfUtcDay(dueDay);
    const dueEnd = endOfUtcDay(dueDay);
    const remaining = batchSize - reminders.length;
    if (remaining <= 0) {
      break;
    }

    const candidates = await prisma.loyaltyPointsLedgerEntry.findMany({
      where: {
        currencyCode: program.currencyCode,
        amountPoints: { gt: 0 },
        expiresAt: {
          gte: dueStart,
          lte: dueEnd,
        },
      },
      orderBy: [{ expiresAt: "asc" }, { happenedAt: "asc" }, { createdAt: "asc" }],
      take: remaining,
      select: {
        id: true,
        clientId: true,
        currencyCode: true,
        amountPoints: true,
        expiresAt: true,
        client: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            name: true,
          },
        },
        derivedEntries: {
          select: { amountPoints: true },
        },
      },
    });
    reminders.push(...candidates);
  }

  let enqueuedCount = 0;
  let failedCount = 0;

  for (const candidate of reminders) {
    if (!candidate.expiresAt) {
      continue;
    }

    const remainingPoints = getRemainingPoints(candidate);
    if (remainingPoints <= 0) {
      continue;
    }

    try {
      const event = await enqueueEmailAutomationEvent({
        templateKey: LOYALTY_EXPIRATION_REMINDER_TEMPLATE_KEY,
        recipientEmail: candidate.client.email,
        payloadJson: buildLoyaltyReminderPayload({
          clientName: resolveClientDisplayName(candidate.client),
          pointsExpiring: remainingPoints,
          expiresAt: candidate.expiresAt,
          currencyCode: candidate.currencyCode,
        }),
        idempotencyKey: buildReminderIdempotencyKey(candidate.id, effectiveDateKey),
      });
      if (event) {
        enqueuedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      console.error("[loyalty-maintenance] loyalty reminder enqueue failed", {
        alertCode: "LOYALTY_REMINDER_EMAIL_ENQUEUE_FAILED",
        sourceEntryId: candidate.id,
        recipientEmail: candidate.client.email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    scannedCount: reminders.length,
    enqueuedCount,
    failedCount,
  };
}

export async function cleanupExpiredLoyaltyCreditReservations(
  input: LoyaltyMaintenanceInput = {},
): Promise<LoyaltyCreditReservationMaintenanceResult> {
  const now = input.now ?? new Date();
  const batchSize = resolveBatchSize(input.batchSize);
  const reservations = await prisma.loyaltyCreditReservation.findMany({
    where: {
      status: LoyaltyCreditReservationStatus.RESERVED,
      expiresAt: { lte: now },
      order: {
        payments: {
          none: {
            provider: PaymentProvider.STRIPE,
            stripeCheckoutSessionId: { not: null },
          },
        },
      },
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    take: batchSize,
    select: {
      id: true,
      orderId: true,
      clientId: true,
    },
  });

  let releasedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let paymentFailedCount = 0;
  let orderCancelledCount = 0;

  for (const reservation of reservations) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const release = await releaseLoyaltyCreditReservation({
          actor: maintenanceActor,
          reservationId: reservation.id,
          idempotencyKey: `loyalty-credit:release:reservation:${reservation.id}`,
          metadata: {
            source: "loyalty-maintenance",
          },
          prismaClient: tx,
        });

        const sideEffects = await markExpiredReservationSideEffects({
          orderId: release.reservation.orderId,
          now,
          prismaClient: tx,
        });

        return { release, sideEffects };
      });
      releasedCount += outcome.release.idempotent ? 0 : 1;
      paymentFailedCount += outcome.sideEffects.paymentFailedCount;
      orderCancelledCount += outcome.sideEffects.orderCancelledCount;
    } catch (error) {
      if (error instanceof Error && error.message.includes("no longer releasable") && await isReservationAlreadyCompleted(reservation.id)) {
        skippedCount += 1;
        continue;
      }

      failedCount += 1;
      console.error("[loyalty-maintenance] loyalty credit reservation cleanup failed", {
        alertCode: "LOYALTY_CREDIT_RESERVATION_CLEANUP_FAILED",
        reservationId: reservation.id,
        orderId: reservation.orderId,
        clientId: reservation.clientId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    scannedCount: reservations.length,
    releasedCount,
    skippedCount,
    failedCount,
    paymentFailedCount,
    orderCancelledCount,
  };
}
