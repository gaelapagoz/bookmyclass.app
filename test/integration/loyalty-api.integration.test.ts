import "./helpers/setup-env";

import { Role, UserActivationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/auth", () => ({
  auth: vi.fn(async () => null),
}));

import { auth } from "../../src/auth";
import { GET as loyaltyWalletRoute } from "../../src/app/api/loyalty/wallet/route";
import { POST as loyaltyRedeemRoute } from "../../src/app/api/loyalty/redeem/route";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

const sameOriginHeaders = {
  "content-type": "application/json",
  origin: "http://localhost",
  referer: "http://localhost/dashboard/wallet",
  "x-forwarded-host": "localhost",
  "x-forwarded-proto": "http",
};

async function seedVerifiedClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Loyalty Client ${unique}`,
      email: `loyalty-client-${unique}@example.test`,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      emailVerifiedAt: new Date(),
    },
  });
}

async function seedInactiveClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Inactive Loyalty Client ${unique}`,
      email: `inactive-loyalty-client-${unique}@example.test`,
      role: Role.CLIENT,
      isActive: false,
      isInactive: true,
      activationStatus: UserActivationStatus.DISABLED,
      emailVerified: new Date(),
      emailVerifiedAt: new Date(),
    },
  });
}

async function seedAdmin() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Loyalty Admin ${unique}`,
      email: `loyalty-admin-${unique}@example.test`,
      role: Role.ADMIN,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      emailVerifiedAt: new Date(),
    },
  });
}

async function seedProgramWithReward() {
  const program = await prisma.loyaltyProgram.create({
    data: {
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      maxManualGrantPoints: 5_000,
    },
  });

  const reward = await prisma.loyaltyRewardDefinition.create({
    data: {
      programId: program.id,
      name: "5 EURO Reward",
      pointsRequired: 500,
      amountMinor: 500,
      isActive: true,
    },
  });

  return { program, reward };
}

describe("loyalty API routes", () => {
  beforeEach(async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await resetDb();
  });

  it("returns 401 for wallet reads without an authenticated session", async () => {
    const response = await loyaltyWalletRoute();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED", loyalty: null });
  });

  it("returns 403 for wallet reads without an active verified client", async () => {
    const inactiveClient = await seedInactiveClient();
    vi.mocked(auth).mockResolvedValue({
      user: { id: inactiveClient.id, name: inactiveClient.name, email: inactiveClient.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await loyaltyWalletRoute();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CLIENT_ACCESS_REQUIRED", loyalty: null });
  });

  it("returns wallet summary and rewards for a verified client", async () => {
    const client = await seedVerifiedClient();
    const { reward } = await seedProgramWithReward();
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await loyaltyWalletRoute();
    const body = await response.json() as {
      loyalty: {
        currencyCode: string;
        summary: { balancePoints: number };
        loyaltyCredit: { availableBalanceMinor: number };
        rewards: Array<{ id: string; name: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.loyalty.currencyCode).toBe("EUR");
    expect(body.loyalty.summary.balancePoints).toBe(0);
    expect(body.loyalty.loyaltyCredit.availableBalanceMinor).toBe(0);
    expect(body.loyalty.rewards).toEqual([
      expect.objectContaining({ id: reward.id, name: "5 EURO Reward" }),
    ]);
  });

  it("rejects redeem mutation when Origin is cross-site", async () => {
    const client = await seedVerifiedClient();
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await loyaltyRedeemRoute(new Request("http://localhost/api/loyalty/redeem", {
      method: "POST",
      headers: { ...sameOriginHeaders, origin: "https://evil.example", referer: "https://evil.example/wallet" },
      body: JSON.stringify({ rewardDefinitionId: "reward-1" }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CSRF_ORIGIN_MISMATCH" });
  });

  it("returns 403 for redeem mutation without an active verified client", async () => {
    const admin = await seedAdmin();
    vi.mocked(auth).mockResolvedValue({
      user: { id: admin.id, name: admin.name, email: admin.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await loyaltyRedeemRoute(new Request("http://localhost/api/loyalty/redeem", {
      method: "POST",
      headers: sameOriginHeaders,
      body: JSON.stringify({ rewardDefinitionId: "reward-1" }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CLIENT_ACCESS_REQUIRED" });
  });

  it("maps loyalty redemption failures to 422 responses", async () => {
    const client = await seedVerifiedClient();
    await seedProgramWithReward();
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await loyaltyRedeemRoute(new Request("http://localhost/api/loyalty/redeem", {
      method: "POST",
      headers: sameOriginHeaders,
      body: JSON.stringify({ rewardDefinitionId: "missing-reward" }),
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "LOYALTY_REWARD_NOT_FOUND" });
  });

  it("redeems an active reward for a verified client", async () => {
    const client = await seedVerifiedClient();
    const { reward } = await seedProgramWithReward();
    await prisma.loyaltyPointsLedgerEntry.create({
      data: {
        clientId: client.id,
        entryType: "MANUAL_GRANT",
        amountPoints: 500,
        currencyCode: "EUR",
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
        createdById: client.id,
        reason: "Seed points for route success coverage.",
        idempotencyKey: `loyalty:manual-grant:route-success:${client.id}`,
        metadata: { source: "integration-test" },
      },
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await loyaltyRedeemRoute(new Request("http://localhost/api/loyalty/redeem", {
      method: "POST",
      headers: sameOriginHeaders,
      body: JSON.stringify({ rewardDefinitionId: reward.id }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "REDEEMED" });
    await expect(prisma.loyaltyRewardRedemption.count({ where: { clientId: client.id } })).resolves.toBe(1);
  });
});
