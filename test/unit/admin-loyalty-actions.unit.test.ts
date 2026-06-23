import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
);

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requireAdminSession: vi.fn(),
  assertSameOriginServerAction: vi.fn(),
  upsertLoyaltyProgramSettingsByAdmin: vi.fn(),
  saveLoyaltyRewardDefinitionByAdmin: vi.fn(),
  archiveLoyaltyRewardDefinitionByAdmin: vi.fn(),
  grantManualLoyaltyPointsByAdmin: vi.fn(),
  resolveAdminLoyaltyClientIdByEmail: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("@/lib/security/same-origin", () => ({
  assertSameOriginServerAction: mocks.assertSameOriginServerAction,
}));

vi.mock("@/lib/loyalty/loyalty-admin-service", () => ({
  upsertLoyaltyProgramSettingsByAdmin: mocks.upsertLoyaltyProgramSettingsByAdmin,
  saveLoyaltyRewardDefinitionByAdmin: mocks.saveLoyaltyRewardDefinitionByAdmin,
  archiveLoyaltyRewardDefinitionByAdmin: mocks.archiveLoyaltyRewardDefinitionByAdmin,
  grantManualLoyaltyPointsByAdmin: mocks.grantManualLoyaltyPointsByAdmin,
  resolveAdminLoyaltyClientIdByEmail: mocks.resolveAdminLoyaltyClientIdByEmail,
}));

import {
  archiveLoyaltyRewardAction,
  grantLoyaltyPointsAction,
  saveLoyaltyRewardAction,
  saveLoyaltyProgramAction,
} from "../../src/app/admin/(private)/sales/loyalty/actions";

function makeForm(input: Record<string, string | string[]>) {
  const formData = new FormData();
  for (const [key, rawValue] of Object.entries(input)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      formData.append(key, value);
    }
  }
  return formData;
}

describe("admin loyalty actions", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    mocks.revalidatePath.mockReset();
    mocks.requireAdminSession.mockReset();
    mocks.assertSameOriginServerAction.mockReset();
    mocks.upsertLoyaltyProgramSettingsByAdmin.mockReset();
    mocks.grantManualLoyaltyPointsByAdmin.mockReset();
    mocks.resolveAdminLoyaltyClientIdByEmail.mockReset();
    mocks.requireAdminSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.assertSameOriginServerAction.mockResolvedValue(undefined);
    mocks.resolveAdminLoyaltyClientIdByEmail.mockResolvedValue({
      id: "client-1",
      email: "client@example.test",
    });
  });

  it("blocks loyalty program mutation when same-origin enforcement fails", async () => {
    mocks.assertSameOriginServerAction.mockRejectedValueOnce(new Error("CSRF_INVALID_ORIGIN"));

    await expect(
      saveLoyaltyProgramAction(makeForm({
        currencyCode: "EUR",
        earningPoints: "1",
        earningAmountDisplay: "1.00",
        pointsExpireAfterDays: "180",
        expirationReminderDays: "30",
        maxManualGrantPoints: "5000",
        eligibleProductIds: ["product-1"],
      })),
    ).rejects.toThrow("CSRF_INVALID_ORIGIN");

    expect(mocks.requireAdminSession).not.toHaveBeenCalled();
    expect(mocks.upsertLoyaltyProgramSettingsByAdmin).not.toHaveBeenCalled();
  });

  it("redirects with success after saving loyalty program settings", async () => {
    await expect(
      saveLoyaltyProgramAction(makeForm({
        currencyCode: "EUR",
        isActive: "on",
        earningPoints: "2",
        earningAmountDisplay: "5.00",
        pointsExpireAfterDays: "180",
        expirationReminderDays: "30",
        maxManualGrantPoints: "5000",
        eligibleProductIds: ["product-1"],
        clientId: "client-1",
        query: "client@example.test",
        page: "2",
      })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/catalog/loyalty?currencyCode=EUR&success=Loyalty+program+updated.");

    expect(mocks.upsertLoyaltyProgramSettingsByAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "admin-1",
        currencyCode: "EUR",
        earningPoints: 2,
        earningAmountMinor: 500,
        eligibleProductIds: ["product-1"],
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/sales/loyalty");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/catalog/loyalty");
  });

  it("maps manual grant limit failures to the loyalty page banner", async () => {
    mocks.grantManualLoyaltyPointsByAdmin.mockRejectedValueOnce(new Error("Manual loyalty grant exceeds the configured maximum."));

    await expect(
      grantLoyaltyPointsAction(makeForm({
        currencyCode: "EUR",
        clientEmail: "client@example.test",
        amountPoints: "9000",
        reason: "Exceeded configured maximum for testing.",
        grantRequestKey: "grant-123",
      })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/sales/loyalty?currencyCode=EUR&error=Manual+grant+exceeds+the+configured+maximum.");
  });

  it("uses a deterministic idempotency key for manual grants", async () => {
    mocks.grantManualLoyaltyPointsByAdmin.mockResolvedValueOnce({
      outcome: "created",
      entry: { id: "entry-1" },
    });

    await expect(
      grantLoyaltyPointsAction(makeForm({
        currencyCode: "EUR",
        clientEmail: "client@example.test",
        amountPoints: "100",
        reason: "Rewarding a customer after a support resolution.",
        grantRequestKey: "grant-456",
        query: "client@example.test",
        page: "3",
      })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/sales/loyalty?currencyCode=EUR&q=client%40example.test&page=3&success=Loyalty+points+granted.");

    expect(mocks.grantManualLoyaltyPointsByAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "loyalty:manual-grant:admin-action:admin-1:client-1:grant-456",
      }),
    );
  });

  it("saves loyalty reward definitions separately from program settings", async () => {
    await expect(
      saveLoyaltyRewardAction(makeForm({
        programId: "program-1",
        currencyCode: "EUR",
        name: "10 EURO Reward",
        pointsRequired: "1000",
        amountDisplay: "10.00",
      })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/catalog/loyalty?currencyCode=EUR&success=Loyalty+reward+updated.");

    expect(mocks.saveLoyaltyRewardDefinitionByAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "admin-1",
        programId: "program-1",
        name: "10 EURO Reward",
        pointsRequired: 1000,
        amountMinor: 1000,
      }),
    );
  });

  it("archives loyalty reward definitions from the catalog page", async () => {
    await expect(
      archiveLoyaltyRewardAction(makeForm({
        programId: "program-1",
        rewardDefinitionId: "reward-1",
        currencyCode: "EUR",
      })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/catalog/loyalty?currencyCode=EUR&success=Loyalty+reward+archived.");

    expect(mocks.archiveLoyaltyRewardDefinitionByAdmin).toHaveBeenCalledWith({
      actorUserId: "admin-1",
      programId: "program-1",
      rewardDefinitionId: "reward-1",
    });
  });
});
