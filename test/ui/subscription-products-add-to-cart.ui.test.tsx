/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillingInterval, PriceType, ProductType } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { SubscriptionProductsClient } from "../../src/components/subscription/SubscriptionPlansClient";
import { CART_STORAGE_KEY } from "../../src/lib/cart/cart-client";

afterEach(() => {
  window.localStorage.clear();
});

function buildProduct(input: {
  productId: string;
  name: string;
  priceId: string;
  priceType: PriceType;
  amountMinor: number;
}): {
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
} {
  return {
    productId: input.productId,
    name: input.name,
    description: null,
    productType: ProductType.CLASS_PACK,
    priceId: input.priceId,
    priceName: `${input.name} Price`,
    priceType: input.priceType,
    amountMinor: input.amountMinor,
    currencyCode: "EUR",
    billingInterval: input.priceType === PriceType.RECURRING ? BillingInterval.MONTH : null,
    billingIntervalCount: input.priceType === PriceType.RECURRING ? 1 : null,
    checkoutEnabled: true,
  };
}

describe("Subscription add-to-cart", () => {
  it("adds a product to local cart successfully", async () => {
    render(
      <SubscriptionProductsClient
        initialProducts={[
          buildProduct({
            productId: "prod_one",
            name: "One-time Pack",
            priceId: "price_one",
            priceType: PriceType.ONE_TIME,
            amountMinor: 2500,
          }),
        ]}
        hasActiveSubscription={false}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(screen.getByText("Added to cart.")).toBeInTheDocument();
    const persisted = window.localStorage.getItem(CART_STORAGE_KEY);
    expect(persisted).toBeTruthy();
    const parsed = JSON.parse(persisted ?? "{}") as { lines?: Array<{ productId: string; quantity: number }> };
    expect(parsed.lines).toEqual([
      expect.objectContaining({
        productId: "prod_one",
        quantity: 1,
      }),
    ]);
  });

  it("shows blocked messaging for mixed-mode add", async () => {
    render(
      <SubscriptionProductsClient
        initialProducts={[
          buildProduct({
            productId: "prod_recurring",
            name: "Recurring Membership",
            priceId: "price_recurring",
            priceType: PriceType.RECURRING,
            amountMinor: 9900,
          }),
          buildProduct({
            productId: "prod_one_time",
            name: "One-time Pack",
            priceId: "price_one_time",
            priceType: PriceType.ONE_TIME,
            amountMinor: 2500,
          }),
        ]}
        hasActiveSubscription={false}
      />,
    );

    const addButtons = screen.getAllByRole("button", { name: "Add to Cart" });
    await userEvent.click(addButtons[0] as HTMLElement);
    await userEvent.click(addButtons[1] as HTMLElement);

    expect(
      screen.getByText("You cannot mix recurring and one-time products in the same checkout."),
    ).toBeInTheDocument();
  });

  it("shows blocked messaging for recurring quantity and active subscription restriction", async () => {
    const recurringOnly = buildProduct({
      productId: "prod_recurring_only",
      name: "Recurring Only",
      priceId: "price_recurring_only",
      priceType: PriceType.RECURRING,
      amountMinor: 12900,
    });

    const { rerender } = render(
      <SubscriptionProductsClient
        initialProducts={[recurringOnly]}
        hasActiveSubscription={false}
      />,
    );

    const button = screen.getByRole("button", { name: "Add to Cart" });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(screen.getByText("Recurring products must have a quantity of 1.")).toBeInTheDocument();

    rerender(
      <SubscriptionProductsClient
        initialProducts={[recurringOnly]}
        hasActiveSubscription={true}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(screen.getByText("You already have an active subscription.")).toBeInTheDocument();
  });
});
