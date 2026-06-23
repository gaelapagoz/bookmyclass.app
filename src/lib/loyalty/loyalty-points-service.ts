import {
  LoyaltyPointsLedgerEntryType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PriceType,
  Role,
  UserActivationStatus,
} from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  calculateLoyaltyPoints,
  getActiveLoyaltyProgram,
  type LoyaltyProgramRecord,
  LoyaltyProgramServiceError,
} from "./loyalty-program-service";

type Tx = Prisma.TransactionClient;
type LoyaltyDbClient = Tx | typeof prisma;

type LoyaltyActor =
  | { type: "SYSTEM"; label: string }
  | { type: "USER"; userId: string; role: Role };

type LoyaltyEntryRecord = Prisma.LoyaltyPointsLedgerEntryGetPayload<{
  include: {
    createdBy: { select: { id: true; name: true; email: true; role: true } };
  };
}>;

type LoyaltyPointsOutcome =
  | { outcome: "created"; entry: LoyaltyEntryRecord }
  | { outcome: "replayed"; entry: LoyaltyEntryRecord }
  | { outcome: "skipped"; reason: "NO_ELIGIBLE_PRODUCTS" | "NO_EARNABLE_POINTS" | "NO_POINTS_LEFT_TO_EXPIRE" };

const loyaltyMetadataSchema = z.record(z.string(), z.unknown());

const manualGrantSchema = z.object({
  clientId: z.string().trim().min(1),
  amountPoints: z.number().int().positive(),
  reason: z.string().trim().min(10).max(500),
  idempotencyKey: z.string().trim().min(1),
  happenedAt: z.date().optional(),
  metadata: loyaltyMetadataSchema.optional(),
});

const earnedPointsSchema = z.object({
  clientId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  paymentId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  happenedAt: z.date().optional(),
  metadata: loyaltyMetadataSchema.optional(),
});

const reversalSchema = z.object({
  sourceEntryId: z.string().trim().min(1),
  amountPoints: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(1),
  happenedAt: z.date().optional(),
  metadata: loyaltyMetadataSchema.optional(),
});

const expirationSchema = z.object({
  sourceEntryId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  happenedAt: z.date(),
  metadata: loyaltyMetadataSchema.optional(),
});

export class LoyaltyPointsServiceError extends Error {
  constructor(
    public readonly code:
      | "LOYALTY_CLIENT_REQUIRED"
      | "LOYALTY_CLIENT_NOT_ACTIVE"
      | "LOYALTY_CLIENT_EMAIL_UNVERIFIED"
      | "LOYALTY_ADMIN_REQUIRED"
      | "LOYALTY_ORDER_NOT_FOUND"
      | "LOYALTY_ORDER_NOT_PAID"
      | "LOYALTY_ORDER_NOT_OWNED"
      | "LOYALTY_PAYMENT_NOT_FOUND"
      | "LOYALTY_PAYMENT_NOT_SETTLED"
      | "LOYALTY_CURRENCY_MISMATCH"
      | "LOYALTY_IDEMPOTENCY_CONFLICT"
      | "LOYALTY_SOURCE_ENTRY_NOT_FOUND"
      | "LOYALTY_SOURCE_ENTRY_INVALID"
      | "LOYALTY_REVERSAL_EXCEEDS_SOURCE"
      | "LOYALTY_EXPIRATION_NOT_DUE"
      | "LOYALTY_ELIGIBLE_AMOUNT_INVALID",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LoyaltyPointsServiceError";
  }
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
  const merged: Prisma.InputJsonObject = { ...actorMetadata(actor) };

  Object.assign(
    merged,
    (metadata ?? {}) as Prisma.InputJsonObject,
    (extra ?? {}) as Prisma.InputJsonObject,
  );

  return merged;
}

function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034";
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("write conflict") || message.includes("deadlock") || message.includes("could not serialize access");
}

