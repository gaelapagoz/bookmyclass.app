import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hashMock = vi.fn(async () => "hashed-password");
const upsertMock = vi.fn(async () => ({}));
const countMock = vi.fn(async () => 0);
const transactionMock = vi.fn(async () => [1, 0, 0, 0] as const);
const mediaSyncMock = vi.fn();
const mediaVerifyMock = vi.fn();

vi.mock("bcryptjs", () => ({
  hash: (...args: unknown[]) => hashMock(...args),
}));

vi.mock("../../src/lib/db", () => ({
  default: {
    user: {
      upsert: (...args: unknown[]) => upsertMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

vi.mock("../../prisma/seed/utils/seed-media", () => ({
  syncSeedMediaPath: (...args: unknown[]) => mediaSyncMock(...args),
  verifySeededMediaReferences: (...args: unknown[]) => mediaVerifyMock(...args),
}));

import { runProductionSeed } from "../../prisma/seed/modes/production";
import { SEEDED_USER_PASSWORD } from "../../prisma/seed/seed-credentials";

describe("production seed mode", () => {
  beforeEach(() => {
    hashMock.mockClear();
    upsertMock.mockClear();
    countMock.mockClear();
    transactionMock.mockClear();
    mediaSyncMock.mockClear();
    mediaVerifyMock.mockClear();
    transactionMock.mockResolvedValue([1, 0, 0, 0] as const);
  });

  it("creates only deterministic bootstrap MASTER_ADMIN credentials", async () => {
    await runProductionSeed();

    expect(hashMock).toHaveBeenCalledWith(SEEDED_USER_PASSWORD, 12);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "master@bookmyclass.app" },
        create: expect.objectContaining({
          role: Role.MASTER_ADMIN,
          email: "master@bookmyclass.app",
          isActive: true,
          isInactive: false,
        }),
      }),
    );
  });

  it("fails when production seed would create non-minimal role records", async () => {
    transactionMock.mockResolvedValueOnce([1, 1, 0, 0] as const);
    await expect(runProductionSeed()).rejects.toThrow(/expected minimal dataset only/);
  });

  it("fails when production seed has multiple MASTER_ADMIN records", async () => {
    transactionMock.mockResolvedValueOnce([2, 0, 0, 0] as const);
    await expect(runProductionSeed()).rejects.toThrow(/expected exactly one bootstrap MASTER_ADMIN/);
  });

  it("does not call media sync or media verification dependencies", async () => {
    await runProductionSeed();
    expect(mediaSyncMock).not.toHaveBeenCalled();
    expect(mediaVerifyMock).not.toHaveBeenCalled();
  });
});
