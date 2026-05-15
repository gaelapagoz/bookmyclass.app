/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  listWalletBalances: vi.fn(),
  listIssuedCodes: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("@/lib/gift-cards/gift-card-admin-service", () => ({
  listAdminGiftCardWalletBalances: mocks.listWalletBalances,
  listAdminIssuedGiftCardCodes: mocks.listIssuedCodes,
}));

import AdminGiftCardsPage from "../../src/app/admin/(private)/gift-cards/page";

const now = new Date("2026-01-01T10:00:00.000Z");

describe("admin gift cards page", () => {
  beforeEach(() => {
    mocks.requireAdminSession.mockResolvedValue({
      user: { id: "admin-1", role: Role.ADMIN },
    });
    mocks.listWalletBalances.mockReset();
    mocks.listWalletBalances.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 1,
    });
    mocks.listIssuedCodes.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 1,
    });
  });

  it("renders wallet list empty state", async () => {
    render(
      await AdminGiftCardsPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "Gift Cards" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Generate Gift Card" })).toBeVisible();
    expect(screen.getByText("No wallet balances found.")).toBeVisible();
  });

  it("passes default query params to wallet listing service", async () => {
    render(await AdminGiftCardsPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.listWalletBalances).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "", page: 1, pageSize: 20 }),
    );
    expect(mocks.listIssuedCodes).toHaveBeenLastCalledWith(
      expect.objectContaining({ recipientEmail: "", page: 1, pageSize: 20 }),
    );
  });

  it("renders wallet rows from name/email search results", async () => {
    mocks.listWalletBalances.mockResolvedValue({
      items: [
        {
          walletId: "wallet-1",
          client: { id: "client-1", name: "Client One", email: "client@example.test" },
          currencyCode: "EUR",
          balanceMinor: 7500,
          activeGiftCards: 2,
          lastActivityAt: now,
        },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });

    render(
      await AdminGiftCardsPage({
        searchParams: Promise.resolve({ query: "client@example.test" }),
      }),
    );

    expect(mocks.listWalletBalances).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "client@example.test" }),
    );
    expect(screen.getByText("Client One")).toBeVisible();
    expect(screen.getByText("client@example.test")).toBeVisible();
  });

  it("renders wallets section without reconciliation controls", async () => {
    render(
      await AdminGiftCardsPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "Wallets / Balances" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Reconciliation Cases" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search by client name or email")).toBeVisible();
  });

  it("supports issued gift card search by recipient email and hides actions column", async () => {
    render(
      await AdminGiftCardsPage({
        searchParams: Promise.resolve({ issuedRecipientEmail: "recipient@example.test" }),
      }),
    );

    expect(mocks.listIssuedCodes).toHaveBeenLastCalledWith(
      expect.objectContaining({ recipientEmail: "recipient@example.test" }),
    );
    expect(screen.getByPlaceholderText("Search by recipient email")).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
  });
});
