import {
  type GiftCardLedgerEntry,
  GiftCardCodeStatus,
  GiftCardLedgerEntryType,
  type GiftCardRedemption,
  GiftCardRedemptionStatus,
  type GiftCardWallet,
  GiftCardWalletStatus,
  Prisma,
  Role,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { giftCardError, giftCardErrorCodes, GiftCardIdempotencyConflictError } from "./gift-card-errors";
import { hashGiftCardPayload } from "./gift-card-payload-hash";
import { lockGiftCardWallet } from "./gift-card-wallet-lock";
import {
  GIFT_CARD_CURRENCY_CODE,
  GIFT_CARD_MAX_REDEMPTION_MINOR,
  GIFT_CARD_MAX_WALLET_BALANCE_MINOR,
  type GiftCardActor,
  type GiftCardRedemptionMutation,
  type GiftCardWalletBalance,
  type GiftCardWalletMutation,
} from "./gift-card-types";

type Tx = Prisma.TransactionClient;

type Metadata = Prisma.InputJsonValue;

type ActivateGiftCardInput = {
  readonly actor: GiftCardActor;
  readonly clientId: string;
  readonly orderId?: string;
  readonly orderItemId: string;
  readonly paymentId?: string;
  readonly amountMinor: number;
  readonly currencyCode?: string;
  readonly idempotencyKey: string;
  readonly metadata?: Metadata;
  readonly atomicMarkCodeRedeemed?: { codeId: string; redeemerUserId: string };
};

type ActivatePaidGiftCardOrderInput = {
  readonly actor: GiftCardActor;
  readonly clientId: string;
  readonly orderId: string;
  readonly paymentId?: string;
  readonly items: ReadonlyArray<{
    readonly orderItemId: string;
    readonly amountMinor: number;
  }>;
  readonly currencyCode?: string;
  readonly metadata?: Metadata;
};

type ReserveGiftCardInput = {
  readonly actor: GiftCardActor;
  readonly clientId: string;
  readonly orderId: string;
  readonly amountMinor: number;
  readonly currencyCode?: string;
  readonly expiresAt: Date;
  readonly idempotencyKey: string;
  readonly metadata?: Metadata;
};

type CaptureGiftCardInput = {
  readonly actor: GiftCardActor;
  readonly redemptionId: string;
  readonly paymentId?: string;
  readonly idempotencyKey: string;
  readonly metadata?: Metadata;
};

type ReleaseGiftCardInput = {
  readonly actor: GiftCardActor;
  readonly redemptionId: string;
  readonly idempotencyKey: string;
  readonly metadata?: Metadata;
};

function assertCurrency(currencyCode: string): void {
  if (currencyCode !== GIFT_CARD_CURRENCY_CODE) {
    throw giftCardError(giftCardErrorCodes.currencyUnsupported);
  }
}

function assertPositiveAmount(amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw giftCardError(giftCardErrorCodes.amountInvalid);
  }
}

function assertIdempotencyKey(idempotencyKey: string): void {
  if (!idempotencyKey.trim()) {
    throw giftCardError("GIFT_CARD_IDEMPOTENCY_KEY_REQUIRED");
  }
}

function actorMetadata(actor: GiftCardActor): Prisma.InputJsonObject {
  return actor.type === "SYSTEM"
    ? { actorType: actor.type, actorLabel: actor.label }
    : { actorType: actor.type, actorUserId: actor.userId, actorRole: actor.role };
}

async function getExistingLedgerByKey(tx: Tx, idempotencyKey: string, payloadHash: string) {
  const existing = await tx.giftCardLedgerEntry.findUnique({
    where: { idempotencyKey },
  });

  if (!existing) {
    return null;
  }

  if (existing.payloadHash !== payloadHash) {
    throw new GiftCardIdempotencyConflictError();
  }

  return existing;
}

function isRetryableMutationRace(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const rawCode = (error.meta as { code?: string } | undefined)?.code;
    return error.code === "P2002" || error.code === "P2010" || error.code === "P2034" || rawCode === "40001" || rawCode === "40P01" || rawCode === "23505";
  }

  const cause = (error as { cause?: { code?: string; originalCode?: string } })?.cause;
  const code = cause?.code ?? cause?.originalCode;
  return code === "40001" || code === "40P01" || code === "23505";
}

