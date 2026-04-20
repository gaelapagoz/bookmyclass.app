import type { CartValidationRejectionCode } from "@/lib/cart/cart-types";

export const CART_VALIDATION_REJECTION_MESSAGES: Record<CartValidationRejectionCode, string> = {
  EMPTY_CART: "Your cart is empty.",
  PRODUCT_NOT_ACTIVE: "One or more products in your cart are no longer available.",
  PRICE_NOT_ACTIVE: "One or more prices in your cart are no longer available.",
  CHECKOUT_NOT_ENABLED: "One or more cart items are not checkout-ready.",
  MIXED_PRICE_TYPES_NOT_ALLOWED: "You cannot mix recurring and one-time products in the same checkout.",
  RECURRING_QUANTITY_MUST_BE_ONE: "Recurring products must have a quantity of 1.",
  ACTIVE_SUBSCRIPTION_ALREADY_EXISTS: "You already have an active subscription.",
};

export function createCartValidationRejection(code: CartValidationRejectionCode) {
  return {
    code,
    message: CART_VALIDATION_REJECTION_MESSAGES[code],
  };
}