async function runLoyaltyTransaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (attempt < maxAttempts && isRetryableTransactionError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new LoyaltyPointsServiceError("LOYALTY_IDEMPOTENCY_CONFLICT", "Loyalty transaction retries were exhausted.");
}

async function withLoyaltyDb<T>(
  prismaClient: LoyaltyDbClient | undefined,
  callback: (tx: LoyaltyDbClient) => Promise<T>,
) {
  if (prismaClient) {
    return callback(prismaClient);
  }

  return runLoyaltyTransaction(callback);
}

async function resolveEligibleClient(tx: Tx, clientId: string) {
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
    throw new LoyaltyPointsServiceError("LOYALTY_CLIENT_REQUIRED", "Loyalty actions require an active client.");
  }
  if (!client.isActive || client.isInactive || client.activationStatus !== UserActivationStatus.ACTIVE) {
    throw new LoyaltyPointsServiceError("LOYALTY_CLIENT_NOT_ACTIVE", "Inactive clients cannot receive loyalty mutations.");
  }
  if (!client.emailVerified && !client.emailVerifiedAt) {
    throw new LoyaltyPointsServiceError("LOYALTY_CLIENT_EMAIL_UNVERIFIED", "Verified clients are required for loyalty mutations.");
  }

  return client;
}

async function getExistingEntryByKey(tx: Tx, idempotencyKey: string): Promise<LoyaltyEntryRecord | null> {
  return tx.loyaltyPointsLedgerEntry.findUnique({
    where: { idempotencyKey },
    include: {
      createdBy: { select: { id: true, name: true, email: true, role: true } },
    },
  });
}