async function runGiftCardTransaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (attempt < maxAttempts && isRetryableMutationRace(error)) {
        continue;
      }
      throw error;
    }
  }

  throw giftCardError("GIFT_CARD_TRANSACTION_RETRY_EXHAUSTED");
}

async function getExistingRedemptionByKey(tx: Tx, idempotencyKey: string, payloadHash: string) {
  const existing = await tx.giftCardRedemption.findUnique({
    where: { idempotencyKey },
  });

  if (!existing) {
    return null;
  }

  if (existing.payloadHash !== payloadHash) {
    throw new GiftCardIdempotencyConflictError();
  }

  return existing;
}

async function assertClient(tx: Tx, clientId: string): Promise<void> {
  const client = await tx.user.findUnique({
    where: { id: clientId },
    select: { id: true, role: true },
  });

  if (!client || client.role !== Role.CLIENT) {
    throw giftCardError(giftCardErrorCodes.clientRequired);
  }
}

async function getOrCreateLockedWallet(tx: Tx, clientId: string, currencyCode: string) {
  await assertClient(tx, clientId);

  const existing = await tx.giftCardWallet.findUnique({
    where: { clientId_currencyCode: { clientId, currencyCode } },
  });

  if (existing) {
    await lockGiftCardWallet(tx, existing.id);
    const locked = await tx.giftCardWallet.findUniqueOrThrow({ where: { id: existing.id } });
    if (locked.status !== GiftCardWalletStatus.ACTIVE) {
      throw giftCardError(giftCardErrorCodes.walletSuspended);
    }
    return locked;
  }

  try {
    const created = await tx.giftCardWallet.create({
      data: {
        clientId,
        currencyCode,
        balanceMinor: 0,
        status: GiftCardWalletStatus.ACTIVE,
      },
    });
    await lockGiftCardWallet(tx, created.id);
    return created;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const wallet = await tx.giftCardWallet.findUniqueOrThrow({
        where: { clientId_currencyCode: { clientId, currencyCode } },
      });
      await lockGiftCardWallet(tx, wallet.id);
      const locked = await tx.giftCardWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      if (locked.status !== GiftCardWalletStatus.ACTIVE) {
        throw giftCardError(giftCardErrorCodes.walletSuspended);
      }
      return locked;
    }
    throw error;
  }
}

async function findActivationByOrderItem(tx: Tx, orderItemId: string): Promise<{ id: string } | null> {
  return tx.giftCardLedgerEntry.findFirst({
    where: {
      orderItemId,
      entryType: GiftCardLedgerEntryType.ACTIVATION,
    },
    select: { id: true },
  });
}

async function findReservedRedemptionByOrder(tx: Tx, orderId: string): Promise<{ id: string } | null> {
  return tx.giftCardRedemption.findFirst({
    where: {
      orderId,
      status: GiftCardRedemptionStatus.RESERVED,
    },
    select: { id: true },
  });
}

async function createLedgerEntry(
  tx: Tx,
  data: Prisma.GiftCardLedgerEntryUncheckedCreateInput,
): Promise<GiftCardLedgerEntry> {
  return tx.giftCardLedgerEntry.create({ data });
}

async function readLockedRedemptionWallet(tx: Tx, redemptionId: string): Promise<{
  redemption: GiftCardRedemption;
  wallet: GiftCardWallet;
}> {
  const snapshot = await tx.giftCardRedemption.findUniqueOrThrow({
    where: { id: redemptionId },
    select: { walletId: true },
  });
  await lockGiftCardWallet(tx, snapshot.walletId);

  const redemption = await tx.giftCardRedemption.findUniqueOrThrow({ where: { id: redemptionId } });
  const wallet = await tx.giftCardWallet.findUniqueOrThrow({ where: { id: redemption.walletId } });

  if (wallet.status !== GiftCardWalletStatus.ACTIVE) {
    throw giftCardError(giftCardErrorCodes.walletSuspended);
  }

  return { redemption, wallet };
}

async function getReservedAmount(tx: Tx, walletId: string): Promise<number> {
  const result = await tx.giftCardRedemption.aggregate({
    where: { walletId, status: GiftCardRedemptionStatus.RESERVED },
    _sum: { reservedAmountMinor: true },
  });

  return result._sum.reservedAmountMinor ?? 0;
}

