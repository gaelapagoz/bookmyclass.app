import "./helpers/setup-env";

import { GiftCardWalletStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/auth", () => ({
  auth: vi.fn(async () => null),
}));

import { auth } from "../../src/auth";
import { GET as walletBalanceRoute } from "../../src/app/api/wallet/balance/route";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

async function seedClient() {
  return prisma.user.create({
    data: {
      name: "Wallet Test Client",
      email: `wallet.balance.${Date.now()}.${Math.random()}@example.test`,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
    },
  });
}

describe("GET /api/wallet/balance", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(auth).mockResolvedValue(null);
  });

  it("returns 401 with null balance when unauthenticated", async () => {
    const response = await walletBalanceRoute();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ balance: null });
  });

  it("returns 200 with null balance when authenticated but no wallet exists", async () => {
    const client = await seedClient();
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await walletBalanceRoute();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ balance: null });
  });

  it("returns 200 with balance when authenticated and wallet exists", async () => {
    const client = await seedClient();
    await prisma.giftCardWallet.create({
      data: {
        clientId: client.id,
        currencyCode: "EUR",
        balanceMinor: 5_000,
        status: GiftCardWalletStatus.ACTIVE,
      },
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await walletBalanceRoute();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { balance: { balanceMinor: number; currencyCode: string } | null };
    expect(body.balance).not.toBeNull();
    expect(body.balance?.balanceMinor).toBe(5_000);
    expect(body.balance?.currencyCode).toBe("EUR");
  });
});
