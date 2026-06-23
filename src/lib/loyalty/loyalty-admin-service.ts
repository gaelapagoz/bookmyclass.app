import { Prisma, Role } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  archiveLoyaltyRewardDefinition,
  listEligibleLoyaltyProductsForCurrency,
  listLoyaltyPrograms,
  resolvePrimaryLoyaltyCurrencyCode,
  upsertLoyaltyRewardDefinition,
  upsertLoyaltyProgramSettings,
  getLoyaltyProgramForCurrency,
  isMissingLoyaltyTableError,
} from "./loyalty-program-service";
import { grantManualLoyaltyPoints } from "./loyalty-points-service";
import { getLoyaltyCreditBalance, listActiveLoyaltyRewards } from "./loyalty-redemption-service";
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

const rewardDefinitionSchema = z.object({
  actorUserId: z.string().trim().min(1),
  programId: z.string().trim().min(1),
  rewardDefinitionId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  pointsRequired: z.number().int().positive(),
  amountMinor: z.number().int().positive(),
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

export async function saveLoyaltyRewardDefinitionByAdmin(input: {
  actorUserId: string;
  programId: string;
  rewardDefinitionId?: string;
  name: string;
  pointsRequired: number;
  amountMinor: number;
}) {
  const parsed = rewardDefinitionSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const actor = await resolveLoyaltyAdminActor(parsed.actorUserId, tx);
    const before = parsed.rewardDefinitionId
      ? await tx.loyaltyRewardDefinition.findUnique({
          where: { id: parsed.rewardDefinitionId },
        })
      : null;
    const reward = await upsertLoyaltyRewardDefinition({
      ...parsed,
      prismaClient: tx,
    });

    await writeLoyaltyAuditLog(tx, {
      actorId: actor.id,
      actionType: "LOYALTY_PROGRAM_UPSERT",
      entityType: "LoyaltyProgram",
      entityId: parsed.programId,
      metadata: {
        actorRole: actor.role,
        rewardAction: before ? "update" : "create",
        before,
        after: reward,
      },
    });

    return reward;
  });
}

export async function archiveLoyaltyRewardDefinitionByAdmin(input: {
  actorUserId: string;
  programId: string;
  rewardDefinitionId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const actor = await resolveLoyaltyAdminActor(input.actorUserId, tx);
    const before = await tx.loyaltyRewardDefinition.findFirst({
      where: {
        id: input.rewardDefinitionId,
        programId: input.programId,
      },
    });
    const reward = await archiveLoyaltyRewardDefinition({
      programId: input.programId,
      rewardDefinitionId: input.rewardDefinitionId,
      prismaClient: tx,
    });

    await writeLoyaltyAuditLog(tx, {
      actorId: actor.id,
      actionType: "LOYALTY_PROGRAM_UPSERT",
      entityType: "LoyaltyProgram",
      entityId: reward.programId,
      metadata: {
        actorRole: actor.role,
        rewardAction: "archive",
        before,
        after: reward,
      },
    });

    return reward;
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
  const loyaltyCredit = await getLoyaltyCreditBalance({
    clientId: input.clientId,
    currencyCode: input.currencyCode,
  });

  return { summary, history, loyaltyCredit };
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

export async function resolveAdminLoyaltyClientIdByEmail(input: {
  actorUserId: string;
  email: string;
}) {
  await resolveLoyaltyAdminActor(input.actorUserId);

  const email = input.email.trim();
  if (!email) {
    throw new Error("LOYALTY_CLIENT_REQUIRED");
  }

  const client = await prisma.user.findFirst({
    where: {
      role: Role.CLIENT,
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      email: true,
    },
  });

  if (!client) {
    throw new Error("LOYALTY_CLIENT_REQUIRED");
  }

  return client;
}

async function getAdminLoyaltyOverviewMetrics(currencyCode: string) {
  try {
    const [clientRows, groupedPoints] = await Promise.all([
      prisma.loyaltyPointsLedgerEntry.groupBy({
        by: ["clientId"],
        where: { currencyCode },
      }),
      prisma.loyaltyPointsLedgerEntry.groupBy({
        by: ["entryType"],
        where: { currencyCode },
        _sum: { amountPoints: true },
      }),
    ]);

    const totals = new Map(groupedPoints.map((item) => [item.entryType, item._sum.amountPoints ?? 0]));

    return {
      totalClients: clientRows.length,
      totalEarnedPoints: totals.get("EARN") ?? 0,
      totalManualGrantPoints: totals.get("MANUAL_GRANT") ?? 0,
      totalBalancePoints: groupedPoints.reduce((sum, item) => sum + (item._sum.amountPoints ?? 0), 0),
    };
  } catch (error) {
    if (!isMissingLoyaltyTableError(error)) {
      throw error;
    }

    return {
      totalClients: 0,
      totalEarnedPoints: 0,
      totalManualGrantPoints: 0,
      totalBalancePoints: 0,
    };
  }
}

export async function getAdminLoyaltyOverview(input: {
  actorUserId: string;
  currencyCode?: string;
  page?: number;
  pageSize?: number;
  query?: string;
  selectedClientId?: string | null;
  historyLimit?: number;
}) {
  await resolveLoyaltyAdminActor(input.actorUserId);

  const currencyCode = (input.currencyCode?.trim().toUpperCase() || await resolvePrimaryLoyaltyCurrencyCode());
  const [programs, program, eligibleProducts, clients, selectedClient, metrics] = await Promise.all([
    listLoyaltyPrograms(),
    getLoyaltyProgramForCurrency(currencyCode),
    listEligibleLoyaltyProductsForCurrency(currencyCode),
    listAdminLoyaltyClientsByActor({
      actorUserId: input.actorUserId,
      currencyCode,
      page: input.page,
      pageSize: input.pageSize,
      query: input.query,
    }),
    input.selectedClientId
      ? getAdminLoyaltyClientDetails({
          actorUserId: input.actorUserId,
          clientId: input.selectedClientId,
          currencyCode,
          historyLimit: input.historyLimit,
        })
      : Promise.resolve(null),
    getAdminLoyaltyOverviewMetrics(currencyCode),
  ]);
  const rewards = await listActiveLoyaltyRewards({ currencyCode }).catch(() => []);

  return {
    currencyCode,
    programs,
    program,
    rewards,
    eligibleProducts,
    clients,
    selectedClient,
    metrics,
  };
}

export { resolveLoyaltyAdminActor };
