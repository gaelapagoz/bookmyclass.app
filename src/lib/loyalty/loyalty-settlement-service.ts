import { LoyaltyPointsLedgerEntryType, Prisma, Role } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  awardLoyaltyPointsForSettledOrder,
  LoyaltyPointsServiceError,
  reverseLoyaltyPointsEntry,
} from "./loyalty-points-service";
import { LoyaltyProgramServiceError } from "./loyalty-program-service";

type Tx = Prisma.TransactionClient;
type LoyaltyDbClient = Tx | typeof prisma;

type LoyaltyActor =
  | { type: "SYSTEM"; label: string }
  | { type: "USER"; userId: string; role: Role };

type LoyaltySettlementSkipReason =
  | "LOYALTY_PROGRAM_NOT_ACTIVE"
  | "LOYALTY_CLIENT_NOT_ELIGIBLE"
  | "NO_ELIGIBLE_PRODUCTS"
  | "NO_EARNABLE_POINTS"
  | "NO_POINTS_LEFT_TO_EXPIRE"
  | "NO_EARNED_ENTRY"
  | "NO_REVERSABLE_POINTS";

type LoyaltySettlementOutcome =
  | { outcome: "created"; entryId: string }
  | { outcome: "replayed"; entryId: string }
  | { outcome: "skipped"; reason: LoyaltySettlementSkipReason };

const paymentInvalidationSchema = z.object({
  orderId: z.string().trim().min(1),
  paymentId: z.string().trim().min(1),
  invalidatedAmountMinor: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(1),
  happenedAt: z.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function isProgramInactiveError(error: unknown) {
  return error instanceof LoyaltyProgramServiceError
    && (error.code === "LOYALTY_PROGRAM_NOT_FOUND" || error.code === "LOYALTY_PROGRAM_NOT_ACTIVE");
}

function isClientIneligibleError(error: unknown) {
  return error instanceof LoyaltyPointsServiceError
    && (
      error.code === "LOYALTY_CLIENT_REQUIRED"
      || error.code === "LOYALTY_CLIENT_NOT_ACTIVE"
      || error.code === "LOYALTY_CLIENT_EMAIL_UNVERIFIED"
    );
}

function parseEligibleAmountMinor(metadata: Prisma.JsonValue | null | undefined) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>).eligibleAmountMinor;
  return Number.isInteger(value) && typeof value === "number" && value > 0 ? value : null;
}

function clampWholePoints(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

async function withDb<T>(
  prismaClient: LoyaltyDbClient | undefined,
  callback: (tx: LoyaltyDbClient) => Promise<T>,
) {
  if (prismaClient) {
    return callback(prismaClient);
  }

  return prisma.$transaction(
    async (tx) => callback(tx),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function settleLoyaltyForSettledOrder(input: {
  orderId: string;
  paymentId: string;
  actor?: LoyaltyActor;
  metadata?: Record<string, unknown>;
  prismaClient?: LoyaltyDbClient;
}): Promise<LoyaltySettlementOutcome> {
  return withDb(input.prismaClient, async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { clientId: true },
    });

    if (!order) {
      throw new LoyaltyPointsServiceError("LOYALTY_ORDER_NOT_FOUND", "Loyalty order was not found.");
    }

    try {
      const result = await awardLoyaltyPointsForSettledOrder({
        actor: input.actor,
        clientId: order.clientId,
        orderId: input.orderId,
        paymentId: input.paymentId,
        idempotencyKey: `loyalty:earn:payment:${input.paymentId}`,
        metadata: input.metadata,
        prismaClient: tx,
      });

      if (result.outcome === "created" || result.outcome === "replayed") {
        return { outcome: result.outcome, entryId: result.entry.id };
      }

      return { outcome: "skipped", reason: result.reason };
    } catch (error) {
      if (isProgramInactiveError(error)) {
        return { outcome: "skipped", reason: "LOYALTY_PROGRAM_NOT_ACTIVE" };
      }
      if (isClientIneligibleError(error)) {
        return { outcome: "skipped", reason: "LOYALTY_CLIENT_NOT_ELIGIBLE" };
      }
      throw error;
    }
  });
}

export async function reverseLoyaltyForPaymentInvalidation(input: {
  actor: LoyaltyActor;
  orderId: string;
  paymentId: string;
  invalidatedAmountMinor: number;
  reason: string;
  idempotencyKey: string;
  happenedAt?: Date;
  metadata?: Record<string, unknown>;
  prismaClient?: LoyaltyDbClient;
}): Promise<LoyaltySettlementOutcome> {
  const parsed = paymentInvalidationSchema.parse(input);

  return withDb(input.prismaClient, async (tx) => {
    const earnedEntry = await tx.loyaltyPointsLedgerEntry.findFirst({
      where: {
        orderId: parsed.orderId,
        paymentId: parsed.paymentId,
        entryType: LoyaltyPointsLedgerEntryType.EARN,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        amountPoints: true,
        metadata: true,
      },
    });

    if (!earnedEntry) {
      return { outcome: "skipped", reason: "NO_EARNED_ENTRY" };
    }

    const eligibleAmountMinor = parseEligibleAmountMinor(earnedEntry.metadata);
    if (!eligibleAmountMinor) {
      throw new LoyaltyPointsServiceError(
        "LOYALTY_ELIGIBLE_AMOUNT_INVALID",
        "Earned loyalty entry is missing eligible settled amount metadata.",
        { earnedEntryId: earnedEntry.id },
      );
    }

    const reversedEligibleSettledAmountMinor = Math.min(
      parsed.invalidatedAmountMinor,
      eligibleAmountMinor,
    );
    const reversalPoints = clampWholePoints(
      (earnedEntry.amountPoints * reversedEligibleSettledAmountMinor) / eligibleAmountMinor,
    );
    if (reversalPoints <= 0) {
      return { outcome: "skipped", reason: "NO_REVERSABLE_POINTS" };
    }

    const result = await reverseLoyaltyPointsEntry({
      actor: input.actor,
      sourceEntryId: earnedEntry.id,
      amountPoints: reversalPoints,
      reason: parsed.reason,
      idempotencyKey: parsed.idempotencyKey,
      happenedAt: parsed.happenedAt,
      metadata: {
        ...(parsed.metadata ?? {}),
        invalidatedAmountMinor: parsed.invalidatedAmountMinor,
        reversedEligibleSettledAmountMinor,
        originalEligibleAmountMinor: eligibleAmountMinor,
      },
      prismaClient: tx,
    });

    return { outcome: result.outcome, entryId: result.entry.id };
  });
}
