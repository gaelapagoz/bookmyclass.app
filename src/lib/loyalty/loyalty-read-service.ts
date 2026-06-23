import { LoyaltyPointsLedgerEntryType, Prisma, Role, UserActivationStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getLoyaltyProgramForCurrency, isMissingLoyaltyTableError } from "./loyalty-program-service";
import { LoyaltyPointsServiceError } from "./loyalty-points-service";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

type LoyaltyHistoryRecord = Prisma.LoyaltyPointsLedgerEntryGetPayload<{
  include: {
    createdBy: { select: { id: true; name: true; email: true; role: true } };
    sourceEntry: {
      select: {
        id: true;
        entryType: true;
        amountPoints: true;
        happenedAt: true;
      };
    };
  };
}>;

type LoyaltyAdminClientRecord = Prisma.UserGetPayload<{
  select: {
    id: true;
    name: true;
    email: true;
    isActive: true;
    isInactive: true;
    activationStatus: true;
  };
}>;

type LoyaltyReadActor =
  | { type: "CLIENT"; userId: string }
  | { type: "ADMIN"; userId: string; role: Role };

function normalizePage(input: { page?: number; pageSize?: number }) {
  const page = Number.isInteger(input.page) && input.page && input.page > 0 ? input.page : 1;
  const requestedPageSize = Number.isInteger(input.pageSize) && input.pageSize ? input.pageSize : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(Math.max(requestedPageSize, 1), MAX_PAGE_SIZE);

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  };
}

function normalizeHistoryLimit(limit?: number) {
  if (!Number.isInteger(limit) || !limit) {
    return DEFAULT_HISTORY_LIMIT;
  }
  return Math.min(Math.max(limit, 1), MAX_HISTORY_LIMIT);
}

async function resolveClient(clientId: string) {
  const client = await prisma.user.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      isInactive: true,
      activationStatus: true,
      emailVerified: true,
      emailVerifiedAt: true,
    },
  });

  if (!client || client.role !== Role.CLIENT) {
    throw new LoyaltyPointsServiceError("LOYALTY_CLIENT_REQUIRED", "Loyalty reads require a client record.");
  }
  if (!client.isActive || client.isInactive || client.activationStatus !== UserActivationStatus.ACTIVE) {
    throw new LoyaltyPointsServiceError("LOYALTY_CLIENT_NOT_ACTIVE", "Inactive clients do not have active loyalty visibility.");
  }
  if (!client.emailVerified && !client.emailVerifiedAt) {
    throw new LoyaltyPointsServiceError("LOYALTY_CLIENT_EMAIL_UNVERIFIED", "Verified clients are required for loyalty visibility.");
  }

  return client;
}

function assertReadOwnership(input: {
  actor: LoyaltyReadActor;
  clientId: string;
}) {
  if (input.actor.type === "ADMIN") {
    if (input.actor.role !== Role.ADMIN && input.actor.role !== Role.MASTER_ADMIN) {
      throw new LoyaltyPointsServiceError(
        "LOYALTY_ADMIN_REQUIRED",
        "Only admins may read loyalty records for other clients.",
      );
    }
    return;
  }

  if (input.actor.userId !== input.clientId) {
    throw new LoyaltyPointsServiceError(
      "LOYALTY_CLIENT_REQUIRED",
      "Clients may only read their own loyalty records.",
    );
  }
}

function summarizePositiveSourceBuckets(entries: Array<{
  id: string;
  amountPoints: number;
  expiresAt: Date | null;
  derivedEntries: Array<{ amountPoints: number }>;
}>) {
  let nextExpirationAt: Date | null = null;
  let expiringPoints = 0;

  for (const entry of entries) {
    if (!entry.expiresAt) {
      continue;
    }

    const remainingPoints = entry.amountPoints + entry.derivedEntries.reduce((total, derived) => total + Math.min(derived.amountPoints, 0), 0);
    if (remainingPoints <= 0) {
      continue;
    }

    if (!nextExpirationAt || entry.expiresAt < nextExpirationAt) {
      nextExpirationAt = entry.expiresAt;
      expiringPoints = remainingPoints;
      continue;
    }

    if (entry.expiresAt.getTime() === nextExpirationAt.getTime()) {
      expiringPoints += remainingPoints;
    }
  }

  return { expiringPoints, nextExpirationAt };
}

