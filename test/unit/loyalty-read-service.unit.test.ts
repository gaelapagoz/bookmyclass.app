import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  loyaltyAggregate: vi.fn(),
  loyaltyFindMany: vi.fn(),
  loyaltyGroupBy: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
    },
    loyaltyPointsLedgerEntry: {
      aggregate: mocks.loyaltyAggregate,
      findMany: mocks.loyaltyFindMany,
      groupBy: mocks.loyaltyGroupBy,
    },
  },
}));

vi.mock("@/lib/loyalty/loyalty-program-service", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/loyalty/loyalty-program-service")>("../../src/lib/loyalty/loyalty-program-service");
  return {
    ...actual,
    getLoyaltyProgramForCurrency: vi.fn(async () => null),
  };
});

import { Prisma, Role, UserActivationStatus } from "@prisma/client";
import { getClientLoyaltySummary, listClientLoyaltyHistory } from "../../src/lib/loyalty/loyalty-read-service";

function makeP2021Error(message: string) {
  return new Prisma.PrismaClientKnownRequestError(
    message,
    { code: "P2021", clientVersion: "7.5.0" },
  );
}

describe("loyalty-read-service missing table fallback", () => {
  it("returns zero summary and empty history when loyalty ledger table is missing", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "client-1",
      name: "Client One",
      email: "client@example.test",
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date("2026-01-01T00:00:00.000Z"),
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    mocks.loyaltyAggregate.mockRejectedValue(
      makeP2021Error("The table `public.LoyaltyPointsLedgerEntry` does not exist in the current database."),
    );
    mocks.loyaltyFindMany.mockRejectedValue(
      makeP2021Error("The table `public.LoyaltyPointsLedgerEntry` does not exist in the current database."),
    );
    mocks.loyaltyGroupBy.mockRejectedValue(
      makeP2021Error("The table `public.LoyaltyPointsLedgerEntry` does not exist in the current database."),
    );

    const summary = await getClientLoyaltySummary({
      actor: { type: "CLIENT", userId: "client-1" },
      clientId: "client-1",
      currencyCode: "EUR",
    });
    const history = await listClientLoyaltyHistory({
      actor: { type: "CLIENT", userId: "client-1" },
      clientId: "client-1",
      currencyCode: "EUR",
      limit: 10,
    });

    expect(summary.balancePoints).toBe(0);
    expect(summary.program).toBeNull();
    expect(summary.expiringPoints).toBe(0);
    expect(history).toEqual([]);
  });

  it("reports only the next-expiring positive bucket in the summary", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "client-1",
      name: "Client One",
      email: "client@example.test",
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date("2026-01-01T00:00:00.000Z"),
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    mocks.loyaltyAggregate.mockResolvedValue({
      _sum: { amountPoints: 60 },
      _max: { happenedAt: new Date("2026-06-01T00:00:00.000Z") },
    });
    mocks.loyaltyFindMany.mockResolvedValue([
      {
        id: "bucket-1",
        amountPoints: 30,
        expiresAt: new Date("2026-08-01T00:00:00.000Z"),
        derivedEntries: [],
      },
      {
        id: "bucket-2",
        amountPoints: 20,
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
        derivedEntries: [],
      },
      {
        id: "bucket-3",
        amountPoints: 15,
        expiresAt: new Date("2026-08-01T00:00:00.000Z"),
        derivedEntries: [{ amountPoints: -5 }],
      },
    ]);
    mocks.loyaltyGroupBy.mockResolvedValue([
      {
        entryType: "EARN",
        _sum: { amountPoints: 60 },
      },
    ]);

    const summary = await getClientLoyaltySummary({
      actor: { type: "CLIENT", userId: "client-1" },
      clientId: "client-1",
      currencyCode: "EUR",
    });

    expect(summary.expiringPoints).toBe(40);
    expect(summary.nextExpirationAt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });
});
