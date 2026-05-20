import {
  GiftCardCodeStatus,
  GiftCardLedgerEntryType,
  type GiftCardLedgerEntry,
  GiftCardReconciliationStatus,
  type GiftCardReconciliationCase,
  type GiftCardRedemption,
  GiftCardRedemptionStatus,
  type GiftCardWallet,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProductType,
  Role,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { emitGiftCardAlertEvent } from "./gift-card-events";

export const GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER =
  "Operational note only. This does not adjust wallet balance or payment state.";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type AdminActor = {
  readonly userId: string;
  readonly role: Role;
};

type PageInput = {
  readonly page?: number;
  readonly pageSize?: number;
};

type ReconciliationListStatus = GiftCardReconciliationStatus | "ALL";

function normalizePage(input: PageInput) {
  const page = Number.isInteger(input.page) && input.page && input.page > 0
    ? input.page
    : 1;
  const requestedPageSize = Number.isInteger(input.pageSize) && input.pageSize
    ? input.pageSize
    : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(Math.max(requestedPageSize, 1), MAX_PAGE_SIZE);

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  };
}

function assertAdmin(actor: AdminActor): void {
  if (actor.role !== Role.ADMIN && actor.role !== Role.MASTER_ADMIN) {
    throw new Error("GIFT_CARD_ADMIN_FORBIDDEN");
  }
}

function assertMasterAdmin(actor: AdminActor): void {
  if (actor.role !== Role.MASTER_ADMIN) {
    throw new Error("GIFT_CARD_MASTER_ADMIN_REQUIRED");
  }
}

function metadataObject(value: Prisma.JsonValue | null): Prisma.JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function settledAmount(entries: ReadonlyArray<{ entryType: GiftCardLedgerEntryType; amountMinor: number }>) {
  return entries.reduce((total, entry) => {
    if (entry.entryType === GiftCardLedgerEntryType.ACTIVATION) {
      return total + entry.amountMinor;
    }
    if (entry.entryType === GiftCardLedgerEntryType.CAPTURE) {
      return total - entry.amountMinor;
    }
    return total;
  }, 0);
}

