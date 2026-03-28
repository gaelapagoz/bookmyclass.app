import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

vi.mock("@/lib/admin/admin-service", () => ({
  adjustAdminClientCredits: vi.fn(),
  cancelAdminClientMembership: vi.fn(),
  createAdminClass: vi.fn(),
  upsertAdminClassScheduleConfig: vi.fn(),
  createAdminRecurringSessions: vi.fn(),
  createAdminSession: vi.fn(),
  createAdminPlan: vi.fn(),
  createAdminSubscription: vi.fn(),
  updateAdminLearningVideo: vi.fn(),
  updateAdminPlan: vi.fn(),
  updateAdminUser: vi.fn(),
}));

vi.mock("@/lib/public-documents/agenda-document-service", () => ({
  upsertActiveAgendaPdfDocument: vi.fn(),
}));

vi.mock("@/lib/client-messages/client-message-service", () => ({
  updateClientMessageStatus: vi.fn(),
}));

import { auth } from "@/auth";
import {
  adjustAdminClientCredits,
  cancelAdminClientMembership,
  createAdminClass,
  createAdminPlan,
  createAdminSubscription,
  upsertAdminClassScheduleConfig,
  updateAdminLearningVideo,
  updateAdminPlan,
  updateAdminUser,
} from "@/lib/admin/admin-service";

import {
  adjustClientCreditsAction,
  cancelClientMembershipAction,
  createClassAction,
  createPlanAction,
  createSubscriptionAction,
  updateLearningVideoAction,
  updatePlanAction,
  updateUserAction,
} from "../../src/app/admin/(private)/actions";