// Re-exported from gift-card-wallet-read-service so callers outside the page layer
// can still import from here without pulling the node:crypto chain into client bundles.
export type {
  GiftCardLedgerHistoryEntry,
  GiftCardWalletWithHistory,
} from "./gift-card-wallet-read-service";
export {
  getGiftCardWalletWithHistory,
  getGiftCardWalletBalance,
} from "./gift-card-wallet-read-service";

export async function assertGiftCardWalletInvariant(walletId: string): Promise<GiftCardWalletBalance> {
  const wallet = await prisma.giftCardWallet.findUniqueOrThrow({ where: { id: walletId } });
  const entries = await prisma.giftCardLedgerEntry.findMany({
    where: { walletId },
    select: { entryType: true, amountMinor: true },
  });

  const settledBalance = entries.reduce((total, entry) => {
    if (entry.entryType === GiftCardLedgerEntryType.ACTIVATION) {
      return total + entry.amountMinor;
    }
    if (entry.entryType === GiftCardLedgerEntryType.CAPTURE) {
      return total - entry.amountMinor;
    }
    return total;
  }, 0);

  if (settledBalance !== wallet.balanceMinor) {
    throw giftCardError(giftCardErrorCodes.walletInvariantFailed);
  }

  const reservedAmountMinor = await getReservedAmount(prisma, wallet.id);
  return {
    walletId: wallet.id,
    balanceMinor: wallet.balanceMinor,
    reservedAmountMinor,
    availableBalanceMinor: wallet.balanceMinor - reservedAmountMinor,
    currencyCode: wallet.currencyCode,
  };
}

export async function activateGiftCardValue(input: ActivateGiftCardInput): Promise<GiftCardWalletMutation> {
  const currencyCode = input.currencyCode ?? GIFT_CARD_CURRENCY_CODE;
  assertCurrency(currencyCode);
  assertPositiveAmount(input.amountMinor);
  assertIdempotencyKey(input.idempotencyKey);
  if (!input.orderItemId.trim()) {
    throw giftCardError(giftCardErrorCodes.activationOrderItemRequired);
  }

  const payloadHash = hashGiftCardPayload({
    operation: "ACTIVATION",
    clientId: input.clientId,
    orderId: input.orderId,
    orderItemId: input.orderItemId,
    paymentId: input.paymentId,
    amountMinor: input.amountMinor,
    currencyCode,
  });

  return runGiftCardTransaction(async (tx) => {
    const existing = await getExistingLedgerByKey(tx, input.idempotencyKey, payloadHash);
    if (existing) {
      return {
        wallet: await tx.giftCardWallet.findUniqueOrThrow({ where: { id: existing.walletId } }),
        ledgerEntry: existing,
        idempotent: true,
      };
    }

    const duplicateActivation = await findActivationByOrderItem(tx, input.orderItemId);
    if (duplicateActivation) {
      throw giftCardError(giftCardErrorCodes.activationOrderItemAlreadyExists);
    }

    const wallet = await getOrCreateLockedWallet(tx, input.clientId, currencyCode);
    const lockedExisting = await getExistingLedgerByKey(tx, input.idempotencyKey, payloadHash);
    if (lockedExisting) {
      return {
        wallet: await tx.giftCardWallet.findUniqueOrThrow({ where: { id: lockedExisting.walletId } }),
        ledgerEntry: lockedExisting,
        idempotent: true,
      };
    }
    const lockedDuplicateActivation = await findActivationByOrderItem(tx, input.orderItemId);
    if (lockedDuplicateActivation) {
      throw giftCardError(giftCardErrorCodes.activationOrderItemAlreadyExists);
    }

    if (input.atomicMarkCodeRedeemed) {
      const updated = await tx.giftCardCode.updateMany({
        where: { id: input.atomicMarkCodeRedeemed.codeId, status: GiftCardCodeStatus.ISSUED },
        data: {
          status: GiftCardCodeStatus.REDEEMED,
          redeemedById: input.atomicMarkCodeRedeemed.redeemerUserId,
          redeemedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw giftCardError(giftCardErrorCodes.giftCardCodeConcurrentRedemption);
      }
    }

    if (wallet.balanceMinor + input.amountMinor > GIFT_CARD_MAX_WALLET_BALANCE_MINOR) {
      throw giftCardError(giftCardErrorCodes.walletCapExceeded);
    }

    const ledgerEntry = await createLedgerEntry(
      tx,
      {
        walletId: wallet.id,
        clientId: input.clientId,
        entryType: GiftCardLedgerEntryType.ACTIVATION,
        amountMinor: input.amountMinor,
        currencyCode,
        orderId: input.orderId,
        orderItemId: input.orderItemId,
        paymentId: input.paymentId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        metadata: { ...actorMetadata(input.actor), ...(input.metadata as Prisma.InputJsonObject | undefined) },
      },
    );
    const updatedWallet = await tx.giftCardWallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: input.amountMinor } },
    });

    return { wallet: updatedWallet, ledgerEntry, idempotent: false };
  });
}

