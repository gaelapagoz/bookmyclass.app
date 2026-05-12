import { SubscriptionStatus } from "@prisma/client";

export const CART_CHECKOUT_SOURCE = "CART_CHECKOUT_V1" as const;

export const CART_CHECKOUT_RESPONSE_TYPES = {
  COMPLETED: "completed",
  STRIPE_REDIRECT: "stripe_redirect",
} as const;

export const CART_CHECKOUT_MAX_WALLET_AMOUNT_MINOR = 50_000;

export type CartCheckoutResponseType =
  (typeof CART_CHECKOUT_RESPONSE_TYPES)[keyof typeof CART_CHECKOUT_RESPONSE_TYPES];

export const CART_CHECKOUT_IDEMPOTENCY_KEY_PREFIX = "cartchk_" as const;
export const CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX = /^cartchk_[0-9a-fA-F-]{36}$/;

export const CART_CHECKOUT_IDEMPOTENCY_STATES = {
  IN_PROGRESS: "IN_PROGRESS",
  SUCCEEDED: "SUCCEEDED",
  FAILED_BEFORE_WRITE: "FAILED_BEFORE_WRITE",
  FAILED_AFTER_WRITE_PRE_STRIPE: "FAILED_AFTER_WRITE_PRE_STRIPE",
  FAILED_STRIPE_UNCERTAIN: "FAILED_STRIPE_UNCERTAIN",
} as const;

export type CartCheckoutIdempotencyState =
  (typeof CART_CHECKOUT_IDEMPOTENCY_STATES)[keyof typeof CART_CHECKOUT_IDEMPOTENCY_STATES];

export const CART_CHECKOUT_DETERMINISTIC_FAILURE_STATUS_CODES = [400, 401, 403, 409, 422] as const;

export type ActiveSubscriptionPredicateInput = {
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  endedAt: Date | null;
};

export function isActiveSubscriptionForCartConstraint(
  input: ActiveSubscriptionPredicateInput,
  asOf: Date = new Date(),
): boolean {
  if (input.status !== SubscriptionStatus.ACTIVE) {
    return false;
  }

  if (input.currentPeriodEnd.getTime() <= asOf.getTime()) {
    return false;
  }

  if (input.endedAt && input.endedAt.getTime() <= asOf.getTime()) {
    return false;
  }

  return true;
}
