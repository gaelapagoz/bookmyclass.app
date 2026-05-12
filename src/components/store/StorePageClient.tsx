"use client";

import Link from "next/link";
import { useState } from "react";
import { ProductType } from "@prisma/client";
import { addLineToClientCart } from "@/lib/cart/cart-client";
import type { StoreCatalogReadModel } from "@/lib/store/store-catalog";
import { STORE_PICKUP_WORDING } from "@/lib/store/store-constants";

function formatAmount(minor: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

export function StorePageClient({ products }: { products: StoreCatalogReadModel[] }) {
  const [feedbackByPrice, setFeedbackByPrice] = useState<Record<string, string>>({});
  const [globalFeedback, setGlobalFeedback] = useState<string | null>(null);

  const addToCart = (product: StoreCatalogReadModel, priceId: string, unitAmountMinor: number, currencyCode: string, priceName: string) => {
    setGlobalFeedback(null);
    const result = addLineToClientCart({
      line: {
        productId: product.id,
        priceId,
        productName: product.name,
        productDescription: product.description,
        productType: product.productType,
        priceName,
        priceType: "ONE_TIME",
        quantity: 1,
        unitAmountMinor,
        currencyCode,
        billingInterval: null,
        billingIntervalCount: null,
      },
    });

    if (!result.ok) {
      setFeedbackByPrice((prev) => ({ ...prev, [priceId]: result.message }));
      return;
    }

    setFeedbackByPrice((prev) => ({ ...prev, [priceId]: "Added to cart!" }));
    setTimeout(() => {
      setFeedbackByPrice((prev) => {
        const next = { ...prev };
        delete next[priceId];
        return next;
      });
    }, 2000);
  };

  const giftCards = products.filter((p) => p.productType === ProductType.GIFT_CARD);
  const merchandise = products.filter((p) => p.productType === ProductType.MERCHANDISE);

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-14">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">Studio Store</h1>
        <Link
          href="/cart"
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          View Cart
        </Link>
      </div>

      {globalFeedback ? (
        <p className="mt-4 text-sm text-[#7b2d2d]">{globalFeedback}</p>
      ) : null}

      {giftCards.length > 0 ? (
        <div className="mt-10">
          <h2 className="text-xl font-semibold text-[#6f2b2b]">Gift Cards</h2>
          <p className="mt-1 text-sm text-[#7f5a5a]">
            Give the gift of movement. Redeemable for any studio purchase.
          </p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {giftCards.map((product) => (
              <li
                key={product.id}
                className="rounded-xl border border-[#d8cec6] bg-white p-4"
              >
                <h3 className="font-semibold text-[#6f2b2b]">{product.name}</h3>
                {product.description ? (
                  <p className="mt-1 text-sm text-[#7f5a5a]">{product.description}</p>
                ) : null}
                <ul className="mt-3 space-y-2">
                  {product.checkoutPrices.map((price) => (
                    <li key={price.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-[#5f4040]">
                        {formatAmount(price.unitAmountMinor, price.currencyCode)}
                      </span>
                      <div className="flex flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            addToCart(product, price.id, price.unitAmountMinor, price.currencyCode, price.name)
                          }
                          className="rounded-md bg-[#7b2d2d] px-3 py-1 text-xs text-[#f4eee8] hover:opacity-90"
                        >
                          Add to Cart
                        </button>
                        {feedbackByPrice[price.id] ? (
                          <span className="text-xs text-[#6f2b2b]">{feedbackByPrice[price.id]}</span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                  {product.checkoutPrices.length === 0 ? (
                    <li className="text-xs text-[#8a5959]">Not available for checkout.</li>
                  ) : null}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {merchandise.length > 0 ? (
        <div className="mt-10">
          <h2 className="text-xl font-semibold text-[#6f2b2b]">Merchandise</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {merchandise.map((product) => (
              <li
                key={product.id}
                className="rounded-xl border border-[#d8cec6] bg-white p-4"
              >
                <h3 className="font-semibold text-[#6f2b2b]">{product.name}</h3>
                {product.fulfillmentLabel ? (
                  <p
                    className="mt-1 text-xs font-medium text-[#7b2d2d]"
                    data-testid="pickup-wording"
                  >
                    {product.fulfillmentLabel}
                  </p>
                ) : null}
                {product.description && product.description !== STORE_PICKUP_WORDING ? (
                  <p className="mt-1 text-sm text-[#7f5a5a]">{product.description}</p>
                ) : null}
                <ul className="mt-3 space-y-2">
                  {product.checkoutPrices.map((price) => (
                    <li key={price.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-[#5f4040]">
                        {formatAmount(price.unitAmountMinor, price.currencyCode)}
                      </span>
                      <div className="flex flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            addToCart(product, price.id, price.unitAmountMinor, price.currencyCode, price.name)
                          }
                          className="rounded-md bg-[#7b2d2d] px-3 py-1 text-xs text-[#f4eee8] hover:opacity-90"
                        >
                          Add to Cart
                        </button>
                        {feedbackByPrice[price.id] ? (
                          <span className="text-xs text-[#6f2b2b]">{feedbackByPrice[price.id]}</span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                  {product.checkoutPrices.length === 0 ? (
                    <li className="text-xs text-[#8a5959]">Not available for checkout.</li>
                  ) : null}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {products.length === 0 ? (
        <p className="mt-10 text-sm text-[#7f5a5a]">No products are currently available.</p>
      ) : null}
    </section>
  );
}