export async function getClientLoyaltySummary(input: {
  actor: LoyaltyReadActor;
  clientId: string;
  currencyCode: string;
}) {
  assertReadOwnership({ actor: input.actor, clientId: input.clientId });
  const { clientId, currencyCode } = input;
  const client = await resolveClient(clientId);

  let program = null;
  let aggregate: { _sum: { amountPoints: number | null }; _max: { happenedAt: Date | null } };
  let positiveSources: Array<{
    id: string;
    amountPoints: number;
    expiresAt: Date | null;
    derivedEntries: Array<{ amountPoints: number }>;
  }>;
  let balancesByType: Array<{ entryType: LoyaltyPointsLedgerEntryType; _sum: { amountPoints: number | null } }>;

  try {
    [program, aggregate, positiveSources] = await Promise.all([
      getLoyaltyProgramForCurrency(currencyCode),
      prisma.loyaltyPointsLedgerEntry.aggregate({
        where: { clientId, currencyCode },
        _sum: { amountPoints: true },
        _max: { happenedAt: true },
      }),
      prisma.loyaltyPointsLedgerEntry.findMany({
        where: {
          clientId,
          currencyCode,
          amountPoints: { gt: 0 },
        },
        select: {
          id: true,
          amountPoints: true,
          expiresAt: true,
          derivedEntries: {
            select: { amountPoints: true },
          },
        },
        orderBy: [{ expiresAt: "asc" }, { happenedAt: "asc" }],
      }),
    ]);

    const groupedBalances = await prisma.loyaltyPointsLedgerEntry.groupBy({
      by: ["entryType"],
      where: { clientId, currencyCode },
      _sum: { amountPoints: true },
    });
    balancesByType = groupedBalances as Array<{
      entryType: LoyaltyPointsLedgerEntryType;
      _sum: { amountPoints: number | null };
    }>;
  } catch (error) {
    if (!isMissingLoyaltyTableError(error)) {
      throw error;
    }

    aggregate = { _sum: { amountPoints: 0 }, _max: { happenedAt: null } };
    positiveSources = [];
    balancesByType = [];
  }

  const totals = new Map(balancesByType.map((item) => [item.entryType, item._sum.amountPoints ?? 0]));
  const { expiringPoints, nextExpirationAt } = summarizePositiveSourceBuckets(positiveSources);

  return {
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
    },
    program: program
      ? {
          currencyCode: program.currencyCode,
          isActive: program.isActive,
          earningPoints: program.earningPoints,
          earningAmountMinor: program.earningAmountMinor,
          pointsExpireAfterDays: program.pointsExpireAfterDays,
          expirationReminderDays: program.expirationReminderDays,
        }
      : null,
    balancePoints: aggregate._sum.amountPoints ?? 0,
    lifetimeEarnedPoints: totals.get(LoyaltyPointsLedgerEntryType.EARN) ?? 0,
    manualGrantPoints: totals.get(LoyaltyPointsLedgerEntryType.MANUAL_GRANT) ?? 0,
    reversedPoints: Math.abs(totals.get(LoyaltyPointsLedgerEntryType.REVERSAL) ?? 0),
    expiredPoints: Math.abs(totals.get(LoyaltyPointsLedgerEntryType.EXPIRE) ?? 0),
    expiringPoints,
    nextExpirationAt,
    lastActivityAt: aggregate._max.happenedAt ?? null,
  };
}

