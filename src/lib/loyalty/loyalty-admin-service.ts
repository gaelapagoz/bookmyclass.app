import { Prisma, Role } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  upsertLoyaltyProgramSettings,
  getLoyaltyProgramForCurrency,
} from "./loyalty-program-service";
import { grantManualLoyaltyPoints } from "./loyalty-points-service";
import {
  getClientLoyaltySummary,
  listAdminLoyaltyClients,
  listClientLoyaltyHistory,
} from "./loyalty-read-service";

type LoyaltyAdminActor = {
  id: string;
  role: Role;
  name: string;
  email: string;
};

const programSettingsSchema = z.object({
  actorUserId: z.string().trim().min(1),
  currencyCode: z.string().trim().length(3),
  isActive: z.boolean(),
  earningPoints: z.number().int().positive(),
  earningAmountMinor: z.number().int().positive(),
  pointsExpireAfterDays: z.number().int().positive(),
  expirationReminderDays: z.number().int().positive().nullable(),
  maxManualGrantPoints: z.number().int().positive(),
  eligibleProductIds: z.array(z.string().trim().min(1)).max(250),
});

const manualGrantSchema = z.object({
  actorUserId: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
  currencyCode: z.string().trim().length(3),
  amountPoints: z.number().int().positive(),
  reason: z.string().trim().min(10).max(500),
  idempotencyKey: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

async function resolveLoyaltyAdminActor(userId: string, tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<LoyaltyAdminActor> {
  const actor = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      name: true,
      email: true,
    },
  });

  if (!actor || (actor.role !== Role.ADMIN && actor.role !== Role.MASTER_ADMIN)) {
    throw new Error("LOYALTY_ADMIN_FORBIDDEN");
  }

  return actor as LoyaltyAdminActor;
}

async function writeLoyaltyAuditLog(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    actionType: "LOYALTY_PROGRAM_UPSERT" | "LOYALTY_MANUAL_GRANT";
    entityType: "LoyaltyProgram" | "LoyaltyPointsLedgerEntry";
    entityId: string;
    metadata: Prisma.InputJsonValue;
  },
) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
    },
  });
}

export async function upsertLoyaltyProgramSettingsByAdmin(input: {
  actorUserId: string;
  currencyCode: string;
  isActive: boolean;
  earningPoints: number;
  earningAmountMinor: number;
  pointsExpireAfterDays: number;
  expirationReminderDays: number | null;
  maxManualGrantPoints: number;
  eligibleProductIds: string[];
}) {
  const parsed = programSettingsSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const actor = await resolveLoyaltyAdminActor(parsed.actorUserId, tx);
    const before = await getLoyaltyProgramForCurrency(parsed.currencyCode, tx);

    const program = await upsertLoyaltyProgramSettings({
      ...parsed,
      prismaClient: tx,
    });

    await writeLoyaltyAuditLog(tx, {
      actorId: actor.id,
      actionType: "LOYALTY_PROGRAM_UPSERT",
      entityType: "LoyaltyProgram",
      entityId: program.id,
      metadata: {
        currencyCode: program.currencyCode,
        actorRole: actor.role,
        before: before
          ? {
              isActive: before.isActive,
              earningPoints: before.earningPoints,
              earningAmountMinor: before.earningAmountMinor,
              pointsExpireAfterDays: before.pointsExpireAfterDays,
              expirationReminderDays: before.expirationReminderDays,
              maxManualGrantPoints: before.maxManualGrantPoints,
              eligibleProductIds: before.eligibleProducts.map((entry) => entry.productId),
            }
          : null,
        after: {
          isActive: program.isActive,
          earningPoints: program.earningPoints,
          earningAmountMinor: program.earningAmountMinor,
          pointsExpireAfterDays: program.pointsExpireAfterDays,
          expirationReminderDays: program.expirationReminderDays,
          maxManualGrantPoints: program.maxManualGrantPoints,
          eligibleProductIds: program.eligibleProducts.map((entry) => entry.productId),
        },
      },
    });

    return program;
  });
}

export async function grantManualLoyaltyPointsByAdmin(input: {
  actorUserId: string;
  clientId: string;
  currencyCode: string;
  amountPoints: number;
  reason: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  const parsed = manualGrantSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const actor = await resolveLoyaltyAdminActor(parsed.actorUserId, tx);
    const result = await grantManualLoyaltyPoints({
      actor: { type: "USER", userId: actor.id, role: actor.role },
      clientId: parsed.clientId,
      currencyCode: input.currencyCode,
      amountPoints: parsed.amountPoints,
      reason: parsed.reason,
      idempotencyKey: parsed.idempotencyKey,
      metadata: parsed.metadata,
      prismaClient: tx,
    });

    if (result.outcome === "created") {
      await writeLoyaltyAuditLog(tx, {
        actorId: actor.id,
        actionType: "LOYALTY_MANUAL_GRANT",
        entityType: "LoyaltyPointsLedgerEntry",
        entityId: result.entry.id,
        metadata: {
          actorRole: actor.role,
          clientId: parsed.clientId,
          amountPoints: parsed.amountPoints,
          reason: parsed.reason,
          metadata: (parsed.metadata ?? null) as Prisma.InputJsonValue | null,
        } satisfies Prisma.InputJsonObject,
      });
    }

    return result;
  });
}

export async function getAdminLoyaltyClientDetails(input: {
  actorUserId: string;
  clientId: string;
  currencyCode: string;
  historyLimit?: number;
}) {
  const actor = await resolveLoyaltyAdminActor(input.actorUserId);

  const [summary, history] = await Promise.all([
    getClientLoyaltySummary({
      actor: { type: "ADMIN", userId: actor.id, role: actor.role },
      clientId: input.clientId,
      currencyCode: input.currencyCode,
    }),
    listClientLoyaltyHistory({
      actor: { type: "ADMIN", userId: actor.id, role: actor.role },
      clientId: input.clientId,
      currencyCode: input.currencyCode,
      limit: input.historyLimit,
    }),
  ]);

  return { summary, history };
}

export async function listAdminLoyaltyClientsByActor(input: {
  actorUserId: string;
  currencyCode: string;
  page?: number;
  pageSize?: number;
  query?: string;
}) {
  await resolveLoyaltyAdminActor(input.actorUserId);
  return listAdminLoyaltyClients({
    currencyCode: input.currencyCode,
    page: input.page,
    pageSize: input.pageSize,
    query: input.query,
  });
}

export { resolveLoyaltyAdminActor };
