"use client";

import { useState } from "react";
import { BillingInterval } from "@prisma/client";

type SubscriptionProduct = {
  productId: string;
  name: string;
  description: string | null;
  priceId: string;
  priceName: string;
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
}: {
  initialProducts: SubscriptionProduct[];
}) {
  const [isStartingCheckout, setIsStartingCheckout] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = async (productId: string) => {
    setIsStartingCheckout(productId);
    setError(null);
    try {
      const response = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const payload = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (response.status === 401) {
        window.location.assign(`/sign-in?callbackUrl=${encodeURIComponent("/subscription")}`);
        return;
      }
      if (!response.ok || !payload.checkoutUrl) {
        setError(payload.error ?? "Could not start checkout.");
        return;
      }
      window.location.assign(payload.checkoutUrl);
    } catch {
      setError("Could not start checkout.");
    } finally {
      setIsStartingCheckout(null);
    }
  };

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">Subscription Products</h1>
      </div>
      <p className="mt-3 text-sm text-[#7f5a5a]">
        Choose an active product to continue to secure Stripe checkout.
      </p>

      {error ? <p className="mt-4 text-sm text-[#7b2d2d]">{error}</p> : null}

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
                onClick={() => void startCheckout(product.productId)}
                disabled={isStartingCheckout === product.productId || !product.checkoutEnabled}
                className="mt-4 rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] disabled:opacity-60"
              >
                {isStartingCheckout === product.productId ? "Redirecting..." : "Continue to checkout"}
              </button>
              {!product.checkoutEnabled ? (
                <p className="mt-2 text-xs text-[#7f5a5a]">
                  Checkout is unavailable until Stripe pricing is configured.
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export { SubscriptionProductsClient as SubscriptionPlansClient };
