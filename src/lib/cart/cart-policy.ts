import type { CartValidationRejectionCode } from "@/lib/cart/cart-types";

export const CART_VALIDATION_REJECTION_MESSAGES: Record<CartValidationRejectionCode, string> = {
  EMPTY_CART: "Your cart is empty.",
  PRODUCT_NOT_ACTIVE: "One or more products in your cart are no longer available.",
  PRICE_NOT_ACTIVE: "One or more prices in your cart are no longer available.",
  CHECKOUT_NOT_ENABLED: "One or more cart items are not checkout-ready.",
  NON_EUR_PRICE_NOT_ALLOWED: "Store checkout is available in EUR only.",
  MIXED_PRICE_TYPES_NOT_ALLOWED: "You cannot mix recurring and one-time products in the same checkout.",
  RECURRING_QUANTITY_MUST_BE_ONE: "Recurring products must have a quantity of 1.",
  GIFT_CARD_ORDER_TOTAL_EXCEEDED: "Gift-card purchases are capped at 500 EUR per order.",
  MERCHANDISE_QUANTITY_EXCEEDED: "Merchandise quantity is capped at 10 per product.",
  ACTIVE_SUBSCRIPTION_ALREADY_EXISTS: "You already have an active subscription.",
};

export function createCartValidationRejection(code: CartValidationRejectionCode) {
  return {
    code,
    message: CART_VALIDATION_REJECTION_MESSAGES[code],
  };
}
