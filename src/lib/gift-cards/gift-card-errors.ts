export class GiftCardError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = "GiftCardError";
  }
}

export class GiftCardIdempotencyConflictError extends GiftCardError {
  constructor() {
    super("GIFT_CARD_IDEMPOTENCY_CONFLICT");
    this.name = "GiftCardIdempotencyConflictError";
  }
}

export const giftCardErrorCodes = {
  activationOrderItemRequired: "GIFT_CARD_ACTIVATION_ORDER_ITEM_REQUIRED",
  activationOrderItemAlreadyExists: "GIFT_CARD_ACTIVATION_ORDER_ITEM_ALREADY_EXISTS",
  amountInvalid: "GIFT_CARD_AMOUNT_INVALID",
  clientRequired: "GIFT_CARD_CLIENT_REQUIRED",
  currencyUnsupported: "GIFT_CARD_CURRENCY_UNSUPPORTED",
  insufficientAvailableBalance: "GIFT_CARD_INSUFFICIENT_AVAILABLE_BALANCE",
  invalidTransition: "GIFT_CARD_INVALID_TRANSITION",
  reservedRedemptionAlreadyExists: "GIFT_CARD_RESERVED_REDEMPTION_ALREADY_EXISTS",
  walletCapExceeded: "GIFT_CARD_WALLET_CAP_EXCEEDED",
  walletInvariantFailed: "GIFT_CARD_WALLET_INVARIANT_FAILED",
  walletSuspended: "GIFT_CARD_WALLET_SUSPENDED",
  giftCardCodeConcurrentRedemption: "GIFT_CARD_CODE_CONCURRENT_REDEMPTION",
  adminActorForbidden: "GIFT_CARD_ADMIN_ACTOR_FORBIDDEN",
  adminIdempotencyPayloadMismatch: "GIFT_CARD_ADMIN_IDEMPOTENCY_PAYLOAD_MISMATCH",
  adminEmailDeliveryFailed: "GIFT_CARD_ADMIN_EMAIL_DELIVERY_FAILED",
  codeNotVoidable: "GIFT_CARD_CODE_NOT_VOIDABLE",
} as const;

export function giftCardError(code: string): GiftCardError {
  return new GiftCardError(code);
}
