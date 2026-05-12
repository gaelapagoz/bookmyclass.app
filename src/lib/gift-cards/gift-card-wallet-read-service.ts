import {
  GiftCardLedgerEntryType,
  GiftCardRedemptionStatus,
  GiftCardWalletStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { giftCardError, giftCardErrorCodes } from "./gift-card-errors";
import { GIFT_CARD_CURRENCY_CODE } from "./gift-card-types";
import type { GiftCardWalletBalance } from "./gift-card-types";

function assertCurrency(currencyCode: string): void {
  if (currencyCode !== GIFT_CARD_CURRENCY_CODE) {
    throw giftCardError(giftCardErrorCodes.currencyUnsupported);
  }
}

async function getReservedAmount(walletId: string): Promise<number> {
  const result = await prisma.giftCardRedemption.aggregate({
    where: { walletId, status: GiftCardRedemptionStatus.RESERVED },
    _sum: { reservedAmountMinor: true },
  });
  return result._sum.reservedAmountMinor ?? 0;
}

export type GiftCardLedgerHistoryEntry = {
  readonly id: string;
  readonly entryType: GiftCardLedgerEntryType;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly happenedAt: Date;
  readonly orderId: string | null;
};

export type GiftCardWalletWithHistory = GiftCardWalletBalance & {
  readonly ledgerEntries: GiftCardLedgerHistoryEntry[];
};

export async function getGiftCardWalletWithHistory(
  clientId: string,
  currencyCode = GIFT_CARD_CURRENCY_CODE,
): Promise<GiftCardWalletWithHistory | null> {
  assertCurrency(currencyCode);

  const wallet = await prisma.giftCardWallet.findUnique({
    where: { clientId_currencyCode: { clientId, currencyCode } },
    include: {
      ledgerEntries: {
        orderBy: { happenedAt: "desc" },
        take: 50,
        select: {
          id: true,
          entryType: true,
          amountMinor: true,
          currencyCode: true,
          happenedAt: true,
          orderId: true,
        },
      },
    },
  });

  if (!wallet) {
    return null;
  }

  if (wallet.status !== GiftCardWalletStatus.ACTIVE) {
    return null;
  }

  const reservedAmountMinor = await getReservedAmount(wallet.id);

  return {
    walletId: wallet.id,
    balanceMinor: wallet.balanceMinor,
    reservedAmountMinor,
    availableBalanceMinor: wallet.balanceMinor - reservedAmountMinor,
    currencyCode: wallet.currencyCode,
    ledgerEntries: wallet.ledgerEntries,
  };
}

export async function getGiftCardWalletBalance(
  clientId: string,
  currencyCode = GIFT_CARD_CURRENCY_CODE,
): Promise<GiftCardWalletBalance | null> {
  assertCurrency(currencyCode);

  const wallet = await prisma.giftCardWallet.findUnique({
    where: { clientId_currencyCode: { clientId, currencyCode } },
  });

  if (!wallet) {
    return null;
  }

  const reservedAmountMinor = await getReservedAmount(wallet.id);

  return {
    walletId: wallet.id,
    balanceMinor: wallet.balanceMinor,
    reservedAmountMinor,
    availableBalanceMinor: wallet.balanceMinor - reservedAmountMinor,
    currencyCode: wallet.currencyCode,
  };
}