export async function activatePaidGiftCardOrder(input: ActivatePaidGiftCardOrderInput): Promise<{
  readonly wallet: GiftCardWallet;
  readonly ledgerEntries: GiftCardLedgerEntry[];
  readonly idempotent: boolean;
}> {
  const currencyCode = input.currencyCode ?? GIFT_CARD_CURRENCY_CODE;
  assertCurrency(currencyCode);
  if (!input.orderId.trim()) {
    throw giftCardError("GIFT_CARD_ORDER_REQUIRED");
  }
  if (input.items.length < 1) {
    throw giftCardError(giftCardErrorCodes.activationOrderItemRequired);
  }

  const preparedItems = input.items.map((item) => {
    assertPositiveAmount(item.amountMinor);
    if (!item.orderItemId.trim()) {
      throw giftCardError(giftCardErrorCodes.activationOrderItemRequired);
    }
    const idempotencyKey = `gift-card:activation:orderItem:${item.orderItemId}`;
    assertIdempotencyKey(idempotencyKey);
    return {
      ...item,
      idempotencyKey,
      payloadHash: hashGiftCardPayload({
        operation: "ACTIVATION",
        clientId: input.clientId,
        orderId: input.orderId,
        orderItemId: item.orderItemId,
        paymentId: input.paymentId,
        amountMinor: item.amountMinor,
        currencyCode,
      }),
    };
  });

  return runGiftCardTransaction(async (tx) => {
    const wallet = await getOrCreateLockedWallet(tx, input.clientId, currencyCode);
    const ledgerEntries: GiftCardLedgerEntry[] = [];
    const itemsToActivate: typeof preparedItems = [];

    for (const item of preparedItems) {
      const existing = await getExistingLedgerByKey(tx, item.idempotencyKey, item.payloadHash);
      if (existing) {
        ledgerEntries.push(existing);
        continue;
      }

      const duplicateActivation = await findActivationByOrderItem(tx, item.orderItemId);
      if (duplicateActivation) {
        throw giftCardError(giftCardErrorCodes.activationOrderItemAlreadyExists);
      }

      itemsToActivate.push(item);
    }

    const activationTotalMinor = itemsToActivate.reduce(
      (total, item) => total + item.amountMinor,
      0,
    );
    if (wallet.balanceMinor + activationTotalMinor > GIFT_CARD_MAX_WALLET_BALANCE_MINOR) {
      throw giftCardError(giftCardErrorCodes.walletCapExceeded);
    }

    for (const item of itemsToActivate) {
      const ledgerEntry = await createLedgerEntry(tx, {
        walletId: wallet.id,
        clientId: input.clientId,
        entryType: GiftCardLedgerEntryType.ACTIVATION,
        amountMinor: item.amountMinor,
        currencyCode,
        orderId: input.orderId,
        orderItemId: item.orderItemId,
        paymentId: input.paymentId,
        idempotencyKey: item.idempotencyKey,
        payloadHash: item.payloadHash,
        metadata: { ...actorMetadata(input.actor), ...(input.metadata as Prisma.InputJsonObject | undefined) },
      });
      ledgerEntries.push(ledgerEntry);
    }

    const updatedWallet = activationTotalMinor > 0
      ? await tx.giftCardWallet.update({
          where: { id: wallet.id },
          data: { balanceMinor: { increment: activationTotalMinor } },
        })
      : wallet;

    return {
      wallet: updatedWallet,
      ledgerEntries,
      idempotent: itemsToActivate.length === 0,
    };
  });
}

