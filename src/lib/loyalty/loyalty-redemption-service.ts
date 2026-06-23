import {
  LoyaltyCreditLedgerEntryType,
  LoyaltyCreditReservationStatus,
  LoyaltyPointsLedgerEntryType,
  Prisma,
  Role,
  UserActivationStatus,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { getActiveLoyaltyProgram, LoyaltyProgramServiceError } from "./loyalty-program-service";

type Tx = Prisma.TransactionClient;
type LoyaltyDbClient = Tx | typeof prisma;

type LoyaltyActor =
  | { type: "SYSTEM"; label: string }
  | { type: "USER"; userId: string; role: Role };

const rewardRedemptionSchema = z.object({
  clientId: z.string().trim().min(1),
  currencyCode: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  rewardDefinitionId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const reservationSchema = z.object({
  clientId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  amountMinor: z.number().int().positive(),
  currencyCode: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  expiresAt: z.date(),
  idempotencyKey: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const reservationMutationSchema = z.object({
  reservationId: z.string().trim().min(1),
  paymentId: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export class LoyaltyRedemptionServiceError extends Error {
  constructor(
    public readonly code:
      | "LOYALTY_CLIENT_REQUIRED"
      | "LOYALTY_CLIENT_NOT_ACTIVE"
      | "LOYALTY_CLIENT_EMAIL_UNVERIFIED"
      | "LOYALTY_REWARD_NOT_FOUND"
      | "LOYALTY_REWARD_NOT_ACTIVE"
      | "LOYALTY_REWARD_CURRENCY_MISMATCH"
      | "LOYALTY_POINTS_INSUFFICIENT"
      | "LOYALTY_CREDIT_INSUFFICIENT"
      | "LOYALTY_IDEMPOTENCY_CONFLICT"
      | "LOYALTY_RESERVATION_NOT_FOUND"
      | "LOYALTY_RESERVATION_INVALID"
      | "LOYALTY_RESERVATION_ALREADY_EXISTS"
      | "LOYALTY_PAYMENT_CURRENCY_MISMATCH",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LoyaltyRedemptionServiceError";
  }
}

function hashPayload(payload: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function actorMetadata(actor: LoyaltyActor): Prisma.InputJsonObject {
  return actor.type === "SYSTEM"
    ? { actorType: actor.type, actorLabel: actor.label }
    : { actorType: actor.type, actorUserId: actor.userId, actorRole: actor.role };
}

function mergeMetadata(
  actor: LoyaltyActor,
  metadata: Record<string, unknown> | undefined,
  extra?: Record<string, unknown>,
): Prisma.InputJsonObject {
  return {
    ...actorMetadata(actor),
    ...((metadata ?? {}) as Prisma.InputJsonObject),
    ...((extra ?? {}) as Prisma.InputJsonObject),
  };
}

function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034";
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("write conflict") || message.includes("deadlock") || message.includes("serialize");
}

async function runLoyaltyTransaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (attempt < 3 && isRetryableTransactionError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new LoyaltyRedemptionServiceError(
    "LOYALTY_IDEMPOTENCY_CONFLICT",
    "Loyalty credit transaction retries were exhausted.",
  );
}

async function withDb<T>(
  db: LoyaltyDbClient | undefined,
  callback: (tx: LoyaltyDbClient) => Promise<T>,
) {
  if (db) {
    return callback(db);
  }

  return runLoyaltyTransaction(callback);
}

async function lockClientRow(tx: Tx, clientId: string) {
  await tx.$queryRaw`
    SELECT id
    FROM "User"
    WHERE id = ${clientId}
    FOR UPDATE
  `;
}

async function assertEligibleClient(tx: Tx, clientId: string) {
  const client = await tx.user.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      role: true,
      isActive: true,
      isInactive: true,
      activationStatus: true,
      emailVerified: true,
      emailVerifiedAt: true,
    },
  });

  if (!client || client.role !== Role.CLIENT) {
    throw new LoyaltyRedemptionServiceError(
      "LOYALTY_CLIENT_REQUIRED",
      "Loyalty redemptions require a verified client.",
    );
  }
  if (!client.isActive || client.isInactive || client.activationStatus !== UserActivationStatus.ACTIVE) {
    throw new LoyaltyRedemptionServiceError(
      "LOYALTY_CLIENT_NOT_ACTIVE",
      "Inactive clients cannot redeem loyalty value.",
    );
  }
  if (!client.emailVerified && !client.emailVerifiedAt) {
    throw new LoyaltyRedemptionServiceError(
      "LOYALTY_CLIENT_EMAIL_UNVERIFIED",
      "Verified clients are required for loyalty redemption.",
    );
  }
}

async function getAvailablePointsBuckets(tx: Tx, clientId: string, currencyCode: string) {
  const entries = await tx.loyaltyPointsLedgerEntry.findMany({
    where: {
      clientId,
      currencyCode,
      amountPoints: { gt: 0 },
    },
    orderBy: [
      { expiresAt: "asc" },
      { happenedAt: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      amountPoints: true,
      expiresAt: true,
      derivedEntries: {
        select: {
          amountPoints: true,
        },
      },
    },
  });

  return entries
    .map((entry) => ({
      id: entry.id,
      availablePoints:
        entry.amountPoints
        + entry.derivedEntries.reduce(
          (total, derived) => total + Math.min(derived.amountPoints, 0),
          0,
        ),
    }))
    .filter((entry) => entry.availablePoints > 0);
}

type LoyaltyCreditBalance = {
  settledBalanceMinor: number;
  reservedAmountMinor: number;
  availableBalanceMinor: number;
  currencyCode: string;
};

async function getLoyaltyCreditBalanceTx(
  tx: LoyaltyDbClient,
  clientId: string,
  currencyCode: string,
): Promise<LoyaltyCreditBalance> {
  const [ledgerTotals, reservationTotals] = await Promise.all([
    tx.loyaltyCreditLedgerEntry.groupBy({
      by: ["entryType"],
      where: { clientId, currencyCode },
      _sum: { amountMinor: true },
    }),
    tx.loyaltyCreditReservation.aggregate({
      where: {
        clientId,
        currencyCode,
        status: LoyaltyCreditReservationStatus.RESERVED,
      },
      _sum: { reservedAmountMinor: true },
    }),
  ]);

  const totals = new Map(
    ledgerTotals.map((entry: { entryType: LoyaltyCreditLedgerEntryType; _sum: { amountMinor: number | null } }) => [
      entry.entryType,
      entry._sum.amountMinor ?? 0,
    ]),
  );
  const settledBalanceMinor =
    (totals.get(LoyaltyCreditLedgerEntryType.REDEEM) ?? 0)
    - (totals.get(LoyaltyCreditLedgerEntryType.CAPTURE) ?? 0);
  const reservedAmountMinor = reservationTotals._sum.reservedAmountMinor ?? 0;

  return {
    settledBalanceMinor,
    reservedAmountMinor,
    availableBalanceMinor: Math.max(0, settledBalanceMinor - reservedAmountMinor),
    currencyCode,
  };
}

export async function getLoyaltyCreditBalance(input: {
  clientId: string;
  currencyCode: string;
  prismaClient?: LoyaltyDbClient;
}) {
  return withDb(input.prismaClient, async (tx) =>
    getLoyaltyCreditBalanceTx(tx, input.clientId, input.currencyCode.trim().toUpperCase()),
  );
}

export async function listActiveLoyaltyRewards(input: {
  currencyCode: string;
  prismaClient?: LoyaltyDbClient;
}) {
  const program = await getActiveLoyaltyProgram(
    input.currencyCode.trim().toUpperCase(),
    input.prismaClient,
  );

  return (program.rewardDefinitions as Array<{
    id: string;
    name: string;
    pointsRequired: number;
    amountMinor: number;
    isActive: boolean;
    createdAt: Date;
  }>)
    .filter((reward) => reward.isActive)
    .sort((a, b) => a.pointsRequired - b.pointsRequired || a.createdAt.getTime() - b.createdAt.getTime())
    .map((reward) => ({
      id: reward.id,
      name: reward.name,
      pointsRequired: reward.pointsRequired,
      amountMinor: reward.amountMinor,
      currencyCode: program.currencyCode,
      isActive: reward.isActive,
    }));
}

export async function redeemLoyaltyReward(input: {
  actor?: LoyaltyActor;
  clientId: string;
  currencyCode: string;
  rewardDefinitionId: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  prismaClient?: LoyaltyDbClient;
}) {
  const parsed = rewardRedemptionSchema.parse(input);
  const actor = input.actor ?? { type: "SYSTEM", label: "dashboard-loyalty-redemption" } satisfies LoyaltyActor;
  const payloadHash = hashPayload({
    operation: "LOYALTY_REWARD_REDEEM",
    clientId: parsed.clientId,
    currencyCode: parsed.currencyCode,
    rewardDefinitionId: parsed.rewardDefinitionId,
  });

  return withDb(input.prismaClient, async (db) => {
    const tx = db as Tx;
    const existing = await tx.loyaltyRewardRedemption.findUnique({
      where: { idempotencyKey: parsed.idempotencyKey },
      include: {
        pointEntries: true,
        creditLedgerEntries: true,
        rewardDefinition: true,
      },
    });

    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new LoyaltyRedemptionServiceError(
          "LOYALTY_IDEMPOTENCY_CONFLICT",
          "The loyalty reward redemption key was already used for another payload.",
        );
      }

      return { outcome: "replayed" as const, redemption: existing };
    }

    await lockClientRow(tx, parsed.clientId);
    await assertEligibleClient(tx, parsed.clientId);

    const program = await getActiveLoyaltyProgram(parsed.currencyCode, tx);
    const rewardDefinition = await tx.loyaltyRewardDefinition.findFirst({
      where: {
        id: parsed.rewardDefinitionId,
        programId: program.id,
      },
    });

    if (!rewardDefinition) {
      throw new LoyaltyRedemptionServiceError(
        "LOYALTY_REWARD_NOT_FOUND",
        "Loyalty reward definition was not found.",
      );
    }
    if (!rewardDefinition.isActive) {
      throw new LoyaltyRedemptionServiceError(
        "LOYALTY_REWARD_NOT_ACTIVE",
        "Loyalty reward definition is not active.",
      );
    }
    if (program.currencyCode !== parsed.currencyCode) {
      throw new LoyaltyRedemptionServiceError(
        "LOYALTY_REWARD_CURRENCY_MISMATCH",
        "Loyalty reward currency does not match the active program.",
      );
    }

    const buckets = await getAvailablePointsBuckets(tx, parsed.clientId, parsed.currencyCode);
    const availablePoints = buckets.reduce((total, bucket) => total + bucket.availablePoints, 0);
    if (availablePoints < rewardDefinition.pointsRequired) {
      throw new LoyaltyRedemptionServiceError(
        "LOYALTY_POINTS_INSUFFICIENT",
        "Not enough loyalty points are available for this reward.",
        { availablePoints, pointsRequired: rewardDefinition.pointsRequired },
      );
    }

    const redemption = await tx.loyaltyRewardRedemption.create({
      data: {
        clientId: parsed.clientId,
        programId: program.id,
        rewardDefinitionId: rewardDefinition.id,
        pointsSpent: rewardDefinition.pointsRequired,
        creditAmountMinor: rewardDefinition.amountMinor,
        currencyCode: parsed.currencyCode,
        idempotencyKey: parsed.idempotencyKey,
        payloadHash,
        metadata: mergeMetadata(actor, parsed.metadata),
      },
    });

    let remainingPoints = rewardDefinition.pointsRequired;
    for (const bucket of buckets) {
      if (remainingPoints <= 0) {
        break;
      }

      const pointsToConsume = Math.min(bucket.availablePoints, remainingPoints);
      await tx.loyaltyPointsLedgerEntry.create({
        data: {
          clientId: parsed.clientId,
          entryType: LoyaltyPointsLedgerEntryType.REDEEM,
          amountPoints: pointsToConsume * -1,
          currencyCode: parsed.currencyCode,
          sourceEntryId: bucket.id,
          rewardRedemptionId: redemption.id,
          reason: rewardDefinition.name,
          idempotencyKey: `${parsed.idempotencyKey}:points:${bucket.id}`,
          metadata: mergeMetadata(actor, parsed.metadata, {
            rewardDefinitionId: rewardDefinition.id,
            rewardName: rewardDefinition.name,
          }),
        },
      });
      remainingPoints -= pointsToConsume;
    }

    await tx.loyaltyCreditLedgerEntry.create({
      data: {
        clientId: parsed.clientId,
        entryType: LoyaltyCreditLedgerEntryType.REDEEM,
        amountMinor: rewardDefinition.amountMinor,
        currencyCode: parsed.currencyCode,
        rewardRedemptionId: redemption.id,
        idempotencyKey: parsed.idempotencyKey,
        payloadHash,
        metadata: mergeMetadata(actor, parsed.metadata, {
          rewardDefinitionId: rewardDefinition.id,
          rewardName: rewardDefinition.name,
          pointsSpent: rewardDefinition.pointsRequired,
        }),
      },
    });

    const created = await tx.loyaltyRewardRedemption.findUniqueOrThrow({
      where: { id: redemption.id },
      include: {
        pointEntries: true,
        creditLedgerEntries: true,
        rewardDefinition: true,
      },
    });

    return { outcome: "created" as const, redemption: created };
  });
}

export async function reserveLoyaltyCreditValue(input: {
  actor: LoyaltyActor;
  clientId: string;
  orderId: string;
  amountMinor: number;
  currencyCode: string;
  expiresAt: Date;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  prismaClient?: LoyaltyDbClient;
}) {
  const parsed = reservationSchema.parse(input);
  const payloadHash = hashPayload({
    operation: "LOYALTY_CREDIT_RESERVE",
    clientId: parsed.clientId,
    orderId: parsed.orderId,
    amountMinor: parsed.amountMinor,
    currencyCode: parsed.currencyCode,
    expiresAt: parsed.expiresAt.toISOString(),
  });

  return withDb(input.prismaClient, async (db) => {
    const tx = db as Tx;
    const existing = await tx.loyaltyCreditReservation.findUnique({
      where: { idempotencyKey: parsed.idempotencyKey },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new LoyaltyRedemptionServiceError(
          "LOYALTY_IDEMPOTENCY_CONFLICT",
          "The loyalty credit reservation key was already used for another payload.",
        );
      }

      const ledgerEntry = await tx.loyaltyCreditLedgerEntry.findUniqueOrThrow({
        where: { idempotencyKey: parsed.idempotencyKey },
      });
      return { reservation: existing, ledgerEntry, idempotent: true as const };
    }

    await lockClientRow(tx, parsed.clientId);
    await assertEligibleClient(tx, parsed.clientId);

    const reservedForOrder = await tx.loyaltyCreditReservation.findFirst({
      where: {
        orderId: parsed.orderId,
        status: LoyaltyCreditReservationStatus.RESERVED,
      },
      select: { id: true },
    });
    if (reservedForOrder) {
      throw new LoyaltyRedemptionServiceError(
        "LOYALTY_RESERVATION_ALREADY_EXISTS",
        "A loyalty credit reservation already exists for this order.",
      );
    }

    const balance = await getLoyaltyCreditBalanceTx(tx, parsed.clientId, parsed.currencyCode);
    if (balance.availableBalanceMinor < parsed.amountMinor) {
      throw new LoyaltyRedemptionServiceError(
        "LOYALTY_CREDIT_INSUFFICIENT",
        "Not enough loyalty credit is available for this checkout.",
        {
          availableBalanceMinor: balance.availableBalanceMinor,
          requestedAmountMinor: parsed.amountMinor,
        },
      );
    }

    const reservation = await tx.loyaltyCreditReservation.create({
      data: {
        clientId: parsed.clientId,
        orderId: parsed.orderId,
        reservedAmountMinor: parsed.amountMinor,
        currencyCode: parsed.currencyCode,
        idempotencyKey: parsed.idempotencyKey,
        payloadHash,
        expiresAt: parsed.expiresAt,
      },
    });
    const ledgerEntry = await tx.loyaltyCreditLedgerEntry.create({
      data: {
        clientId: parsed.clientId,
        entryType: LoyaltyCreditLedgerEntryType.RESERVE,
        amountMinor: parsed.amountMinor,
        currencyCode: parsed.currencyCode,
        orderId: parsed.orderId,
        reservationId: reservation.id,
        idempotencyKey: parsed.idempotencyKey,
        payloadHash,
        metadata: mergeMetadata(input.actor, parsed.metadata),
      },
    });

    return { reservation, ledgerEntry, idempotent: false as const };
  });
}

export async function captureLoyaltyCreditReservation(input: {
  actor: LoyaltyActor;
  reservationId: string;
  paymentId?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  prismaClient?: LoyaltyDbClient;
}) {
  const parsed = reservationMutationSchema.parse(input);
  const payloadHash = hashPayload({
    operation: "LOYALTY_CREDIT_CAPTURE",
    reservationId: parsed.reservationId,
    paymentId: parsed.paymentId ?? null,
  });

  return withDb(input.prismaClient, async (db) => {
    const tx = db as Tx;
    const existing = await tx.loyaltyCreditLedgerEntry.findUnique({
      where: { idempotencyKey: parsed.idempotencyKey },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new LoyaltyRedemptionServiceError(
          "LOYALTY_IDEMPOTENCY_CONFLICT",
          "The loyalty credit capture key was already used for another payload.",
        );
      }

      const reservation = await tx.loyaltyCreditReservation.findUniqueOrThrow({
        where: { id: parsed.reservationId },
      });
      return { reservation, ledgerEntry: existing, idempotent: true as const };
    }

    const reservation = await tx.loyaltyCreditReservation.findUnique({
      where: { id: parsed.reservationId },
    });
    if (!reservation) {
      throw new LoyaltyRedemptionServiceError(
        "LOYALTY_RESERVATION_NOT_FOUND",
        "Loyalty credit reservation was not found.",
      );
    }

    await lockClientRow(tx, reservation.clientId);
    const lockedReservation = await tx.loyaltyCreditReservation.findUniqueOrThrow({
      where: { id: parsed.reservationId },
    });
    if (lockedReservation.status !== LoyaltyCreditReservationStatus.RESERVED) {
      throw new LoyaltyRedemptionServiceError(
        "LOYALTY_RESERVATION_INVALID",
        "Loyalty credit reservation is no longer capturable.",
      );
    }

    if (parsed.paymentId) {
      const payment = await tx.payment.findUnique({
        where: { id: parsed.paymentId },
        select: { id: true, currencyCode: true },
      });
      if (payment && payment.currencyCode !== lockedReservation.currencyCode) {
        throw new LoyaltyRedemptionServiceError(
          "LOYALTY_PAYMENT_CURRENCY_MISMATCH",
          "Loyalty credit payment currency does not match the reservation.",
        );
      }
    }

    const ledgerEntry = await tx.loyaltyCreditLedgerEntry.create({
      data: {
        clientId: lockedReservation.clientId,
        entryType: LoyaltyCreditLedgerEntryType.CAPTURE,
        amountMinor: lockedReservation.reservedAmountMinor,
        currencyCode: lockedReservation.currencyCode,
        orderId: lockedReservation.orderId,
        paymentId: parsed.paymentId ?? null,
        reservationId: lockedReservation.id,
        idempotencyKey: parsed.idempotencyKey,
        payloadHash,
        metadata: mergeMetadata(input.actor, parsed.metadata),
      },
    });

    const updatedReservation = await tx.loyaltyCreditReservation.update({
      where: { id: lockedReservation.id },
      data: {
        status: LoyaltyCreditReservationStatus.CAPTURED,
        capturedAmountMinor: lockedReservation.reservedAmountMinor,
      },
    });

    return { reservation: updatedReservation, ledgerEntry, idempotent: false as const };
  });
}

export async function releaseLoyaltyCreditReservation(input: {
  actor: LoyaltyActor;
  reservationId: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  prismaClient?: LoyaltyDbClient;
}) {
  const parsed = reservationMutationSchema.parse(input);
  const payloadHash = hashPayload({
    operation: "LOYALTY_CREDIT_RELEASE",
    reservationId: parsed.reservationId,
  });

  return withDb(input.prismaClient, async (db) => {
    const tx = db as Tx;
    const existing = await tx.loyaltyCreditLedgerEntry.findUnique({
      where: { idempotencyKey: parsed.idempotencyKey },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new LoyaltyRedemptionServiceError(
          "LOYALTY_IDEMPOTENCY_CONFLICT",
          "The loyalty credit release key was already used for another payload.",
        );
      }

      const reservation = await tx.loyaltyCreditReservation.findUniqueOrThrow({
        where: { id: parsed.reservationId },
      });
      return { reservation, ledgerEntry: existing, idempotent: true as const };
    }

    const reservation = await tx.loyaltyCreditReservation.findUnique({
      where: { id: parsed.reservationId },
    });
    if (!reservation) {
      throw new LoyaltyRedemptionServiceError(
        "LOYALTY_RESERVATION_NOT_FOUND",
        "Loyalty credit reservation was not found.",
      );
    }

    await lockClientRow(tx, reservation.clientId);
    const lockedReservation = await tx.loyaltyCreditReservation.findUniqueOrThrow({
      where: { id: parsed.reservationId },
    });
    if (lockedReservation.status !== LoyaltyCreditReservationStatus.RESERVED) {
      throw new LoyaltyRedemptionServiceError(
        "LOYALTY_RESERVATION_INVALID",
        "Loyalty credit reservation is no longer releasable.",
      );
    }

    const ledgerEntry = await tx.loyaltyCreditLedgerEntry.create({
      data: {
        clientId: lockedReservation.clientId,
        entryType: LoyaltyCreditLedgerEntryType.RELEASE,
        amountMinor: lockedReservation.reservedAmountMinor,
        currencyCode: lockedReservation.currencyCode,
        orderId: lockedReservation.orderId,
        reservationId: lockedReservation.id,
        idempotencyKey: parsed.idempotencyKey,
        payloadHash,
        metadata: mergeMetadata(input.actor, parsed.metadata),
      },
    });

    const updatedReservation = await tx.loyaltyCreditReservation.update({
      where: { id: lockedReservation.id },
      data: {
        status: LoyaltyCreditReservationStatus.RELEASED,
        releasedAmountMinor: lockedReservation.reservedAmountMinor,
      },
    });

    return { reservation: updatedReservation, ledgerEntry, idempotent: false as const };
  });
}

export { LoyaltyProgramServiceError };
