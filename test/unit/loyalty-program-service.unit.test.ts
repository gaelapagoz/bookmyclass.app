import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loyaltyProgramFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    loyaltyProgram: {
      findMany: mocks.loyaltyProgramFindMany,
    },
  },
}));

import { Prisma } from "@prisma/client";
import { listLoyaltyPrograms, resolvePrimaryLoyaltyCurrencyCode } from "../../src/lib/loyalty/loyalty-program-service";

function makeP2021Error(message: string) {
  return new Prisma.PrismaClientKnownRequestError(
    message,
    { code: "P2021", clientVersion: "7.5.0" },
  );
}

describe("loyalty-program-service missing table fallback", () => {
  it("returns empty programs and EUR fallback when LoyaltyProgram table is missing", async () => {
    mocks.loyaltyProgramFindMany.mockRejectedValue(
      makeP2021Error("The table `public.LoyaltyProgram` does not exist in the current database."),
    );

    await expect(listLoyaltyPrograms()).resolves.toEqual([]);
    await expect(resolvePrimaryLoyaltyCurrencyCode()).resolves.toBe("EUR");
  });
});