export async function reserveGiftCardValue(input: ReserveGiftCardInput): Promise<GiftCardRedemptionMutation> {
  const currencyCode = input.currencyCode ?? GIFT_CARD_CURRENCY_CODE;
  assertCurrency(currencyCode);
  assertPositiveAmount(input.amountMinor);
  assertIdempotencyKey(input.idempotencyKey);
  if (input.amountMinor > GIFT_CARD_MAX_REDEMPTION_MINOR) {
    throw giftCardError(giftCardErrorCodes.amountInvalid);
  }

  const payloadHash = hashGiftCardPayload({
    operation: "RESERVE",
    clientId: input.clientId,
    orderId: input.orderId,
    amountMinor: input.amountMinor,
    currencyCode,
    expiresAt: input.expiresAt,
  });

  return runGiftCardTransaction(async (tx) => {
    const existingRedemption = await getExistingRedemptionByKey(tx, input.idempotencyKey, payloadHash);
    if (existingRedemption) {
      const ledgerEntry = await tx.giftCardLedgerEntry.findUniqueOrThrow({
        where: { idempotencyKey: input.idempotencyKey },
      });
      return {
        wallet: await tx.giftCardWallet.findUniqueOrThrow({ where: { id: existingRedemption.walletId } }),
        redemption: existingRedemption,
        ledgerEntry,
        idempotent: true,
      };
    }

    const wallet = await getOrCreateLockedWallet(tx, input.clientId, currencyCode);
    const lockedExistingRedemption = await getExistingRedemptionByKey(tx, input.idempotencyKey, payloadHash);
    if (lockedExistingRedemption) {
      const ledgerEntry = await tx.giftCardLedgerEntry.findUniqueOrThrow({
        where: { idempotencyKey: input.idempotencyKey },
      });
      return {
        wallet: await tx.giftCardWallet.findUniqueOrThrow({ where: { id: lockedExistingRedemption.walletId } }),
        redemption: lockedExistingRedemption,
        ledgerEntry,
        idempotent: true,
      };
    }
    const reservedForOrder = await findReservedRedemptionByOrder(tx, input.orderId);
    if (reservedForOrder) {
      throw giftCardError(giftCardErrorCodes.reservedRedemptionAlreadyExists);
    }
    const reservedAmountMinor = await getReservedAmount(tx, wallet.id);
    if (wallet.balanceMinor - reservedAmountMinor < input.amountMinor) {
      throw giftCardError(giftCardErrorCodes.insufficientAvailableBalance);
    }

    const redemption = await tx.giftCardRedemption.create({
      data: {
        walletId: wallet.id,
        clientId: input.clientId,
        orderId: input.orderId,
        status: GiftCardRedemptionStatus.RESERVED,
        reservedAmountMinor: input.amountMinor,
        currencyCode,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        expiresAt: input.expiresAt,
      },
    });
    const ledgerEntry = await createLedgerEntry(
      tx,
      {
        walletId: wallet.id,
        clientId: input.clientId,
        entryType: GiftCardLedgerEntryType.RESERVE,
        amountMinor: input.amountMinor,
        currencyCode,
        orderId: input.orderId,
        redemptionId: redemption.id,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        metadata: { ...actorMetadata(input.actor), ...(input.metadata as Prisma.InputJsonObject | undefined) },
      },
    );

    return { wallet, redemption, ledgerEntry, idempotent: false };
  });
}