function createAdminSession(role: "ADMIN" | "MASTER_ADMIN" | "CLIENT") {
  return {
    user: {
      id: "user-1",
      email: "user@example.test",
      role,
    },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

describe("admin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated class creation", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    await expect(createClassAction(new FormData())).rejects.toThrow("UNAUTHENTICATED");
  });

  it("rejects non-admin class creation", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("CLIENT"));

    await expect(createClassAction(new FormData())).rejects.toThrow("FORBIDDEN");
  });

  it("creates class and redirects on happy path", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(createAdminClass).mockResolvedValue({
      id: "class-1",
      name: "Vinyasa",
      slug: "vinyasa",
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
    });

    const formData = new FormData();
    formData.set("categoryId", "cat-1");
    formData.set("name", "Vinyasa");
    formData.set("slug", "vinyasa");
    formData.set("defaultDurationMinutes", "60");
    formData.set("defaultCapacity", "12");
    formData.set("sortOrder", "1");
    formData.set("isActive", "on");
    formData.set("isVisible", "on");
    formData.set("defaultTeacherId", "teacher-1");
    formData.set("scheduleStartTime", "18:00");
    formData.set("scheduleEndTime", "19:00");
    formData.set("scheduleDate", "2026-04-01");

    await expect(createClassAction(formData)).rejects.toThrow("NEXT_REDIRECT:/admin/classes");
    expect(createAdminClass).toHaveBeenCalledTimes(1);
    expect(upsertAdminClassScheduleConfig).toHaveBeenCalledTimes(1);
  });

  it("redirects with validation error when class payload is invalid", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();
    formData.set("name", "");

    await expect(createClassAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/classes/new?error=Please%20complete%20all%20required%20class%20fields.",
    );
    expect(createAdminClass).not.toHaveBeenCalled();
  });

  it("rejects invalid recurring class schedule payload", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();
    formData.set("categoryId", "cat-1");
    formData.set("name", "Vinyasa");
    formData.set("slug", "vinyasa");
    formData.set("defaultDurationMinutes", "60");
    formData.set("defaultCapacity", "12");
    formData.set("sortOrder", "1");
    formData.set("isActive", "on");
    formData.set("isVisible", "on");
    formData.set("defaultTeacherId", "teacher-1");
    formData.set("scheduleStartTime", "18:00");
    formData.set("scheduleEndTime", "19:00");
    formData.set("isRecurring", "on");
    formData.set("endsType", "never");

    await expect(createClassAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/classes/new?error=Please%20complete%20all%20required%20class%20schedule%20fields.",
    );
    expect(createAdminClass).not.toHaveBeenCalled();
  });
  it("creates plan with price on happy path", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(createAdminPlan).mockResolvedValue({ id: "plan-1" });

    const formData = new FormData();
    formData.set("name", "Unlimited Monthly");
    formData.set("productType", "UNLIMITED_MEMBERSHIP");
    formData.set("sortOrder", "1");
    formData.set("priceName", "Monthly Membership");
    formData.set("priceType", "RECURRING");
    formData.set("currencyCode", "EUR");
    formData.set("unitAmount", "89");
    formData.set("billingInterval", "MONTH");
    formData.set("billingIntervalCount", "1");
    formData.set("isActive", "on");

    await expect(createPlanAction(formData)).rejects.toThrow("NEXT_REDIRECT:/admin/plans");
    expect(createAdminPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Unlimited Monthly",
        priceType: "RECURRING",
        currencyCode: "EUR",
        unitAmountMinor: 8900,
      }),
    );
  });

  it("rejects invalid plan payload when recurring interval is missing", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();
    formData.set("name", "Unlimited Monthly");
    formData.set("productType", "UNLIMITED_MEMBERSHIP");
    formData.set("sortOrder", "1");
    formData.set("priceType", "RECURRING");
    formData.set("currencyCode", "EUR");
    formData.set("unitAmount", "89");

    await expect(createPlanAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/plans/new?error=Please%20complete%20all%20required%20plan%20fields.",
    );
    expect(createAdminPlan).not.toHaveBeenCalled();
  });

  it("updates plan with price on happy path", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminPlan).mockResolvedValue({ id: "plan-1" });

    const formData = new FormData();
    formData.set("name", "Unlimited Monthly Pro");
    formData.set("productType", "UNLIMITED_MEMBERSHIP");
    formData.set("sortOrder", "1");
    formData.set("priceName", "Monthly Membership Pro");
    formData.set("priceType", "ONE_TIME");
    formData.set("currencyCode", "EUR");
    formData.set("unitAmount", "99");
    formData.set("isActive", "on");

    await expect(updatePlanAction("plan-1", formData)).rejects.toThrow("NEXT_REDIRECT:/admin/plans");
    expect(updateAdminPlan).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({
        name: "Unlimited Monthly Pro",
        priceType: "ONE_TIME",
        unitAmountMinor: 9900,
      }),
    );
  });

  it("redirects with validation error when subscription period is invalid", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();
    formData.set("clientId", "client-1");
    formData.set("productId", "product-1");
    formData.set("priceId", "price-1");
    formData.set("status", "ACTIVE");
    formData.set("startsAt", "2026-03-22T10:00");
    formData.set("currentPeriodStart", "2026-03-22T10:00");
    formData.set("currentPeriodEnd", "2026-03-21T10:00");
    formData.set("provider", "STRIPE");

    await expect(createSubscriptionAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/subscriptions/new?error=Please%20complete%20all%20required%20subscription%20fields.",
    );
    expect(createAdminSubscription).not.toHaveBeenCalled();
  });

  it("handles invalid subscription relation error", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(createAdminSubscription).mockRejectedValue(new Error("PRICE_PRODUCT_MISMATCH"));

    const formData = new FormData();
    formData.set("clientId", "client-1");
    formData.set("productId", "product-1");
    formData.set("priceId", "price-1");
    formData.set("status", "ACTIVE");
    formData.set("startsAt", "2026-03-22T10:00");
    formData.set("currentPeriodStart", "2026-03-22T10:00");
    formData.set("currentPeriodEnd", "2026-04-22T10:00");
    formData.set("provider", "STRIPE");

    await expect(createSubscriptionAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/subscriptions/new?error=Unexpected%20server%20error.",
    );
  });

  it("updates learning video and redirects", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminLearningVideo).mockResolvedValue({ id: "video-1" });

    const formData = new FormData();
    formData.set("legacyId", "100");
    formData.set("title", "Intro");
    formData.set("category", "Yoga");
    formData.set("priority", "1");

    await expect(updateLearningVideoAction("video-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-videos",
    );
    expect(updateAdminLearningVideo).toHaveBeenCalledWith(
      "video-1",
      expect.objectContaining({ legacyId: "100", title: "Intro", category: "Yoga", priority: 1 }),
    );
  });

  it("updates user without password and keeps happy path", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminUser).mockResolvedValue({ id: "user-1" });

    const formData = new FormData();
    formData.set("firstName", "Jane");
    formData.set("lastName", "Doe");
    formData.set("email", "jane@example.test");
    formData.set("role", "ADMIN");
    formData.set("isActive", "on");

    await expect(updateUserAction("user-1", formData)).rejects.toThrow("NEXT_REDIRECT:/admin/users");
    expect(updateAdminUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ firstName: "Jane", lastName: "Doe", email: "jane@example.test", role: "ADMIN" }),
    );
  });

  it("adjusts client credits and redirects", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(adjustAdminClientCredits).mockResolvedValue(undefined);

    const formData = new FormData();
    formData.set("userId", "client-1");
    formData.set("entitlementId", "ent-1");
    formData.set("creditDelta", "2");

    await expect(adjustClientCreditsAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/client-1/edit",
    );
    expect(adjustAdminClientCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        entitlementId: "ent-1",
        amount: 2,
      }),
    );
  });

  it("rejects missing credits payload with explicit validation error", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();
    formData.set("userId", "client-1");

    await expect(adjustClientCreditsAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/client-1/edit?error=Invalid%20credits%20update%20payload.",
    );
    expect(adjustAdminClientCredits).not.toHaveBeenCalled();
  });

  it("returns actionable error when admin session user no longer exists", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(adjustAdminClientCredits).mockRejectedValue(new Error("ADMIN_USER_NOT_FOUND"));

    const formData = new FormData();
    formData.set("userId", "client-1");
    formData.set("entitlementId", "ent-1");
    formData.set("creditDelta", "1");

    await expect(adjustClientCreditsAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/client-1/edit?error=Your%20admin%20session%20is%20no%20longer%20valid.%20Sign%20in%20again%20and%20retry.",
    );
  });
  it("cancels client membership and redirects", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(cancelAdminClientMembership).mockResolvedValue(undefined);

    const formData = new FormData();
    formData.set("clientId", "client-1");
    formData.set("subscriptionContractId", "sub-1");

    await expect(cancelClientMembershipAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/client-1/edit",
    );
    expect(cancelAdminClientMembership).toHaveBeenCalledWith({
      clientId: "client-1",
      subscriptionContractId: "sub-1",
    });
  });
});