function assertIdempotencyReplay(
  existing: LoyaltyEntryRecord,
  expected: {
    clientId?: string;
    entryType: LoyaltyPointsLedgerEntryType;
    orderId?: string | null;
    paymentId?: string | null;
    sourceEntryId?: string | null;
  },
) {
  if (
    (expected.clientId && existing.clientId !== expected.clientId)
    || existing.entryType !== expected.entryType
    || (expected.orderId !== undefined && existing.orderId !== expected.orderId)
    || (expected.paymentId !== undefined && existing.paymentId !== expected.paymentId)
    || (expected.sourceEntryId !== undefined && existing.sourceEntryId !== expected.sourceEntryId)
  ) {
    throw new LoyaltyPointsServiceError(
      "LOYALTY_IDEMPOTENCY_CONFLICT",
      "The loyalty idempotency key was already used for a different mutation.",
      { idempotencyKey: existing.idempotencyKey, existingEntryId: existing.id },
    );
  }
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function resolveSourceEntry(tx: Tx, sourceEntryId: string) {
  const sourceEntry = await tx.loyaltyPointsLedgerEntry.findUnique({
    where: { id: sourceEntryId },
    include: {
      derivedEntries: {
        select: {
          id: true,
          entryType: true,
          amountPoints: true,
          happenedAt: true,
        },
      },
      createdBy: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  if (!sourceEntry) {
    throw new LoyaltyPointsServiceError("LOYALTY_SOURCE_ENTRY_NOT_FOUND", "Source loyalty entry was not found.");
  }
  if (sourceEntry.amountPoints <= 0) {
    throw new LoyaltyPointsServiceError("LOYALTY_SOURCE_ENTRY_INVALID", "Source loyalty entry must carry a positive point balance.");
  }

  const consumedPoints = sourceEntry.derivedEntries.reduce((total, entry) => total + Math.min(entry.amountPoints, 0), 0);
  const availablePoints = sourceEntry.amountPoints + consumedPoints;

  return {
    sourceEntry,
    availablePoints,
  };
}

function eligibleOrderAmountFromProgram(input: {
  orderItems: Array<{
    productId: string;
    lineTotalAmountMinor: number;
    currencyCode: string;
    product: { isActive: boolean; isArchived: boolean };
    price: { isActive: boolean; isArchived: boolean; currencyCode: string; priceType: PriceType };
  }>;
  program: LoyaltyProgramRecord;
}) {
  const eligibleProductIds = new Set(
    input.program.eligibleProducts.filter((entry) => entry.isActive).map((entry) => entry.productId),
  );

  return input.orderItems.reduce((total, item) => {
    if (!eligibleProductIds.has(item.productId)) return total;
    if (!item.product.isActive || item.product.isArchived) return total;
    if (!item.price.isActive || item.price.isArchived) return total;
    if (item.price.priceType !== PriceType.ONE_TIME) return total;
    if (item.currencyCode !== input.program.currencyCode || item.price.currencyCode !== input.program.currencyCode) return total;
    return total + item.lineTotalAmountMinor;
  }, 0);
}

function clampMinorAmount(amountMinor: number, maxAmountMinor: number) {
  return Math.min(Math.max(amountMinor, 0), Math.max(maxAmountMinor, 0));
}

function allocateProportionalAmount(input: {
  baseAmountMinor: number;
  proportionalToMinor: number;
  totalMinor: number;
}) {
  if (input.baseAmountMinor <= 0 || input.proportionalToMinor <= 0 || input.totalMinor <= 0) {
    return 0;
  }

  return Math.floor((input.baseAmountMinor * input.proportionalToMinor) / input.totalMinor);
}

function computeEligibleSettledPaidAmount(input: {
  orderTotalAmountMinor: number;
  eligibleDiscountedAmountMinor: number;
  giftCardFundedAmountMinor: number;
  loyaltyCreditFundedAmountMinor: number;
}) {
  const totalAmountMinor = clampMinorAmount(input.orderTotalAmountMinor, input.orderTotalAmountMinor);
  const eligibleDiscountedAmountMinor = clampMinorAmount(
    input.eligibleDiscountedAmountMinor,
    totalAmountMinor,
  );
  const giftCardFundedAmountMinor = clampMinorAmount(input.giftCardFundedAmountMinor, totalAmountMinor);
  const loyaltyCreditFundedAmountMinor = clampMinorAmount(
    input.loyaltyCreditFundedAmountMinor,
    totalAmountMinor,
  );

  if (totalAmountMinor === 0 || eligibleDiscountedAmountMinor === 0) {
    return 0;
  }

  const eligibleGiftCardShareMinor = allocateProportionalAmount({
    baseAmountMinor: eligibleDiscountedAmountMinor,
    proportionalToMinor: giftCardFundedAmountMinor,
    totalMinor: totalAmountMinor,
  });
  const eligibleLoyaltyCreditShareMinor = allocateProportionalAmount({
    baseAmountMinor: eligibleDiscountedAmountMinor,
    proportionalToMinor: loyaltyCreditFundedAmountMinor,
    totalMinor: totalAmountMinor,
  });

  return clampMinorAmount(
    eligibleDiscountedAmountMinor - eligibleGiftCardShareMinor - eligibleLoyaltyCreditShareMinor,
    eligibleDiscountedAmountMinor,
  );
}

export async function awardLoyaltyPointsForSettledOrder(input: {
  actor?: LoyaltyActor;
  clientId: string;
  orderId: string;
  paymentId: string;
  idempotencyKey: string;
  happenedAt?: Date;
  metadata?: Record<string, unknown>;
  prismaClient?: LoyaltyDbClient;
}): Promise<LoyaltyPointsOutcome> {
  const parsed = earnedPointsSchema.parse(input);
  const actor = input.actor ?? { type: "SYSTEM", label: "checkout-finalization" } satisfies LoyaltyActor;

  return withLoyaltyDb(input.prismaClient, async (tx) => {
    const existing = await getExistingEntryByKey(tx, parsed.idempotencyKey);
    if (existing) {
      assertIdempotencyReplay(existing, {
        clientId: parsed.clientId,
        entryType: LoyaltyPointsLedgerEntryType.EARN,
        orderId: parsed.orderId,
        paymentId: parsed.paymentId,
      });
      return { outcome: "replayed", entry: existing };
    }

    await resolveEligibleClient(tx, parsed.clientId);

    const order = await tx.order.findUnique({
      where: { id: parsed.orderId },
      select: {
        id: true,
        clientId: true,
        currencyCode: true,
        status: true,
        totalAmountMinor: true,
        items: {
          select: {
            productId: true,
            lineTotalAmountMinor: true,
            currencyCode: true,
            product: { select: { isActive: true, isArchived: true } },
            price: { select: { isActive: true, isArchived: true, currencyCode: true, priceType: true } },
          },
        },
        payments: {
          where: { status: PaymentStatus.SUCCEEDED },
          select: {
            id: true,
            method: true,
            amountMinor: true,
            currencyCode: true,
          },
        },
      },
    });
    if (!order) {
      throw new LoyaltyPointsServiceError("LOYALTY_ORDER_NOT_FOUND", "Loyalty order was not found.");
    }
    if (order.clientId !== parsed.clientId) {
      throw new LoyaltyPointsServiceError("LOYALTY_ORDER_NOT_OWNED", "Loyalty order does not belong to this client.");
    }
    if (order.status !== OrderStatus.PAID) {
      throw new LoyaltyPointsServiceError("LOYALTY_ORDER_NOT_PAID", "Loyalty points can only be awarded for paid orders.");
    }

    const payment = await tx.payment.findUnique({
      where: { id: parsed.paymentId },
      select: {
        id: true,
        orderId: true,
        status: true,
        currencyCode: true,
        capturedAt: true,
      },
    });
    if (!payment) {
      throw new LoyaltyPointsServiceError("LOYALTY_PAYMENT_NOT_FOUND", "Loyalty payment was not found.");
    }
    if (payment.orderId !== order.id) {
      throw new LoyaltyPointsServiceError("LOYALTY_ORDER_NOT_OWNED", "Loyalty payment does not belong to the supplied order.");
    }
    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new LoyaltyPointsServiceError("LOYALTY_PAYMENT_NOT_SETTLED", "Loyalty points can only be awarded for settled payments.");
    }

    const program = await getActiveLoyaltyProgram(order.currencyCode, tx);
    if (program.currencyCode !== payment.currencyCode) {
      throw new LoyaltyPointsServiceError("LOYALTY_CURRENCY_MISMATCH", "Order and payment currencies must match the active loyalty program.");
    }

    const computedEligibleAmountMinor = eligibleOrderAmountFromProgram({
      orderItems: order.items,
      program,
    });
    if (computedEligibleAmountMinor === 0) {
      return { outcome: "skipped", reason: "NO_ELIGIBLE_PRODUCTS" };
    }

    const giftCardFundedAmountMinor = order.payments.reduce((total, entry) => {
      if (entry.currencyCode !== program.currencyCode) {
        throw new LoyaltyPointsServiceError(
          "LOYALTY_CURRENCY_MISMATCH",
          "Order payment currencies must match the active loyalty program.",
        );
      }

      return entry.method === PaymentMethod.GIFT_CARD
        ? total + entry.amountMinor
        : total;
    }, 0);
    const loyaltyCreditFundedAmountMinor = order.payments.reduce((total, entry) => {
      if (entry.currencyCode !== program.currencyCode) {
        throw new LoyaltyPointsServiceError(
          "LOYALTY_CURRENCY_MISMATCH",
          "Order payment currencies must match the active loyalty program.",
        );
      }

      return entry.method === PaymentMethod.LOYALTY_CREDIT
        ? total + entry.amountMinor
        : total;
    }, 0);

    const eligibleAmountMinor = computeEligibleSettledPaidAmount({
      orderTotalAmountMinor: order.totalAmountMinor,
      eligibleDiscountedAmountMinor: computedEligibleAmountMinor,
      giftCardFundedAmountMinor,
      loyaltyCreditFundedAmountMinor,
    });

    const amountPoints = calculateLoyaltyPoints({
      earningPoints: program.earningPoints,
      earningAmountMinor: program.earningAmountMinor,
      eligibleAmountMinor,
    });
    if (amountPoints <= 0) {
      return { outcome: "skipped", reason: "NO_EARNABLE_POINTS" };
    }

    const happenedAt = parsed.happenedAt ?? payment.capturedAt ?? new Date();
    const entry = await tx.loyaltyPointsLedgerEntry.create({
      data: {
        clientId: parsed.clientId,
        entryType: LoyaltyPointsLedgerEntryType.EARN,
        amountPoints,
        currencyCode: program.currencyCode,
        orderId: order.id,
        paymentId: payment.id,
        idempotencyKey: parsed.idempotencyKey,
        metadata: mergeMetadata(actor, parsed.metadata, {
          eligibleAmountMinor,
          computedEligibleAmountMinor,
          giftCardFundedAmountMinor,
          loyaltyCreditFundedAmountMinor,
        }),
        happenedAt,
        expiresAt: addDays(happenedAt, program.pointsExpireAfterDays),
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    return { outcome: "created", entry };
  });
}

export async function grantManualLoyaltyPoints(input: {
  actor: Extract<LoyaltyActor, { type: "USER" }>;
  clientId: string;
  currencyCode: string;
  amountPoints: number;
  reason: string;
  idempotencyKey: string;
  happenedAt?: Date;
  metadata?: Record<string, unknown>;
  prismaClient?: LoyaltyDbClient;
}): Promise<Extract<LoyaltyPointsOutcome, { outcome: "created" | "replayed" }>> {
  const parsed = manualGrantSchema.parse(input);
  if (input.actor.role !== Role.ADMIN && input.actor.role !== Role.MASTER_ADMIN) {
    throw new LoyaltyPointsServiceError("LOYALTY_ADMIN_REQUIRED", "Only admins can grant manual loyalty points.");
  }

  return withLoyaltyDb(input.prismaClient, async (tx) => {
    const existing = await getExistingEntryByKey(tx, parsed.idempotencyKey);
    if (existing) {
      assertIdempotencyReplay(existing, {
        clientId: parsed.clientId,
        entryType: LoyaltyPointsLedgerEntryType.MANUAL_GRANT,
      });
      return { outcome: "replayed", entry: existing };
    }

    await resolveEligibleClient(tx, parsed.clientId);

    const program = await getActiveLoyaltyProgram(input.currencyCode, tx);
    if (parsed.amountPoints > program.maxManualGrantPoints) {
      throw new LoyaltyPointsServiceError(
        "LOYALTY_ELIGIBLE_AMOUNT_INVALID",
        "Manual loyalty grant exceeds the configured maximum.",
        { maxManualGrantPoints: program.maxManualGrantPoints },
      );
    }

    const happenedAt = parsed.happenedAt ?? new Date();
    const entry = await tx.loyaltyPointsLedgerEntry.create({
      data: {
        clientId: parsed.clientId,
        entryType: LoyaltyPointsLedgerEntryType.MANUAL_GRANT,
        amountPoints: parsed.amountPoints,
        currencyCode: program.currencyCode,
        createdById: input.actor.userId,
        reason: parsed.reason,
        idempotencyKey: parsed.idempotencyKey,
        metadata: mergeMetadata(input.actor, parsed.metadata),
        happenedAt,
        expiresAt: addDays(happenedAt, program.pointsExpireAfterDays),
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    return { outcome: "created", entry };
  });
}

export async function reverseLoyaltyPointsEntry(input: {
  actor: LoyaltyActor;
  sourceEntryId: string;
  amountPoints: number;
  reason: string;
  idempotencyKey: string;
  happenedAt?: Date;
  metadata?: Record<string, unknown>;
  prismaClient?: LoyaltyDbClient;
}): Promise<Extract<LoyaltyPointsOutcome, { outcome: "created" | "replayed" }>> {
  const parsed = reversalSchema.parse(input);

  return withLoyaltyDb(input.prismaClient, async (tx) => {
    const existing = await getExistingEntryByKey(tx, parsed.idempotencyKey);
    if (existing) {
      assertIdempotencyReplay(existing, {
        entryType: LoyaltyPointsLedgerEntryType.REVERSAL,
        sourceEntryId: parsed.sourceEntryId,
      });
      return { outcome: "replayed", entry: existing };
    }

    const { sourceEntry, availablePoints } = await resolveSourceEntry(tx, parsed.sourceEntryId);
    if (parsed.amountPoints > availablePoints) {
      throw new LoyaltyPointsServiceError(
        "LOYALTY_REVERSAL_EXCEEDS_SOURCE",
        "Loyalty reversal cannot exceed the remaining source points.",
        { availablePoints },
      );
    }

    const entry = await tx.loyaltyPointsLedgerEntry.create({
      data: {
        clientId: sourceEntry.clientId,
        entryType: LoyaltyPointsLedgerEntryType.REVERSAL,
        amountPoints: parsed.amountPoints * -1,
        currencyCode: sourceEntry.currencyCode,
        orderId: sourceEntry.orderId,
        paymentId: sourceEntry.paymentId,
        sourceEntryId: sourceEntry.id,
        reason: parsed.reason,
        idempotencyKey: parsed.idempotencyKey,
        metadata: mergeMetadata(input.actor, parsed.metadata),
        happenedAt: parsed.happenedAt ?? new Date(),
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    return { outcome: "created", entry };
  });
}

export async function expireLoyaltyPointsEntry(input: {
  actor?: LoyaltyActor;
  sourceEntryId: string;
  idempotencyKey: string;
  happenedAt: Date;
  metadata?: Record<string, unknown>;
  prismaClient?: LoyaltyDbClient;
}): Promise<LoyaltyPointsOutcome> {
  const parsed = expirationSchema.parse(input);
  const actor = input.actor ?? { type: "SYSTEM", label: "loyalty-maintenance" } satisfies LoyaltyActor;

  return withLoyaltyDb(input.prismaClient, async (tx) => {
    const existing = await getExistingEntryByKey(tx, parsed.idempotencyKey);
    if (existing) {
      assertIdempotencyReplay(existing, {
        entryType: LoyaltyPointsLedgerEntryType.EXPIRE,
        sourceEntryId: parsed.sourceEntryId,
      });
      return { outcome: "replayed", entry: existing };
    }

    const { sourceEntry, availablePoints } = await resolveSourceEntry(tx, parsed.sourceEntryId);
    if (sourceEntry.expiresAt && sourceEntry.expiresAt > parsed.happenedAt) {
      throw new LoyaltyPointsServiceError("LOYALTY_EXPIRATION_NOT_DUE", "Loyalty points cannot expire before their expiration date.");
    }
    if (availablePoints <= 0) {
      return { outcome: "skipped", reason: "NO_POINTS_LEFT_TO_EXPIRE" };
    }

    const entry = await tx.loyaltyPointsLedgerEntry.create({
      data: {
        clientId: sourceEntry.clientId,
        entryType: LoyaltyPointsLedgerEntryType.EXPIRE,
        amountPoints: availablePoints * -1,
        currencyCode: sourceEntry.currencyCode,
        sourceEntryId: sourceEntry.id,
        idempotencyKey: parsed.idempotencyKey,
        metadata: mergeMetadata(actor, parsed.metadata),
        happenedAt: parsed.happenedAt,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    return { outcome: "created", entry };
  });
}

export { LoyaltyProgramServiceError };
