import type { GiftCardLedgerEntry, GiftCardRedemption, GiftCardWallet, Role } from "@prisma/client";

export const GIFT_CARD_CURRENCY_CODE = "EUR";
export const GIFT_CARD_MAX_WALLET_BALANCE_MINOR = 100_000;
export const GIFT_CARD_MAX_REDEMPTION_MINOR = 50_000;

export type GiftCardActor =
  | { readonly type: "SYSTEM"; readonly label: string }
  | { readonly type: "USER"; readonly userId: string; readonly role: Role };

export type GiftCardMutationResult<T> = T & {
  readonly idempotent: boolean;
};

export type GiftCardWalletBalance = {
  readonly walletId: string;
  readonly balanceMinor: number;
  readonly reservedAmountMinor: number;
  readonly availableBalanceMinor: number;
  readonly currencyCode: string;
};

export type GiftCardWalletMutation = GiftCardMutationResult<{
  readonly wallet: GiftCardWallet;
  readonly ledgerEntry: GiftCardLedgerEntry;
}>;

export type GiftCardRedemptionMutation = GiftCardMutationResult<{
  readonly wallet: GiftCardWallet;
  readonly redemption: GiftCardRedemption;
  readonly ledgerEntry: GiftCardLedgerEntry;
}>;
