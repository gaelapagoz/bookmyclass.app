/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getGiftCardWalletWithHistory: vi.fn(),
  resolvePrimaryLoyaltyCurrencyCode: vi.fn(),
  getClientLoyaltySummary: vi.fn(),
  listClientLoyaltyHistory: vi.fn(),
  getLoyaltyCreditBalance: vi.fn(),
  listActiveLoyaltyRewards: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/gift-cards/gift-card-wallet-read-service", () => ({
  getGiftCardWalletWithHistory: mocks.getGiftCardWalletWithHistory,
}));

vi.mock("@/lib/loyalty/loyalty-program-service", () => ({
  resolvePrimaryLoyaltyCurrencyCode: mocks.resolvePrimaryLoyaltyCurrencyCode,
}));

vi.mock("@/lib/loyalty/loyalty-read-service", () => ({
  getClientLoyaltySummary: mocks.getClientLoyaltySummary,
  listClientLoyaltyHistory: mocks.listClientLoyaltyHistory,
}));

vi.mock("@/lib/loyalty/loyalty-redemption-service", () => ({
  getLoyaltyCreditBalance: mocks.getLoyaltyCreditBalance,
  listActiveLoyaltyRewards: mocks.listActiveLoyaltyRewards,
}));

vi.mock("@/components/dashboard/GiftCardRedeemForm", () => ({
  GiftCardRedeemForm: () => <div>Redeem gift card form</div>,
}));

vi.mock("@/components/dashboard/LoyaltyRewardRedeemForm", () => ({
  LoyaltyRewardRedeemForm: () => <div>Redeem loyalty reward form</div>,
}));

import DashboardWalletPage from "../../src/app/(protected)/dashboard/wallet/page";

describe("dashboard wallet page", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({ user: { id: "client-1" } });
    mocks.resolvePrimaryLoyaltyCurrencyCode.mockResolvedValue("EUR");
    mocks.getGiftCardWalletWithHistory.mockResolvedValue(null);
    mocks.getClientLoyaltySummary.mockResolvedValue({
      client: { id: "client-1", name: "Client", email: "client@example.test" },
      program: {
        currencyCode: "EUR",
        isActive: true,
        earningPoints: 1,
        earningAmountMinor: 100,
        pointsExpireAfterDays: 180,
        expirationReminderDays: 30,
      },
      balancePoints: 120,
      lifetimeEarnedPoints: 120,
      manualGrantPoints: 20,
      reversedPoints: 0,
      expiredPoints: 0,
      expiringPoints: 40,
      nextExpirationAt: new Date("2026-08-01T10:00:00.000Z"),
      lastActivityAt: new Date("2026-06-01T10:00:00.000Z"),
    });
    mocks.listClientLoyaltyHistory.mockResolvedValue([
      {
        id: "entry-1",
        entryType: "EARN",
        amountPoints: 120,
        reason: null,
        happenedAt: new Date("2026-06-01T10:00:00.000Z"),
      },
    ]);
    mocks.getLoyaltyCreditBalance.mockResolvedValue({
      settledBalanceMinor: 500,
      reservedAmountMinor: 0,
      availableBalanceMinor: 500,
      currencyCode: "EUR",
    });
    mocks.listActiveLoyaltyRewards.mockResolvedValue([
      {
        id: "reward-1",
        name: "5 EURO Reward",
        pointsRequired: 500,
        amountMinor: 500,
        currencyCode: "EUR",
        isActive: true,
      },
    ]);
  });

  it("renders separate gift-card and loyalty sections", async () => {
    render(await DashboardWalletPage());

    expect(screen.getByRole("heading", { name: "My Wallet" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Gift Card Wallet" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Loyalty" })).toBeVisible();
    expect(screen.getByText("Redeem gift card form")).toBeVisible();
    expect(screen.getByText("Redeem loyalty reward form")).toBeVisible();
    expect(screen.getByText("Current Points")).toBeVisible();
    expect(screen.getByText("Loyalty Credit")).toBeVisible();
    expect(screen.getByText("Loyalty History")).toBeVisible();
  });

  it("renders empty gift-card state without hiding loyalty visibility", async () => {
    render(await DashboardWalletPage());

    expect(screen.getByText("You have no gift card wallet balance yet.")).toBeVisible();
    expect(screen.queryByText("No scheduled expiry")).not.toBeInTheDocument();
    expect(screen.getByText("Lifetime earned: 120 points")).toBeVisible();
  });
});
