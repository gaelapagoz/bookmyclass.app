import { CreditLedgerEntryType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export class InsufficientCreditsError extends Error {
  constructor(message = "Insufficient credits for this entitlement.") {
    super(message);
  }
}

export async function restoreCredit(params: {
  clientId: string;
  entitlementId: string;
  bookingId: string;
  reason: string;
  idempotencyKey: string;
  createdById?: string | null;
  prismaClient?: Prisma.TransactionClient | typeof prisma;
}): Promise<{ restored: boolean }> {
  if (!params.reason.trim()) throw new Error("CREDIT_RESTORE_REASON_REQUIRED");

  const db = params.prismaClient ?? prisma;

  async function execute(tx: Prisma.TransactionClient): Promise<{ restored: boolean }> {
    const existing = await tx.creditLedgerEntry.findFirst({
      where: { idempotencyKey: params.idempotencyKey },
      select: { id: true },
    });
    if (existing) return { restored: false };

    await tx.creditLedgerEntry.create({
      data: {
        clientId: params.clientId,
        entitlementId: params.entitlementId,
        bookingId: params.bookingId,
        entryType: CreditLedgerEntryType.RESTORE,
        amount: 1,
        idempotencyKey: params.idempotencyKey,
        notes: params.reason,
        ...(params.createdById ? { createdById: params.createdById } : {}),
      },
    });
    return { restored: true };
  }

  if ("$transaction" in db) {
    return (db as typeof prisma).$transaction(execute);
  }
  return execute(db as Prisma.TransactionClient);
}

export async function consumeCredit(params: {
  clientId: string;
  entitlementId: string;
  bookingId: string;
  reason: string;
  idempotencyKey: string;
  createdById?: string | null;
  prismaClient?: Prisma.TransactionClient | typeof prisma;
}): Promise<{ consumed: boolean }> {
  if (!params.reason.trim()) {
    throw new Error("CREDIT_CONSUME_REASON_REQUIRED");
  }

  const db = params.prismaClient ?? prisma;

  async function execute(tx: Prisma.TransactionClient): Promise<{ consumed: boolean }> {
    const existing = await tx.creditLedgerEntry.findFirst({
      where: { idempotencyKey: params.idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      return { consumed: false };
    }

    const { _sum } = await tx.creditLedgerEntry.aggregate({
      where: { clientId: params.clientId, entitlementId: params.entitlementId },
      _sum: { amount: true },
    });

    if ((_sum.amount ?? 0) <= 0) {
      throw new InsufficientCreditsError();
    }

    await tx.creditLedgerEntry.create({
      data: {
        clientId: params.clientId,
        entitlementId: params.entitlementId,
        bookingId: params.bookingId,
        entryType: CreditLedgerEntryType.CONSUME,
        amount: -1,
        idempotencyKey: params.idempotencyKey,
        notes: params.reason,
        ...(params.createdById ? { createdById: params.createdById } : {}),
      },
    });

    return { consumed: true };
  }

  if ("$transaction" in db) {
    return (db as typeof prisma).$transaction(execute, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  return execute(db as Prisma.TransactionClient);
}
