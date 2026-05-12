import { BillingInterval, PriceType, ProductType, SubscriptionStatus } from "@prisma/client";
import type { CartLineInput as CartHashLineInput } from "@/lib/cart/cart-hash";
import type { CartCheckoutIdempotencyState } from "@/lib/cart/cart-contract";

export type CartLineInput = CartHashLineInput;

export type CartNormalizedLine = {
  productId: string;
  priceId: string;
  quantity: number;
};

export type CartComposition = "EMPTY" | "ONE_TIME_ONLY" | "RECURRING_ONLY";

export type CartValidationRejectionCode =
  | "EMPTY_CART"
  | "PRODUCT_NOT_ACTIVE"
  | "PRICE_NOT_ACTIVE"
  | "CHECKOUT_NOT_ENABLED"
  | "NON_EUR_PRICE_NOT_ALLOWED"
  | "MIXED_PRICE_TYPES_NOT_ALLOWED"
  | "RECURRING_QUANTITY_MUST_BE_ONE"
  | "GIFT_CARD_ORDER_TOTAL_EXCEEDED"
  | "MERCHANDISE_QUANTITY_EXCEEDED"
  | "ACTIVE_SUBSCRIPTION_ALREADY_EXISTS";

export type CartValidationRejection = {
  code: CartValidationRejectionCode;
  message: string;
};

export type CartResolvedCatalogPrice = {
  priceId: string;
  productId: string;
  productName: string;
  productDescription: string | null;
  productType: ProductType;
  priceName: string;
  priceType: PriceType;
  unitAmountMinor: number;
  currencyCode: string;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  checkoutEnabled: boolean;
  productIsActive: boolean;
  productIsArchived: boolean;
  priceIsActive: boolean;
  priceIsArchived: boolean;
  priceStartsAt: Date | null;
  priceEndsAt: Date | null;
};

export type CartRepricedLine = {
  productId: string;
  priceId: string;
  productName: string;
  productDescription: string | null;
  productType: ProductType;
  priceName: string;
  priceType: PriceType;
  quantity: number;
  unitAmountMinor: number;
  lineSubtotalAmountMinor: number;
  currencyCode: string;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
};

export type CartPricingSummary = {
  subtotalAmountMinor: number;
  currencyCode: string;
};

export type CartValidationResult =
  | {
      ok: true;
      composition: CartComposition;
      cartHash: string;
      normalizedLines: CartNormalizedLine[];
      repricedLines: CartRepricedLine[];
      pricing: CartPricingSummary;
    }
  | {
      ok: false;
      composition: CartComposition;
      cartHash: string;
      normalizedLines: CartNormalizedLine[];
      rejection: CartValidationRejection;
    };

export type CartReconciliationRemovedLine = CartNormalizedLine & {
  reason: Exclude<
    CartValidationRejectionCode,
    "EMPTY_CART" | "MIXED_PRICE_TYPES_NOT_ALLOWED" | "RECURRING_QUANTITY_MUST_BE_ONE" | "ACTIVE_SUBSCRIPTION_ALREADY_EXISTS"
    | "GIFT_CARD_ORDER_TOTAL_EXCEEDED" | "MERCHANDISE_QUANTITY_EXCEEDED"
  >;
};

export type CartReconciliationResult = {
  cartHash: string;
  normalizedLines: CartNormalizedLine[];
  repricedLines: CartRepricedLine[];
  removedLines: CartReconciliationRemovedLine[];
};

export type CartSubscriptionSnapshot = {
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  endedAt: Date | null;
};

export type CartValidationServiceInput = {
  lines: CartLineInput[];
  clientId?: string | null;
};

export type CartValidationServiceDependencies = {
  getCatalogPricesByIds: (priceIds: string[]) => Promise<CartResolvedCatalogPrice[]>;
  getClientSubscriptionSnapshots: (clientId: string) => Promise<CartSubscriptionSnapshot[]>;
  now: () => Date;
};

export type CartIdempotencyState = CartCheckoutIdempotencyState;