export async function listClientLoyaltyHistory(input: {
  actor: LoyaltyReadActor;
  clientId: string;
  currencyCode: string;
  limit?: number;
}) {
  assertReadOwnership({ actor: input.actor, clientId: input.clientId });
  await resolveClient(input.clientId);
  const limit = normalizeHistoryLimit(input.limit);

  let items: LoyaltyHistoryRecord[] = [];
  try {
    items = await prisma.loyaltyPointsLedgerEntry.findMany({
      where: { clientId: input.clientId, currencyCode: input.currencyCode },
      orderBy: [{ happenedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: {
        createdBy: { select: { id: true, name: true, email: true, role: true } },
        sourceEntry: {
          select: {
            id: true,
            entryType: true,
            amountPoints: true,
            happenedAt: true,
          },
        },
      },
    });
  } catch (error) {
    if (!isMissingLoyaltyTableError(error)) {
      throw error;
    }
    items = [];
  }

  return items.map((item) => ({
    id: item.id,
    entryType: item.entryType,
    amountPoints: item.amountPoints,
    currencyCode: item.currencyCode,
    orderId: item.orderId,
    paymentId: item.paymentId,
    sourceEntryId: item.sourceEntryId,
    reason: item.reason,
    metadata: item.metadata,
    happenedAt: item.happenedAt,
    expiresAt: item.expiresAt,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    sourceEntry: item.sourceEntry,
  }));
}

export async function listAdminLoyaltyClients(input: {
  currencyCode: string;
  page?: number;
  pageSize?: number;
  query?: string;
}) {
  const { page, pageSize, skip } = normalizePage(input);
  const query = input.query?.trim().slice(0, 120) ?? "";

  const where: Prisma.UserWhereInput = {
    role: Role.CLIENT,
    ...(query
      ? {
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
          ],
        }
      : { loyaltyPointsLedgerEntries: { some: { currencyCode: input.currencyCode } } }),
  };

  let clients: LoyaltyAdminClientRecord[] = [];
  let totalItems = 0;
  try {
    [clients, totalItems] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: [{ name: "asc" }, { email: "asc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          isInactive: true,
          activationStatus: true,
        },
      }),
      prisma.user.count({ where }),
    ]);
  } catch (error) {
    if (!isMissingLoyaltyTableError(error)) {
      throw error;
    }

    clients = query
      ? await prisma.user.findMany({
          where: {
            role: Role.CLIENT,
            OR: [
              { email: { contains: query, mode: "insensitive" } },
              { name: { contains: query, mode: "insensitive" } },
            ],
          },
          orderBy: [{ name: "asc" }, { email: "asc" }],
          skip,
          take: pageSize,
          select: {
            id: true,
            name: true,
            email: true,
            isActive: true,
            isInactive: true,
            activationStatus: true,
          },
        })
      : [];
    totalItems = clients.length;
  }

  const clientIds = clients.map((client) => client.id);
  const balances = clientIds.length > 0
    ? await prisma.loyaltyPointsLedgerEntry.groupBy({
        by: ["clientId"],
        where: { clientId: { in: clientIds }, currencyCode: input.currencyCode },
        _sum: { amountPoints: true },
        _max: { happenedAt: true },
      }).catch((error: unknown) => {
        if (!isMissingLoyaltyTableError(error)) {
          throw error;
        }
        return [];
      })
    : [];
  const balanceMap = new Map(
    balances.map((item) => [
      item.clientId,
      {
        balancePoints: item._sum.amountPoints ?? 0,
        lastActivityAt: item._max.happenedAt ?? null,
      },
    ]),
  );

  return {
    items: clients.map((client) => ({
      id: client.id,
      name: client.name,
      email: client.email,
      isActive: client.isActive,
      isInactive: client.isInactive,
      activationStatus: client.activationStatus,
      balancePoints: balanceMap.get(client.id)?.balancePoints ?? 0,
      lastActivityAt: balanceMap.get(client.id)?.lastActivityAt ?? null,
    })),
    page,
    pageSize,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
    query,
  };
}