function duplicateLedgerReasons(entries: ReadonlyArray<{
  entryType: GiftCardLedgerEntryType;
  orderItemId: string | null;
  redemptionId: string | null;
}>) {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    if (entry.entryType === GiftCardLedgerEntryType.ACTIVATION && entry.orderItemId) {
      const key = `ACTIVATION:${entry.orderItemId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (
      (entry.entryType === GiftCardLedgerEntryType.CAPTURE ||
        entry.entryType === GiftCardLedgerEntryType.RELEASE) &&
      entry.redemptionId
    ) {
      const key = `${entry.entryType}:${entry.redemptionId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => `DUPLICATE_${key}`);
}

function hasSucceededPayments(payments: ReadonlyArray<{ status: PaymentStatus }>) {
  return payments.some((payment) => payment.status === PaymentStatus.SUCCEEDED);
}

function serializeWallet(wallet: GiftCardWallet & {
  readonly reservedAmountMinor?: number;
  readonly availableBalanceMinor?: number;
}) {
  return {
    id: wallet.id,
    clientId: wallet.clientId,
    currencyCode: wallet.currencyCode,
    balanceMinor: wallet.balanceMinor,
    status: wallet.status,
    reservedAmountMinor: wallet.reservedAmountMinor,
    availableBalanceMinor: wallet.availableBalanceMinor,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

function serializeLedgerEntry(entry: GiftCardLedgerEntry) {
  return {
    id: entry.id,
    walletId: entry.walletId,
    clientId: entry.clientId,
    entryType: entry.entryType,
    amountMinor: entry.amountMinor,
    currencyCode: entry.currencyCode,
    orderId: entry.orderId,
    orderItemId: entry.orderItemId,
    paymentId: entry.paymentId,
    redemptionId: entry.redemptionId,
    happenedAt: entry.happenedAt,
    createdAt: entry.createdAt,
  };
}

function serializeRedemption(redemption: GiftCardRedemption) {
  return {
    id: redemption.id,
    walletId: redemption.walletId,
    clientId: redemption.clientId,
    orderId: redemption.orderId,
    status: redemption.status,
    reservedAmountMinor: redemption.reservedAmountMinor,
    capturedAmountMinor: redemption.capturedAmountMinor,
    releasedAmountMinor: redemption.releasedAmountMinor,
    currencyCode: redemption.currencyCode,
    expiresAt: redemption.expiresAt,
    retryCount: redemption.retryCount,
    lastRetryAt: redemption.lastRetryAt,
    createdAt: redemption.createdAt,
    updatedAt: redemption.updatedAt,
  };
}

type GiftCardCodeRow = {
  id: string;
  maskedCode: string;
  amountMinor: number;
  currencyCode: string;
  status: GiftCardCodeStatus;
  issuedAt: Date;
  redeemedAt: Date | null;
  expiresAt: Date | null;
  purchasedBy: { id: string; name: string | null; email: string } | null;
  redeemedBy: { id: string; name: string | null; email: string } | null;
};

function serializeGiftCardCode(row: GiftCardCodeRow) {
  return {
    id: row.id,
    maskedCode: row.maskedCode,
    amountMinor: row.amountMinor,
    currencyCode: row.currencyCode,
    status: row.status,
    issuedAt: row.issuedAt,
    redeemedAt: row.redeemedAt,
    expiresAt: row.expiresAt,
    purchasedBy: row.purchasedBy
      ? { id: row.purchasedBy.id, name: row.purchasedBy.name, email: row.purchasedBy.email }
      : null,
    redeemedBy: row.redeemedBy
      ? { id: row.redeemedBy.id, name: row.redeemedBy.name, email: row.redeemedBy.email }
      : null,
  };
}

function serializeReconciliationCase(caseRecord: GiftCardReconciliationCase) {
  return {
    id: caseRecord.id,
    orderId: caseRecord.orderId,
    clientId: caseRecord.clientId,
    walletId: caseRecord.walletId,
    redemptionId: caseRecord.redemptionId,
    paymentId: caseRecord.paymentId,
    status: caseRecord.status,
    reason: caseRecord.reason,
    retryCount: caseRecord.retryCount,
    lastRetryAt: caseRecord.lastRetryAt,
    resolvedAt: caseRecord.resolvedAt,
    resolvedById: caseRecord.resolvedById,
    resolutionNote: caseRecord.resolutionNote,
    createdAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt,
  };
}

export async function listAdminGiftCardReconciliationCases(input: {
  readonly actor: AdminActor;
  readonly status?: ReconciliationListStatus;
} & PageInput) {
  assertAdmin(input.actor);
  const { page, pageSize, skip } = normalizePage(input);
  const where: Prisma.GiftCardReconciliationCaseWhereInput =
    input.status && input.status !== "ALL"
      ? { status: input.status }
      : input.status === "ALL"
        ? {}
        : { status: { not: GiftCardReconciliationStatus.RESOLVED } };

  const [items, totalItems] = await prisma.$transaction([
    prisma.giftCardReconciliationCase.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
      include: {
        client: { select: { id: true, name: true, email: true } },
        order: { select: { id: true, status: true, totalAmountMinor: true, currencyCode: true } },
        payment: { select: { id: true, status: true, method: true, amountMinor: true } },
        wallet: { select: { id: true, balanceMinor: true, currencyCode: true, status: true } },
        redemption: { select: { id: true, status: true, reservedAmountMinor: true } },
      },
    }),
    prisma.giftCardReconciliationCase.count({ where }),
  ]);

  return {
    items: items.map((item) => ({
      ...serializeReconciliationCase(item),
      client: item.client,
      order: item.order,
      payment: item.payment,
      wallet: item.wallet,
      redemption: item.redemption,
    })),
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    metadata: {
      resolutionNoteDisclaimer: GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER,
      resolvedCasesHiddenByDefault: !input.status,
    },
  };
}

export async function getAdminGiftCardWalletLookup(input: {
  readonly actor: AdminActor;
  readonly clientId: string;
} & PageInput) {
  assertAdmin(input.actor);
  const { page, pageSize, skip } = normalizePage(input);
  const client = await prisma.user.findUnique({
    where: { id: input.clientId },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!client || client.role !== Role.CLIENT) {
    throw new Error("GIFT_CARD_CLIENT_NOT_FOUND");
  }

  const wallet = await prisma.giftCardWallet.findUnique({
    where: { clientId_currencyCode: { clientId: input.clientId, currencyCode: "EUR" } },
  });

  if (!wallet) {
    return {
      client,
      wallet: null,
      ledgerEntries: [],
      redemptions: [],
      reconciliationCases: [],
      pagination: { page, pageSize, totalItems: 0, totalPages: 1 },
    };
  }

  const [reservedAggregate, ledgerEntries, totalLedgerEntries, redemptions, reconciliationCases, giftCardCodes] =
    await prisma.$transaction([
      prisma.giftCardRedemption.aggregate({
        where: { walletId: wallet.id, status: GiftCardRedemptionStatus.RESERVED },
        _sum: { reservedAmountMinor: true },
      }),
      prisma.giftCardLedgerEntry.findMany({
        where: { walletId: wallet.id },
        orderBy: [{ happenedAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      }),
      prisma.giftCardLedgerEntry.count({ where: { walletId: wallet.id } }),
      prisma.giftCardRedemption.findMany({
        where: { walletId: wallet.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
      }),
      prisma.giftCardReconciliationCase.findMany({
        where: { walletId: wallet.id, status: { not: GiftCardReconciliationStatus.RESOLVED } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
      }),
      prisma.giftCardCode.findMany({
        where: { redeemedById: input.clientId },
        orderBy: [{ redeemedAt: "desc" }, { issuedAt: "desc" }],
        take: 50,
        select: {
          id: true,
          maskedCode: true,
          amountMinor: true,
          currencyCode: true,
          status: true,
          issuedAt: true,
          redeemedAt: true,
          expiresAt: true,
          purchasedBy: { select: { id: true, name: true, email: true } },
          redeemedBy: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

  const reservedAmountMinor = reservedAggregate._sum.reservedAmountMinor ?? 0;

  return {
    client,
    wallet: serializeWallet({
      ...wallet,
      reservedAmountMinor,
      availableBalanceMinor: wallet.balanceMinor - reservedAmountMinor,
    }),
    ledgerEntries: ledgerEntries.map(serializeLedgerEntry),
    redemptions: redemptions.map(serializeRedemption),
    reconciliationCases: reconciliationCases.map(serializeReconciliationCase),
    giftCardCodes: giftCardCodes.map(serializeGiftCardCode),
    pagination: {
      page,
      pageSize,
      totalItems: totalLedgerEntries,
      totalPages: Math.max(1, Math.ceil(totalLedgerEntries / pageSize)),
    },
  };
}

export async function listAdminIssuedGiftCardCodes(input: {
  readonly actor: AdminActor;
  readonly recipientEmail?: string;
} & PageInput) {
  assertAdmin(input.actor);
  const { page, pageSize, skip } = normalizePage(input);
  const recipientEmail = input.recipientEmail?.trim() ?? "";
  const where: Prisma.GiftCardCodeWhereInput = recipientEmail
    ? { recipientEmail: { contains: recipientEmail, mode: "insensitive" } }
    : {};

  const [items, totalItems] = await prisma.$transaction([
    prisma.giftCardCode.findMany({
      where,
      orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        status: true,
        amountMinor: true,
        currencyCode: true,
        recipientEmail: true,
        source: true,
        issuedAt: true,
        redeemedAt: true,
        maskedCode: true,
        emailStatus: true,
        purchasedBy: { select: { id: true, name: true, email: true } },
        generatedBy: { select: { id: true, name: true, email: true } },
        redeemedBy: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.giftCardCode.count({ where }),
  ]);

  return {
    items,
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

export async function listAdminGiftCardWalletBalances(input: {
  readonly actor: AdminActor;
  readonly query?: string;
} & PageInput) {
  assertAdmin(input.actor);
  const { page, pageSize, skip } = normalizePage(input);
  const query = input.query?.trim() ?? "";

  const where: Prisma.GiftCardWalletWhereInput = query.length > 0
    ? {
        client: {
          role: Role.CLIENT,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        },
      }
    : { client: { role: Role.CLIENT } };

  const [wallets, totalItems] = await prisma.$transaction([
    prisma.giftCardWallet.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        clientId: true,
        currencyCode: true,
        balanceMinor: true,
        updatedAt: true,
        client: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        ledgerEntries: {
          where: { entryType: GiftCardLedgerEntryType.ACTIVATION },
          select: { happenedAt: true },
          orderBy: [{ happenedAt: "desc" }],
        },
      },
    }),
    prisma.giftCardWallet.count({ where }),
  ]);

  const items: Array<{
    walletId: string;
    client: { id: string; name: string | null; email: string };
    currencyCode: string;
    balanceMinor: number;
    activeGiftCards: number;
    lastActivityAt: Date;
  }> = [];

  for (const wallet of wallets) {
    const activeGiftCards = await prisma.giftCardCode.count({
      where: {
        redeemedById: wallet.clientId,
        status: GiftCardCodeStatus.REDEEMED,
      },
    });
    const lastActivityAt = wallet.ledgerEntries[0]?.happenedAt ?? wallet.updatedAt;
    items.push({
      walletId: wallet.id,
      client: wallet.client,
      currencyCode: wallet.currencyCode,
      balanceMinor: wallet.balanceMinor,
      activeGiftCards,
      lastActivityAt,
    });
  }

  return {
    items,
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

export async function addGiftCardReconciliationNote(input: {
  readonly actor: AdminActor;
  readonly caseId: string;
  readonly note: string;
}) {
  assertAdmin(input.actor);
  const note = input.note.trim();
  if (!note) {
    throw new Error("GIFT_CARD_RESOLUTION_NOTE_REQUIRED");
  }

  const existing = await prisma.giftCardReconciliationCase.findUnique({
    where: { id: input.caseId },
    select: { metadata: true },
  });
  if (!existing) {
    throw new Error("GIFT_CARD_RECONCILIATION_NOT_FOUND");
  }

  const updated = await prisma.giftCardReconciliationCase.update({
    where: { id: input.caseId },
    data: {
      resolutionNote: note,
      metadata: {
        ...metadataObject(existing.metadata),
        resolutionNoteDisclaimer: GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER,
        noteUpdatedById: input.actor.userId,
        noteUpdatedAt: new Date().toISOString(),
      },
    },
  });

  return serializeReconciliationCase(updated);
}

export async function verifyGiftCardReconciliationConsistency(caseId: string): Promise<{
  readonly ok: boolean;
  readonly reasons: string[];
}> {
  const reconciliationCase = await prisma.giftCardReconciliationCase.findUnique({
    where: { id: caseId },
    include: {
      wallet: true,
      redemption: true,
      order: {
        include: {
          payments: true,
          items: { include: { product: { select: { productType: true } } } },
        },
      },
      payment: true,
    },
  });

  if (!reconciliationCase) {
    return { ok: false, reasons: ["CASE_NOT_FOUND"] };
  }

  const reasons: string[] = [];
  if (!reconciliationCase.wallet) {
    reasons.push("WALLET_MISSING");
    return { ok: false, reasons };
  }

  const entries = await prisma.giftCardLedgerEntry.findMany({
    where: { walletId: reconciliationCase.wallet.id },
    select: {
      entryType: true,
      amountMinor: true,
      orderId: true,
      orderItemId: true,
      paymentId: true,
      redemptionId: true,
    },
  });

  const derivedBalance = settledAmount(entries);
  if (derivedBalance !== reconciliationCase.wallet.balanceMinor) {
    reasons.push("WALLET_BALANCE_MISMATCH");
  }

  const reservedAggregate = await prisma.giftCardRedemption.aggregate({
    where: { walletId: reconciliationCase.wallet.id, status: GiftCardRedemptionStatus.RESERVED },
    _sum: { reservedAmountMinor: true },
  });
  const availableBalanceMinor =
    reconciliationCase.wallet.balanceMinor - (reservedAggregate._sum.reservedAmountMinor ?? 0);
  if (availableBalanceMinor < 0) {
    reasons.push("AVAILABLE_BALANCE_NEGATIVE");
  }

  reasons.push(...duplicateLedgerReasons(entries));

  if (reconciliationCase.payment && reconciliationCase.payment.orderId !== reconciliationCase.orderId) {
    reasons.push("PAYMENT_ORDER_MISMATCH");
  }

  const succeededPayments = hasSucceededPayments(reconciliationCase.order.payments);
  if (succeededPayments && reconciliationCase.order.status !== OrderStatus.PAID) {
    reasons.push("ORDER_STATUS_INVALID_FOR_SUCCEEDED_PAYMENT");
  }
  if (reconciliationCase.order.status === OrderStatus.PAID && !succeededPayments) {
    reasons.push("ORDER_PAID_WITHOUT_SUCCEEDED_PAYMENT");
  }
  if (
    reconciliationCase.order.status === OrderStatus.PAID &&
    reconciliationCase.order.payments.some((payment) => payment.status === PaymentStatus.FAILED)
  ) {
    reasons.push("ORDER_PAID_WITH_FAILED_PAYMENT");
  }

  const giftCardPayment = reconciliationCase.order.payments.find(
    (payment) => payment.method === PaymentMethod.GIFT_CARD,
  );
  const redemption = reconciliationCase.redemption;

  if (redemption) {
    const redemptionEntries = entries.filter((entry) => entry.redemptionId === redemption.id);
    if (!redemptionEntries.some((entry) => entry.entryType === GiftCardLedgerEntryType.RESERVE)) {
      reasons.push("REDEMPTION_RESERVE_LEDGER_MISSING");
    }
    if (
      redemption.status === GiftCardRedemptionStatus.CAPTURED &&
      !redemptionEntries.some((entry) => entry.entryType === GiftCardLedgerEntryType.CAPTURE)
    ) {
      reasons.push("REDEMPTION_CAPTURE_LEDGER_MISSING");
    }
    if (
      redemption.status === GiftCardRedemptionStatus.RELEASED &&
      !redemptionEntries.some((entry) => entry.entryType === GiftCardLedgerEntryType.RELEASE)
    ) {
      reasons.push("REDEMPTION_RELEASE_LEDGER_MISSING");
    }
    if (redemption.status === GiftCardRedemptionStatus.CAPTURED && giftCardPayment?.status !== PaymentStatus.SUCCEEDED) {
      reasons.push("GIFT_CARD_PAYMENT_NOT_SUCCEEDED_FOR_CAPTURE");
    }
    if (redemption.status === GiftCardRedemptionStatus.CAPTURED && reconciliationCase.order.status !== OrderStatus.PAID) {
      reasons.push("CAPTURED_REDEMPTION_ORDER_NOT_PAID");
    }
    if (redemption.status === GiftCardRedemptionStatus.RESERVED && reconciliationCase.order.status === OrderStatus.PAID) {
      reasons.push("PAID_ORDER_HAS_RESERVED_REDEMPTION");
    }
    if (redemption.status === GiftCardRedemptionStatus.RESERVED && giftCardPayment?.status !== PaymentStatus.PENDING) {
      reasons.push("RESERVED_REDEMPTION_PAYMENT_NOT_PENDING");
    }
    if (redemption.status === GiftCardRedemptionStatus.RELEASED && giftCardPayment?.status !== PaymentStatus.FAILED) {
      reasons.push("RELEASED_REDEMPTION_PAYMENT_NOT_FAILED");
    }
    if (redemption.status === GiftCardRedemptionStatus.RELEASED && reconciliationCase.order.status === OrderStatus.PAID) {
      reasons.push("RELEASED_REDEMPTION_ORDER_PAID");
    }
  }

  const giftCardOrderItems = reconciliationCase.order.items.filter(
    (item) => item.product.productType === ProductType.GIFT_CARD,
  );
  if (reconciliationCase.order.status === OrderStatus.PAID && giftCardOrderItems.length > 0) {
    for (const item of giftCardOrderItems) {
      const activationCount = entries.filter(
        (entry) =>
          entry.entryType === GiftCardLedgerEntryType.ACTIVATION &&
          entry.orderItemId === item.id,
      ).length;
      if (activationCount === 0) {
        reasons.push(`ACTIVATION_LEDGER_MISSING:${item.id}`);
      }
      if (activationCount > 1) {
        reasons.push(`ACTIVATION_LEDGER_DUPLICATE:${item.id}`);
      }
    }
  }

  if (reconciliationCase.reason.includes("IDEMPOTENCY_CONFLICT")) {
    reasons.push("UNRESOLVED_IDEMPOTENCY_CONFLICT");
  }

  return { ok: reasons.length === 0, reasons };
}

export async function resolveGiftCardManualReviewCase(input: {
  readonly actor: AdminActor;
  readonly caseId: string;
  readonly note: string;
}) {
  assertMasterAdmin(input.actor);
  const note = input.note.trim();
  if (!note) {
    throw new Error("GIFT_CARD_RESOLUTION_NOTE_REQUIRED");
  }

  const reconciliationCase = await prisma.giftCardReconciliationCase.findUnique({
    where: { id: input.caseId },
    select: { id: true, status: true, metadata: true },
  });
  if (!reconciliationCase) {
    throw new Error("GIFT_CARD_RECONCILIATION_NOT_FOUND");
  }
  if (reconciliationCase.status === GiftCardReconciliationStatus.RESOLVED) {
    throw new Error("GIFT_CARD_RECONCILIATION_ALREADY_RESOLVED");
  }
  if (reconciliationCase.status !== GiftCardReconciliationStatus.MANUAL_REVIEW) {
    throw new Error("GIFT_CARD_MANUAL_REVIEW_REQUIRED");
  }

  const verification = await verifyGiftCardReconciliationConsistency(input.caseId);
  if (!verification.ok) {
    return {
      resolved: false,
      verification,
      metadata: { resolutionNoteDisclaimer: GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER },
    };
  }

  const resolved = await prisma.giftCardReconciliationCase.update({
    where: { id: input.caseId },
    data: {
      status: GiftCardReconciliationStatus.RESOLVED,
      resolvedAt: new Date(),
      resolvedById: input.actor.userId,
      resolutionNote: note,
      metadata: {
        ...metadataObject(reconciliationCase.metadata),
        resolutionNoteDisclaimer: GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER,
        resolvedById: input.actor.userId,
      },
    },
  });

  await emitGiftCardAlertEvent({
    eventName: "gift_card.reconciliation_resolved",
    entityType: "GiftCardReconciliationCase",
    entityId: resolved.id,
    metadata: {
      resolvedById: input.actor.userId,
      resolutionNoteDisclaimer: GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER,
    },
  });

  return {
    resolved: true,
    case: serializeReconciliationCase(resolved),
    verification,
    metadata: { resolutionNoteDisclaimer: GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER },
  };
}
