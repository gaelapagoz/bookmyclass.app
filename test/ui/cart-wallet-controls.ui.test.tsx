/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductType } from "@prisma/client";
import { CART_STORAGE_KEY } from "@/lib/cart/cart-client";

global.fetch = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/cart",
}));

vi.mock("@/components/book-a-class/service-detail/SignInModal", () => ({
  SignInModal: () => null,
}));

import { CartPageClient } from "../../src/components/cart/CartPageClient";

const storeCartLine = {
  productId: "prod-gc-1",
  priceId: "price-gc-1",
  productName: "Gift Card 25 EUR",
  productDescription: null,
  productType: ProductType.GIFT_CARD,
  priceName: "Gift Card 25 EUR",
  priceType: "ONE_TIME",
  quantity: 1,
  unitAmountMinor: 2500,
  currencyCode: "EUR",
  billingInterval: null,
  billingIntervalCount: null,
};

function seedCart(lines: object[]) {
  window.localStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify({ version: 1, lines }),
  );
}

describe("CartPageClient wallet controls", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(global.fetch).mockReset();
    vi.mocked(global.fetch).mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/wallet/balance")) {
        return {
          ok: true,
          json: async () => ({
            balance: {
              balanceMinor: 5000,
              availableBalanceMinor: 5000,
              reservedAmountMinor: 0,
              currencyCode: "EUR",
            },
          }),
        } as Response;
      }
      if (urlStr.includes("/api/cart/reconcile")) {
        // Return no lines so the component does not replace the seeded cart.
        return {
          ok: true,
          json: async () => ({ removedCount: 0 }),
        } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    });
  });

  it("shows wallet controls when cart has store items and wallet has balance", async () => {
    seedCart([storeCartLine]);
    render(<CartPageClient />);

    await waitFor(() => {
      expect(screen.getByTestId("wallet-controls")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/available/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("wallet-amount-input")).toBeInTheDocument();
    expect(screen.getByTestId("wallet-apply")).toBeInTheDocument();
  });

  it("does not show wallet controls when cart has no store items", async () => {
    seedCart([
      {
        ...storeCartLine,
        productType: ProductType.CLASS_PACK,
        productName: "5-Class Pack",
        priceId: "price-class-1",
      },
    ]);
    render(<CartPageClient />);

    await waitFor(() => {
      expect(screen.queryByTestId("wallet-controls")).not.toBeInTheDocument();
    });
  });

  it("does not show wallet controls when wallet balance is zero", async () => {
    vi.mocked(global.fetch).mockImplementation(async (url) => {
      if (String(url).includes("/api/wallet/balance")) {
        return {
          ok: true,
          json: async () => ({ balance: { balanceMinor: 0, availableBalanceMinor: 0, reservedAmountMinor: 0, currencyCode: "EUR" } }),
        } as Response;
      }
      return { ok: true, json: async () => ({ lines: [], removedCount: 0 }) } as Response;
    });
    seedCart([storeCartLine]);
    render(<CartPageClient />);

    await waitFor(() => {
      expect(screen.queryByTestId("wallet-controls")).not.toBeInTheDocument();
    });
  });

  it("shows applied amount and remove button after applying wallet", async () => {
    seedCart([storeCartLine]);
    render(<CartPageClient />);

    await waitFor(() => {
      expect(screen.getByTestId("wallet-amount-input")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("wallet-amount-input"), { target: { value: "10.00" } });
    fireEvent.click(screen.getByTestId("wallet-apply"));

    await waitFor(() => {
      expect(screen.getByTestId("wallet-applied-amount")).toBeInTheDocument();
    });
    expect(screen.getByTestId("wallet-applied-amount")).toHaveTextContent("€10.00");
    expect(screen.getByTestId("wallet-remove")).toBeInTheDocument();
    expect(screen.queryByTestId("wallet-amount-input")).not.toBeInTheDocument();
  });

  it("removes applied wallet and shows input again after clicking remove", async () => {
    seedCart([storeCartLine]);
    render(<CartPageClient />);

    await waitFor(() => {
      expect(screen.getByTestId("wallet-amount-input")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("wallet-amount-input"), { target: { value: "10.00" } });
    fireEvent.click(screen.getByTestId("wallet-apply"));

    await waitFor(() => {
      expect(screen.getByTestId("wallet-remove")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("wallet-remove"));

    await waitFor(() => {
      expect(screen.getByTestId("wallet-amount-input")).toBeInTheDocument();
      expect(screen.queryByTestId("wallet-applied-amount")).not.toBeInTheDocument();
    });
  });
});
