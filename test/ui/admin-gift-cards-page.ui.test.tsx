/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { GiftCardReconciliationStatus, GiftCardWalletStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  getWalletLookup: vi.fn(),
  listCases: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("@/lib/gift-cards/gift-card-admin-service", () => ({
  GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER:
    "Operational note only. This does not adjust wallet balance or payment state.",
  getAdminGiftCardWalletLookup: mocks.getWalletLookup,
  listAdminGiftCardReconciliationCases: mocks.listCases,
}));

import AdminGiftCardsPage from "../../src/app/admin/(private)/gift-cards/page";

const now = new Date("2026-01-01T10:00:00.000Z");

describe("admin gift cards page", () => {
  beforeEach(() => {
    mocks.requireAdminSession.mockResolvedValue({
      user: { id: "admin-1", role: Role.ADMIN },
    });
    mocks.getWalletLookup.mockReset();
    mocks.listCases.mockReset();
    mocks.listCases.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 1,
      metadata: { resolvedCasesHiddenByDefault: true },
    });
  });

  it("renders empty-wallet lookup state for a valid client without a wallet", async () => {
    mocks.getWalletLookup.mockResolvedValue({
      client: { id: "client-1", name: "Client One", email: "client@example.test", role: Role.CLIENT },
      wallet: null,
      ledgerEntries: [],
      redemptions: [],
      reconciliationCases: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 },
    });

    render(
      await AdminGiftCardsPage({
        searchParams: Promise.resolve({ clientId: "client-1" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Gift Cards" })).toBeVisible();
    expect(screen.getByText("No EUR gift-card wallet exists for this client.")).toBeVisible();
  });

  it("renders invalid client lookup feedback", async () => {
    mocks.getWalletLookup.mockRejectedValue(new Error("GIFT_CARD_CLIENT_NOT_FOUND"));

    render(
      await AdminGiftCardsPage({
        searchParams: Promise.resolve({ clientId: "missing-client" }),
      }),
    );

    expect(screen.getByText("Unable to find a client wallet lookup for the supplied client ID.")).toBeVisible();
  });

  it("passes default and resolved filters to the service", async () => {
    render(await AdminGiftCardsPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.listCases).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: undefined, page: 1, pageSize: 20 }),
    );

    mocks.listCases.mockClear();
    mocks.listCases.mockResolvedValue({
      items: [
        {
          id: "case-1",
          client: { id: "client-1", name: "Client One", email: "client@example.test" },
          status: GiftCardReconciliationStatus.RESOLVED,
          reason: "reviewed",
          createdAt: now,
        },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
      metadata: { resolvedCasesHiddenByDefault: false },
    });

    render(
      await AdminGiftCardsPage({
        searchParams: Promise.resolve({ status: "RESOLVED" }),
      }),
    );

    expect(mocks.listCases).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: GiftCardReconciliationStatus.RESOLVED }),
    );
    expect(screen.getByText("RESOLVED")).toBeVisible();
  });

  it("renders wallet balances and read-only rows without exposing mutation controls to ADMIN", async () => {
    mocks.getWalletLookup.mockResolvedValue({
      client: { id: "client-1", name: "Client One", email: "client@example.test", role: Role.CLIENT },
      wallet: {
        id: "wallet-1",
        clientId: "client-1",
        currencyCode: "EUR",
        balanceMinor: 7_500,
        status: GiftCardWalletStatus.ACTIVE,
        reservedAmountMinor: 0,
        availableBalanceMinor: 7_500,
        createdAt: now,
        updatedAt: now,
      },
      ledgerEntries: [
        {
          id: "ledger-1",
          entryType: "CAPTURE",
          amountMinor: 2_500,
          currencyCode: "EUR",
          orderId: "order-1",
          happenedAt: now,
        },
      ],
      redemptions: [],
      reconciliationCases: [],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    });

    render(
      await AdminGiftCardsPage({
        searchParams: Promise.resolve({ clientId: "client-1" }),
      }),
    );

    expect(screen.getAllByText(/75/)[0]).toBeVisible();
    expect(screen.getByText("CAPTURE")).toBeVisible();
    expect(screen.queryByText("Resolve via API after verification")).not.toBeInTheDocument();
  });
});
