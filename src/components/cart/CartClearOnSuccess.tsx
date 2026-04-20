"use client";

import { useEffect } from "react";
import {
  maybeClearClientCartAfterConfirmedCheckout,
  type PurchasedCartLineScope,
} from "@/lib/cart/cart-client";

export function CartClearOnSuccess(input: {
  checkoutSessionId: string | null;
  cartClearEligible: boolean;
  purchasedLines: PurchasedCartLineScope[];
}) {
  useEffect(() => {
    maybeClearClientCartAfterConfirmedCheckout({
      checkoutSessionId: input.checkoutSessionId,
      cartClearEligible: input.cartClearEligible,
      purchasedLines: input.purchasedLines,
    });
  }, [input.cartClearEligible, input.checkoutSessionId, input.purchasedLines]);

  return null;
}
