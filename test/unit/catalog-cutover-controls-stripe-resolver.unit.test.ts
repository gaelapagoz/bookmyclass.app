import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const priceFindManyMock = vi.fn();
const priceUpdateManyMock = vi.fn();
const priceFindUniqueMock = vi.fn();
const auditCreateMock = vi.fn();
const userFindUniqueMock = vi.fn();

vi.mock("@/lib/payments/stripe", () => ({
  getStripeClient: () => ({
    prices: {
      list: (...args: unknown[]) => listMock(...args),
    },
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    price: {
      findMany: (...args: unknown[]) => priceFindManyMock(...args),
      updateMany: (...args: unknown[]) => priceUpdateManyMock(...args),
      findUnique: (...args: unknown[]) => priceFindUniqueMock(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => auditCreateMock(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
    },
  },
}));

import { runCatalogStripePriceBackfill } from "../../src/lib/catalog/cutover-controls";

describe("catalog cutover stripe lookup fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    priceFindManyMock
      .mockResolvedValueOnce([
        {
          id: "price-local-1",
          productId: "product-1",
          lookupKey: "lookup-key-1",
          product: {
            name: "Product 1",
          },
        },
      ])
      .mockResolvedValueOnce([]);
    priceUpdateManyMock.mockResolvedValue({ count: 0 });
    priceFindUniqueMock.mockResolvedValue({ stripePriceId: null });
    auditCreateMock.mockResolvedValue({});
    userFindUniqueMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("falls back to inactive Stripe lookup when active lookup misses", async () => {
    listMock.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [{ id: "price_from_inactive_1" }] });

    const report = await runCatalogStripePriceBackfill({
      actorId: "admin-1",
      dryRun: true,
      runId: "resolver-fallback-run",
      persistEvidence: false,
    });

    expect(report.entries[0]?.resolvedStripePriceId).toBe("price_from_inactive_1");
    expect(report.entries[0]?.resolution).toBe("WOULD_LINK");
  });

  it("surfaces Stripe lookup failures", async () => {
    listMock.mockRejectedValueOnce(new Error("stripe lookup unavailable"));

    await expect(
      runCatalogStripePriceBackfill({
        actorId: "admin-1",
        dryRun: true,
        runId: "resolver-failure-run",
        persistEvidence: false,
      }),
    ).rejects.toThrow("stripe lookup unavailable");
  });
});