export async function captureGiftCardRedemption(input: CaptureGiftCardInput): Promise<GiftCardRedemptionMutation> {
  assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = hashGiftCardPayload({
    operation: "CAPTURE",
    redemptionId: input.redemptionId,
    paymentId: input.paymentId,
  });

  return runGiftCardTransaction(async (tx) => {
    const existing = await getExistingLedgerByKey(tx, input.idempotencyKey, payloadHash);
    if (existing) {
      return {
        wallet: await tx.giftCardWallet.findUniqueOrThrow({ where: { id: existing.walletId } }),
        redemption: await tx.giftCardRedemption.findUniqueOrThrow({ where: { id: input.redemptionId } }),
        ledgerEntry: existing,
        idempotent: true,
      };
    }

    const { redemption, wallet } = await readLockedRedemptionWallet(tx, input.redemptionId);
    const lockedExisting = await getExistingLedgerByKey(tx, input.idempotencyKey, payloadHash);
    if (lockedExisting) {
      return {
        wallet: await tx.giftCardWallet.findUniqueOrThrow({ where: { id: lockedExisting.walletId } }),
        redemption: await tx.giftCardRedemption.findUniqueOrThrow({ where: { id: input.redemptionId } }),
        ledgerEntry: lockedExisting,
        idempotent: true,
      };
    }
    if (redemption.status !== GiftCardRedemptionStatus.RESERVED) {
      throw giftCardError(giftCardErrorCodes.invalidTransition);
    }
    if (wallet.balanceMinor < redemption.reservedAmountMinor) {
      throw giftCardError(giftCardErrorCodes.walletInvariantFailed);
    }

    const ledgerEntry = await createLedgerEntry(
      tx,
      {
        walletId: wallet.id,
        clientId: redemption.clientId,
        entryType: GiftCardLedgerEntryType.CAPTURE,
        amountMinor: redemption.reservedAmountMinor,
        currencyCode: redemption.currencyCode,
        orderId: redemption.orderId,
        paymentId: input.paymentId,
        redemptionId: redemption.id,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        metadata: { ...actorMetadata(input.actor), ...(input.metadata as Prisma.InputJsonObject | undefined) },
      },
    );
    const updatedWallet = await tx.giftCardWallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { decrement: redemption.reservedAmountMinor } },
    });
    const updatedRedemption = await tx.giftCardRedemption.update({
      where: { id: redemption.id },
      data: {
        status: GiftCardRedemptionStatus.CAPTURED,
        capturedAmountMinor: redemption.reservedAmountMinor,
      },
    });

    return { wallet: updatedWallet, redemption: updatedRedemption, ledgerEntry, idempotent: false };
  });
}

export async function releaseGiftCardRedemption(input: ReleaseGiftCardInput): Promise<GiftCardRedemptionMutation> {
  assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = hashGiftCardPayload({
    operation: "RELEASE",
    redemptionId: input.redemptionId,
  });

  return runGiftCardTransaction(async (tx) => {
    const existing = await getExistingLedgerByKey(tx, input.idempotencyKey, payloadHash);
    if (existing) {
      return {
        wallet: await tx.giftCardWallet.findUniqueOrThrow({ where: { id: existing.walletId } }),
        redemption: await tx.giftCardRedemption.findUniqueOrThrow({ where: { id: input.redemptionId } }),
        ledgerEntry: existing,
        idempotent: true,
      };
    }

    const { redemption, wallet } = await readLockedRedemptionWallet(tx, input.redemptionId);
    const lockedExisting = await getExistingLedgerByKey(tx, input.idempotencyKey, payloadHash);
    if (lockedExisting) {
      return {
        wallet: await tx.giftCardWallet.findUniqueOrThrow({ where: { id: lockedExisting.walletId } }),
        redemption: await tx.giftCardRedemption.findUniqueOrThrow({ where: { id: input.redemptionId } }),
        ledgerEntry: lockedExisting,
        idempotent: true,
      };
    }
    if (redemption.status !== GiftCardRedemptionStatus.RESERVED) {
      throw giftCardError(giftCardErrorCodes.invalidTransition);
    }

    const ledgerEntry = await createLedgerEntry(
      tx,
      {
        walletId: wallet.id,
        clientId: redemption.clientId,
        entryType: GiftCardLedgerEntryType.RELEASE,
        amountMinor: redemption.reservedAmountMinor,
        currencyCode: redemption.currencyCode,
        orderId: redemption.orderId,
        redemptionId: redemption.id,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        metadata: { ...actorMetadata(input.actor), ...(input.metadata as Prisma.InputJsonObject | undefined) },
      },
    );
    const updatedRedemption = await tx.giftCardRedemption.update({
      where: { id: redemption.id },
      data: {
        status: GiftCardRedemptionStatus.RELEASED,
        releasedAmountMinor: redemption.reservedAmountMinor,
      },
    });

    return { wallet, redemption: updatedRedemption, ledgerEntry, idempotent: false };
  });
}
