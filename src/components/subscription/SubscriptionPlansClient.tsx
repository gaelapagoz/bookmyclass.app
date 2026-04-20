"use client";

import Link from "next/link";
import { useState } from "react";
import { BillingInterval, PriceType, ProductType } from "@prisma/client";
import { addLineToClientCart } from "@/lib/cart/cart-client";

type SubscriptionProduct = {
  productId: string;
  name: string;
  description: string | null;
  productType: ProductType;
  priceId: string;
  priceName: string;
  priceType: PriceType;
  amountMinor: number;
  currencyCode: string;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  checkoutEnabled: boolean;
};

function formatProductPrice(
  priceMinor: number,
  currencyCode: string,
  interval: BillingInterval | null,
  intervalCount: number | null,
) {
  const formatted = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(priceMinor / 100);

  if (!interval) {
    return formatted;
  }

  const normalizedCount = intervalCount ?? 1;
  if (normalizedCount <= 1) {
    return `${formatted} / ${interval.toLowerCase()}`;
  }

  return `${formatted} / ${normalizedCount} ${interval.toLowerCase()}s`;
}

export function SubscriptionProductsClient({
  initialProducts,
  hasActiveSubscription,
}: {
  initialProducts: SubscriptionProduct[];
  hasActiveSubscription: boolean;
}) {
  const [feedbackByProduct, setFeedbackByProduct] = useState<Record<string, string>>({});
  const [globalFeedback, setGlobalFeedback] = useState<string | null>(null);

  const addToCart = (product: SubscriptionProduct) => {
    setGlobalFeedback(null);
    const result = addLineToClientCart({
      hasActiveSubscription,
      line: {
        productId: product.productId,
        priceId: product.priceId,
        productName: product.name,
        productDescription: product.description,
        productType: product.productType,
        priceName: product.priceName,
        priceType: product.priceType,
        quantity: 1,
        unitAmountMinor: product.amountMinor,
        currencyCode: product.currencyCode,
        billingInterval: product.billingInterval,
        billingIntervalCount: product.billingIntervalCount,
      },
    });

    if (!result.ok) {
      setGlobalFeedback(result.message);
      return;
    }

    setFeedbackByProduct((previous) => ({
      ...previous,
      [product.productId]: "Added to cart.",
    }));
  };

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">Subscription Products</h1>
      </div>
      <p className="mt-3 text-sm text-[#7f5a5a]">
        Choose an active product and add it to your cart before checkout.
      </p>

      {globalFeedback ? <p className="mt-4 text-sm text-[#7b2d2d]">{globalFeedback}</p> : null}

      {initialProducts.length === 0 ? (
        <div className="mt-6 rounded-xl border border-[#d8cec6] bg-white p-5 text-sm text-[#5f4040]">
          No active products are currently available.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {initialProducts.map((product) => (
            <article key={product.productId} className="rounded-xl border border-[#d8cec6] bg-white p-5">
              <h2 className="text-lg font-semibold text-[#6f2b2b]">{product.name}</h2>
              {product.description ? <p className="mt-2 text-sm text-[#5f4040]">{product.description}</p> : null}
              <p className="mt-3 text-sm font-medium text-[#6f2b2b]">
                {formatProductPrice(
                  product.amountMinor,
                  product.currencyCode,
                  product.billingInterval,
                  product.billingIntervalCount,
                )}
              </p>
              <button
                type="button"
                onClick={() => addToCart(product)}
                disabled={!product.checkoutEnabled}
                className="mt-4 rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] disabled:opacity-60"
              >
                Add to Cart
              </button>
              {!product.checkoutEnabled ? (
                <p className="mt-2 text-xs text-[#7f5a5a]">
                  Checkout is unavailable until Stripe pricing is configured.
                </p>
              ) : null}
              {feedbackByProduct[product.productId] ? (
                <p className="mt-2 text-xs text-[#5f4040]">{feedbackByProduct[product.productId]}</p>
              ) : null}
            </article>
          ))}
        </div>
      )}

      <div className="mt-6">
        <Link
          href="/cart"
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Go to cart
        </Link>
      </div>
    </section>
  );
}

export { SubscriptionProductsClient as SubscriptionPlansClient };
