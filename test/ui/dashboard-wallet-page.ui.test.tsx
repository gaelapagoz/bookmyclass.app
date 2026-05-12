/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GiftCardLedgerEntryType } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getGiftCardWalletWithHistory: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/gift-cards/gift-card-wallet-read-service", () => ({
  getGiftCardWalletWithHistory: mocks.getGiftCardWalletWithHistory,
}));

import DashboardWalletPage from "../../src/app/(protected)/dashboard/wallet/page";

const baseWallet = {
  walletId: "wallet-1",
  balanceMinor: 10000,
  reservedAmountMinor: 0,
  availableBalanceMinor: 10000,
  currencyCode: "EUR",
  ledgerEntries: [],
};

describe("Dashboard wallet page", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({ user: { id: "user_1" } });
    mocks.getGiftCardWalletWithHistory.mockReset();
  });

  it("renders zero-balance state when wallet does not exist", async () => {
    mocks.getGiftCardWalletWithHistory.mockResolvedValue(null);

    render(await DashboardWalletPage());

    expect(screen.getByRole("heading", { name: "Gift Card Wallet" })).toBeInTheDocument();
    expect(screen.getByText(/no gift card wallet balance yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Visit the Store" })).toHaveAttribute("href", "/store");
  });

  it("renders settled balance, available balance, and reserved amount", async () => {
    mocks.getGiftCardWalletWithHistory.mockResolvedValue({
      ...baseWallet,
      balanceMinor: 10000,
      reservedAmountMinor: 2500,
      availableBalanceMinor: 7500,
    });

    render(await DashboardWalletPage());

    expect(screen.getByTestId("settled-balance")).toHaveTextContent("€100.00");
    expect(screen.getByTestId("available-balance")).toHaveTextContent("€75.00");
    expect(screen.getByTestId("reserved-balance")).toHaveTextContent("€25.00");
  });

  it("shows reserved note when reserved amount is non-zero", async () => {
    mocks.getGiftCardWalletWithHistory.mockResolvedValue({
      ...baseWallet,
      balanceMinor: 5000,
      reservedAmountMinor: 2500,
      availableBalanceMinor: 2500,
    });

    render(await DashboardWalletPage());

    expect(screen.getByText(/reserved amount is held/i)).toBeInTheDocument();
  });

  it("does not show reserved note when reserved amount is zero", async () => {
    mocks.getGiftCardWalletWithHistory.mockResolvedValue({
      ...baseWallet,
      balanceMinor: 5000,
      reservedAmountMinor: 0,
      availableBalanceMinor: 5000,
    });

    render(await DashboardWalletPage());

    expect(screen.queryByText(/reserved amount is held/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("settled-balance")).toHaveTextContent("€50.00");
    expect(screen.getByTestId("available-balance")).toHaveTextContent("€50.00");
    expect(screen.getByTestId("reserved-balance")).toHaveTextContent("€0.00");
  });

  it("renders ledger history when entries exist", async () => {
    mocks.getGiftCardWalletWithHistory.mockResolvedValue({
      ...baseWallet,
      balanceMinor: 10000,
      ledgerEntries: [
        {
          id: "entry-1",
          entryType: GiftCardLedgerEntryType.ACTIVATION,
          amountMinor: 10000,
          currencyCode: "EUR",
          happenedAt: new Date("2026-01-15T10:00:00Z"),
          orderId: "order-1",
        },
        {
          id: "entry-2",
          entryType: GiftCardLedgerEntryType.CAPTURE,
          amountMinor: 2200,
          currencyCode: "EUR",
          happenedAt: new Date("2026-01-20T14:30:00Z"),
          orderId: "order-2",
        },
      ],
    });

    render(await DashboardWalletPage());

    expect(screen.getByRole("heading", { name: "Transaction History" })).toBeInTheDocument();
    expect(screen.getByText("Gift card activated")).toBeInTheDocument();
    expect(screen.getByText("Redeemed")).toBeInTheDocument();
  });

  it("shows no-transactions message when ledger is empty", async () => {
    mocks.getGiftCardWalletWithHistory.mockResolvedValue({ ...baseWallet, ledgerEntries: [] });

    render(await DashboardWalletPage());

    expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
  });

  it("calls wallet service with the authenticated user id from requireAuth", async () => {
    const userId = "user-session-123";
    mocks.requireAuth.mockResolvedValue({ user: { id: userId } });
    mocks.getGiftCardWalletWithHistory.mockResolvedValue(null);

    await DashboardWalletPage();

    expect(mocks.getGiftCardWalletWithHistory).toHaveBeenCalledWith(userId);
  });

  it("always shows the gift card redeem form regardless of wallet state", async () => {
    mocks.getGiftCardWalletWithHistory.mockResolvedValue(null);

    render(await DashboardWalletPage());

    expect(screen.getByRole("heading", { name: /redeem a gift card/i })).toBeInTheDocument();
    expect(screen.getByText(/enter your gift card code to add the balance to your wallet/i)).toBeInTheDocument();
    expect(screen.getByTestId("gift-card-code-input")).toBeInTheDocument();
  });

  it("shows the gift card redeem form when wallet has balance", async () => {
    mocks.getGiftCardWalletWithHistory.mockResolvedValue({ ...baseWallet });

    render(await DashboardWalletPage());

    expect(screen.getByRole("heading", { name: /redeem a gift card/i })).toBeInTheDocument();
    expect(screen.getByTestId("gift-card-code-input")).toBeInTheDocument();
  });
});
