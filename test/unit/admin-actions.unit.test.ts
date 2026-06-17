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

vi.mock("@/lib/security/same-origin", () => ({
  assertSameOriginServerAction: vi.fn(async () => undefined),
}));

const { revalidatePathMock } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const { accessMock, mkdirMock, readdirMock, unlinkMock, writeFileMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  mkdirMock: vi.fn(),
  readdirMock: vi.fn(),
  unlinkMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  access: accessMock,
  mkdir: mkdirMock,
  readdir: readdirMock,
  unlink: unlinkMock,
  writeFile: writeFileMock,
}));
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => {
        const { auth } = await import("@/auth");
        const session = await auth();
        if (!session?.user) return null;
        return {
          role: session.user.role,
          activationStatus: "ACTIVE",
          isActive: true,
        };
      }),
    },
  },
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: vi.fn(async () => {
    const { auth } = await import("@/auth");
    const session = await auth();

    if (!session?.user?.id) {
      throw new Error("UNAUTHENTICATED");
    }

    const role = session.user.role;
    if (role !== "ADMIN" && role !== "MASTER_ADMIN") {
      throw new Error("FORBIDDEN");
    }

    return {
      ...session,
      user: {
        ...session.user,
        role,
      },
    };
  }),
}));

vi.mock("@/lib/admin/admin-catalog-core-service", () => ({
  cleanupAdminClassCreateFailure: vi.fn(),
  cleanupAdminLearningProgramCreateFailure: vi.fn(),
  createAdminClass: vi.fn(),
  createAdminClassCategory: vi.fn(),
  updateAdminClassCategory: vi.fn(),
  createAdminLearningProgram: vi.fn(),
  createAdminLearningVideo: vi.fn(),
  getAdminLearningVideoById: vi.fn(),
  createAdminPlan: vi.fn(),
  createAdminSubscription: vi.fn(),
  createAdminSiteWeeklyScheduleEntry: vi.fn(),
  updateAdminSiteWeeklyScheduleEntry: vi.fn(),
  deleteAdminSiteWeeklyScheduleEntry: vi.fn(),
  updateAdminCancellationPeriodHours: vi.fn(),
  updateAdminSiteTimeZone: vi.fn(),
  resolveAdminActorUser: vi.fn(),
  updateAdminClassImage: vi.fn(),
  updateAdminLearningProgram: vi.fn(),
  updateAdminLearningVideo: vi.fn(),
  updateAdminPlan: vi.fn(),
}));

vi.mock("@/lib/admin/admin-session-service", () => ({
  createAdminRecurringSessions: vi.fn(),
  createAdminSession: vi.fn(),
  updateAdminSession: vi.fn(),
  upsertAdminClassScheduleConfig: vi.fn(),
}));

vi.mock("@/lib/site-settings/site-settings-service", () => ({
  getSiteTimeZone: vi.fn(async () => "Europe/Brussels"),
}));

vi.mock("@/lib/admin/admin-booking-service", () => ({
  addSessionAttendeeByManager: vi.fn(),
  removeSessionAttendeeByManager: vi.fn(),
}));

vi.mock("@/lib/admin/admin-user-service", () => ({
  adjustAdminClientCredits: vi.fn(),
  bulkAddClientMarketingSegments: vi.fn(),
  bulkRemoveClientMarketingSegments: vi.fn(),
  bulkSetClientMarketingSubscriptionStatus: vi.fn(),
  cancelAdminClientMembership: vi.fn(),
  createAdminUser: vi.fn(),
  updateAdminTeacherImage: vi.fn(),
  updateAdminUser: vi.fn(),
}));

vi.mock("@/lib/marketing/marketing-renderer", () => ({
  normalizeMarketingContentJson: vi.fn((x: unknown) => x),
}));

vi.mock("@/lib/marketing/marketing-service", () => ({
  createMarketingCampaignFlowDraft: vi.fn(),
  updateMarketingCampaignFlowDraft: vi.fn(),
  getMarketingCampaignFlowDraftById: vi.fn(),
  resolveMarketingCampaignFlowRecipients: vi.fn(async () => ({
    selectedSegmentIds: [],
    segmentOptions: [],
    totalRecipients: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    recipients: [],
  })),
}));

vi.mock("@/lib/public-documents/agenda-document-service", () => ({
  upsertActiveAgendaPdfDocument: vi.fn(),
}));

vi.mock("@/lib/client-messages/client-message-service", () => ({
  updateClientMessageStatus: vi.fn(),
}));

import { auth } from "@/auth";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";
import {
  cleanupAdminClassCreateFailure,
  cleanupAdminLearningProgramCreateFailure,
  createAdminClass,
  createAdminClassCategory,
  updateAdminClassCategory,
  createAdminLearningProgram,
  createAdminLearningVideo,
  getAdminLearningVideoById,
  createAdminPlan,
  createAdminSubscription,
  createAdminSiteWeeklyScheduleEntry,
  updateAdminSiteWeeklyScheduleEntry,
  deleteAdminSiteWeeklyScheduleEntry,
  updateAdminCancellationPeriodHours,
  updateAdminSiteTimeZone,
  resolveAdminActorUser,
  updateAdminLearningProgram,
  updateAdminLearningVideo,
  updateAdminPlan,
} from "@/lib/admin/admin-catalog-core-service";
import {
  createAdminSession as createAdminSessionService,
  updateAdminSession,
  upsertAdminClassScheduleConfig,
} from "@/lib/admin/admin-session-service";
import { getSiteTimeZone } from "@/lib/site-settings/site-settings-service";
import {
  addSessionAttendeeByManager,
  removeSessionAttendeeByManager,
} from "@/lib/admin/admin-booking-service";
import {
  adjustAdminClientCredits,
  cancelAdminClientMembership,
  createAdminUser,
  updateAdminTeacherImage,
  updateAdminUser,
} from "@/lib/admin/admin-user-service";
import { updateMarketingCampaignFlowDraft } from "@/lib/marketing/marketing-service";

import {
  addSessionAttendeeAction,
  adjustClientCreditsAction,
  cancelClientMembershipAction,
  createClassAction,
  createClassCategoryAction,
  createSessionAction,
  createLearningProgramAction,
  createLearningVideoAction,
  createPlanAction,
  createSiteWeeklyScheduleEntryAction,
  createSubscriptionAction,
  createUserAction,
  deleteSiteWeeklyScheduleEntryAction,
  removeSessionAttendeeAction,
  saveMarketingCampaignFlowDraftAction,
  updateCancellationPeriodAction,
  updateSiteTimeZoneAction,
  updateLearningProgramAction,
  updateLearningVideoAction,
  updatePlanAction,
  updateSessionAction,
  updateSiteWeeklyScheduleEntryAction,
  updateSessionAttendanceAction,
  uploadClassImageAction,
  uploadTeacherImageAction,
  updateUserAction,
  updateClassCategoryAction,
} from "../../src/app/admin/(private)/actions";

function createPngFile(name = "image.png") {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name, {
    type: "image/png",
  });
}
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
    formData.set("classImage", createPngFile("vinyasa.png"));
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
    expect(createAdminClass).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: expect.stringMatching(/^\/uploads\/classes\/service-vinyasa-/) }));
    expect(upsertAdminClassScheduleConfig).toHaveBeenCalledTimes(1);
  });

  it("cleans class row and uploaded image when schedule persistence fails", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(createAdminClass).mockResolvedValue({
      id: "class-1",
      name: "Vinyasa",
      slug: "vinyasa",
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
    });
    vi.mocked(upsertAdminClassScheduleConfig).mockRejectedValueOnce(new Error("SCHEDULE_DATE_REQUIRED"));

    const formData = new FormData();
    formData.set("categoryId", "cat-1");
    formData.set("name", "Vinyasa");
    formData.set("classImage", createPngFile("vinyasa.png"));
    formData.set("defaultDurationMinutes", "60");
    formData.set("defaultCapacity", "12");
    formData.set("sortOrder", "1");
    formData.set("isActive", "on");
    formData.set("isVisible", "on");
    formData.set("defaultTeacherId", "teacher-1");
    formData.set("scheduleStartTime", "18:00");
    formData.set("scheduleEndTime", "19:00");
    formData.set("scheduleDate", "2026-04-01");

    await expect(createClassAction(formData)).rejects.toThrow("NEXT_REDIRECT:/admin/classes/new?error=");
    expect(cleanupAdminClassCreateFailure).toHaveBeenCalledWith("class-1");
    expect(unlinkMock).toHaveBeenCalledTimes(1);
  });

  it("creates class category with generated service slug", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(createAdminClassCategory).mockResolvedValue({
      id: "cat-1",
      name: "Pilates",
      slug: "pilates",
      description: null,
      isActive: true,
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const formData = new FormData();
    formData.set("name", "Pilates");
    formData.set("description", "Mat and reformer");
    formData.set("sortOrder", "1");
    formData.set("isActive", "on");

    await expect(createClassCategoryAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/classes?success=Category+created.",
    );
    expect(createAdminClassCategory).toHaveBeenCalledWith({
      name: "Pilates",
      description: "Mat and reformer",
      sortOrder: 1,
      isActive: true,
    });
  });

  it("updates class category and redirects back to classes with success", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminClassCategory).mockResolvedValue({
      id: "cat-1",
      name: "Pilates Updated",
      slug: "pilates",
      description: "Updated description",
      isActive: true,
      sortOrder: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const formData = new FormData();
    formData.set("name", "Pilates Updated");
    formData.set("description", "Updated description");
    formData.set("sortOrder", "2");
    formData.set("isActive", "on");
    formData.set("returnCategoryPage", "2");
    formData.set("returnCoursePage", "3");

    await expect(updateClassCategoryAction("cat-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/classes?success=Category+updated.&categoryPage=2&coursePage=3",
    );
    expect(updateAdminClassCategory).toHaveBeenCalledWith("cat-1", {
      name: "Pilates Updated",
      description: "Updated description",
      sortOrder: 2,
      isActive: true,
    });
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
    formData.set("currencyCode", "EUR");
    formData.set("unitAmount", "89");
    formData.set("billingInterval", "MONTH");
    formData.set("isActive", "on");

    await expect(createPlanAction(formData)).rejects.toThrow("NEXT_REDIRECT:/admin/plans");
    expect(createAdminPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          actorId: "user-1",
          actorRole: "ADMIN",
        },
        name: "Unlimited Monthly",
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
    formData.set("currencyCode", "EUR");
    formData.set("unitAmount", "89");

    await expect(createPlanAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/plans/new?error=Please%20complete%20all%20required%20product%20fields.",
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
    formData.set("currencyCode", "EUR");
    formData.set("unitAmount", "99");
    formData.set("billingInterval", "MONTH");
    formData.set("isActive", "on");

    await expect(updatePlanAction("plan-1", formData)).rejects.toThrow("NEXT_REDIRECT:/admin/plans");
    expect(updateAdminPlan).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({
        actor: {
          actorId: "user-1",
          actorRole: "ADMIN",
        },
        name: "Unlimited Monthly Pro",
        unitAmountMinor: 9900,
      }),
    );
  });

  it("maps create plan service validation errors to user-facing messages", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const recurringForm = new FormData();
    recurringForm.set("name", "Unlimited Monthly");
    recurringForm.set("productType", "UNLIMITED_MEMBERSHIP");
    recurringForm.set("sortOrder", "1");
    recurringForm.set("priceName", "Monthly Membership");
    recurringForm.set("currencyCode", "EUR");
    recurringForm.set("unitAmount", "89");
    recurringForm.set("billingInterval", "MONTH");
    recurringForm.set("isActive", "on");

    vi.mocked(createAdminPlan).mockRejectedValueOnce(new Error("INVALID_CURRENCY_CODE"));
    await expect(createPlanAction(recurringForm)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/plans/new?error=Currency%20must%20be%20a%20valid%203-letter%20ISO%20code%20(for%20example%20EUR).",
    );

    vi.mocked(createAdminPlan).mockRejectedValueOnce(new Error("INVALID_UNIT_AMOUNT"));
    await expect(createPlanAction(recurringForm)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/plans/new?error=Price%20amount%20must%20be%20greater%20than%20zero.",
    );

    vi.mocked(createAdminPlan).mockRejectedValueOnce(new Error("RECURRING_INTERVAL_REQUIRED"));
    await expect(createPlanAction(recurringForm)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/plans/new?error=Unlimited%20memberships%20require%20a%20billing%20interval.",
    );

    vi.mocked(createAdminPlan).mockRejectedValueOnce(new Error("INVALID_BILLING_INTERVAL_COUNT"));
    await expect(createPlanAction(recurringForm)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/plans/new?error=Billing%20interval%20count%20must%20be%201%20for%20memberships.",
    );

    const oneTimeForm = new FormData();
    oneTimeForm.set("name", "Single");
    oneTimeForm.set("productType", "CLASS_PACK");
    oneTimeForm.set("classPackCreditQuantity", "1");
    oneTimeForm.set("sortOrder", "1");
    oneTimeForm.set("priceName", "Single Price");
    oneTimeForm.set("currencyCode", "EUR");
    oneTimeForm.set("unitAmount", "39");
    oneTimeForm.set("isActive", "on");

    vi.mocked(createAdminPlan).mockRejectedValueOnce(new Error("ONE_TIME_INTERVAL_FORBIDDEN"));
    await expect(createPlanAction(oneTimeForm)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/plans/new?error=Billing%20interval%20can%20only%20be%20set%20for%20unlimited%20memberships.",
    );
  });

  it("maps update plan not-found error to user-facing message", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminPlan).mockRejectedValue(new Error("PRODUCT_NOT_FOUND"));

    const formData = new FormData();
    formData.set("name", "Plan Missing");
    formData.set("productType", "UNLIMITED_MEMBERSHIP");
    formData.set("sortOrder", "1");
    formData.set("priceName", "Missing Price");
    formData.set("currencyCode", "EUR");
    formData.set("unitAmount", "99");
    formData.set("billingInterval", "MONTH");
    formData.set("isActive", "on");

    await expect(updatePlanAction("plan-missing", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/plans/plan-missing/edit?error=Selected%20plan%20no%20longer%20exists.%20Refresh%20and%20try%20again.",
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
    vi.mocked(getAdminLearningVideoById).mockResolvedValue({
      id: "video-1",
      legacyId: "legacy-video-1",
      title: "Existing title",
      description: null,
      shortDescription: null,
      category: "Yoga",
      categoryType: null,
      categoryLevel: null,
      thumbnail: "/uploads/learning/existing-thumbnail.jpg",
      videoUrl: null,
      priority: 1,
    });

    const formData = new FormData();    formData.set("title", "Intro");
    formData.set("category", "Yoga");
    formData.set("priority", "1");

    await expect(updateLearningVideoAction("video-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-videos",
    );
    expect(updateAdminLearningVideo).toHaveBeenCalledWith(
      "video-1",
      expect.objectContaining({
        title: "Intro",
        category: "Yoga",
        priority: 1,
        thumbnail: "/uploads/learning/existing-thumbnail.jpg",
      }),
    );
  });

  it("creates learning video and redirects", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(createAdminLearningVideo).mockResolvedValue({ id: "video-1" });

    const formData = new FormData();
    formData.set("title", "Intro");
    formData.set("category", "Yoga");
    formData.set("priority", "1");

    await expect(createLearningVideoAction(formData)).rejects.toThrow("NEXT_REDIRECT:/admin/learning-videos");
    expect(createAdminLearningVideo).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Intro", category: "Yoga", priority: 1 }),
    );
  });

  it("updates learning video with uploaded thumbnail and persists new upload path", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminLearningVideo).mockResolvedValue({ id: "video-1" });

    const formData = new FormData();
    formData.set("title", "Intro");
    formData.set("category", "Yoga");
    formData.set("priority", "1");
    formData.set("thumbnailUpload", createPngFile("thumb.png"));

    await expect(updateLearningVideoAction("video-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-videos",
    );
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(updateAdminLearningVideo).toHaveBeenCalledWith(
      "video-1",
      expect.objectContaining({ thumbnail: expect.stringMatching(/^\/uploads\/learning\/video-video-1-thumbnail-/) }),
    );
  });

  it("rejects invalid thumbnail upload on learning video update", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();
    formData.set("title", "Intro");
    formData.set("category", "Yoga");
    formData.set("priority", "1");
    formData.set("thumbnailUpload", new File(["not-a-jpg"], "thumb.jpg", { type: "image/webp" }));

    await expect(updateLearningVideoAction("video-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-videos/video-1/edit?error=Only%20valid%20JPG%20or%20PNG%20images%20are%20accepted.",
    );
    expect(updateAdminLearningVideo).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("updates learning program and redirects", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminLearningProgram).mockResolvedValue({ id: "program-1" });

    const formData = new FormData();
    formData.set("courseType", "Yoga");

    await expect(updateLearningProgramAction("program-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-programs",
    );
    expect(updateAdminLearningProgram).toHaveBeenCalledWith(
      "program-1",
      expect.objectContaining({ courseType: "Yoga" }),
    );
  });

  it("rejects update with missing courseType with a clear validation error", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();

    await expect(updateLearningProgramAction("program-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-programs/program-1/edit?error=Please%20complete%20required%20learning%20program%20fields.",
    );
    expect(updateAdminLearningProgram).not.toHaveBeenCalled();
  });

  it("rejects create with missing courseType with a clear validation error", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();

    await expect(createLearningProgramAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-programs/new?error=Please%20complete%20all%20required%20learning%20program%20fields.",
    );
    expect(createAdminLearningProgram).not.toHaveBeenCalled();
  });

  it("creates learning program with selected media library image", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(createAdminLearningProgram).mockResolvedValue({ id: "program-1" });

    const formData = new FormData();
    formData.set("courseType", "Yoga");
    formData.set("picture1", "/uploads/learning/library.png");

    await expect(createLearningProgramAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-programs",
    );
    expect(createAdminLearningProgram).toHaveBeenCalledWith(
      expect.objectContaining({ picture1: "/uploads/learning/library.png" }),
    );
  });

  it("creates learning program with uploaded image before DB path persistence", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(createAdminLearningProgram).mockResolvedValue({ id: "program-1" });

    const formData = new FormData();
    formData.set("courseType", "Yoga");
    formData.set("picture1Upload", createPngFile("lesson.png"));

    await expect(createLearningProgramAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-programs",
    );
    expect(createAdminLearningProgram).toHaveBeenCalledWith(
      expect.objectContaining({ picture1: expect.stringMatching(/^\/uploads\/learning\/program-yoga-picture1-/i) }),
    );
  });

  it("cleans uploaded learning images when create persistence fails", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(createAdminLearningProgram).mockRejectedValueOnce(new Error("PERSIST_FAILED"));

    const formData = new FormData();
    formData.set("courseType", "Yoga");
    formData.set("picture1Upload", createPngFile("lesson.png"));

    await expect(createLearningProgramAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-programs/new?error=Unexpected%20server%20error.",
    );
    expect(cleanupAdminLearningProgramCreateFailure).not.toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledTimes(1);
  });

  it("uploads learning program image through secure media helper", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminLearningProgram).mockResolvedValue({ id: "program-1" });

    const formData = new FormData();
    formData.set("courseType", "Yoga");
    formData.set("picture1Upload", createPngFile("lesson.png"));

    await expect(updateLearningProgramAction("program-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-programs",
    );
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(updateAdminLearningProgram).toHaveBeenLastCalledWith(
      "program-1",
      expect.objectContaining({ picture1: expect.stringMatching(/^\/uploads\/learning\/program-program-1-picture1-/) }),
    );
  });

  it("rejects spoofed learning program image uploads", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminLearningProgram).mockResolvedValue({ id: "program-1" });

    const formData = new FormData();
    formData.set("courseType", "Yoga");
    formData.set("picture1Upload", new File(["not-a-png"], "lesson.png", { type: "image/png" }));

    await expect(updateLearningProgramAction("program-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-programs/program-1/edit?error=Only%20valid%20JPG%2C%20PNG%2C%20or%20WEBP%20images%20are%20accepted.",
    );
    expect(writeFileMock).not.toHaveBeenCalled();
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

    await expect(updateUserAction("user-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/user-1/edit?success=User%20updated.",
    );
    expect(updateAdminUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ firstName: "Jane", lastName: "Doe", email: "jane@example.test", role: "ADMIN" }),
      expect.objectContaining({ id: "user-1", role: "ADMIN" }),
    );
  });

  it("creates class pack plan with explicit credit allocation", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(createAdminPlan).mockResolvedValue({ id: "plan-credit-1" });

    const formData = new FormData();
    formData.set("name", "Class Pack 7");
    formData.set("productType", "CLASS_PACK");
    formData.set("classPackCreditQuantity", "7");
    formData.set("sortOrder", "1");
    formData.set("currencyCode", "EUR");
    formData.set("unitAmount", "79");
    formData.set("isActive", "on");

    await expect(createPlanAction(formData)).rejects.toThrow("NEXT_REDIRECT:/admin/plans");
    expect(createAdminPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        productType: "CLASS_PACK",
        classPackCreditQuantity: 7,
      }),
    );
  });

  it("rejects class pack create payload when credit allocation is missing", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();
    formData.set("name", "Class Pack Missing Qty");
    formData.set("productType", "CLASS_PACK");
    formData.set("sortOrder", "1");
    formData.set("currencyCode", "EUR");
    formData.set("unitAmount", "59");
    formData.set("isActive", "on");

    await expect(createPlanAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/plans/new?error=Please%20complete%20all%20required%20product%20fields.",
    );
    expect(createAdminPlan).not.toHaveBeenCalled();
  });

  it("blocks ADMIN create-user attempt assigning MASTER_ADMIN before service call", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();
    formData.set("name", "Escalation Attempt");
    formData.set("email", "escalation@example.test");
    formData.set("role", "MASTER_ADMIN");
    formData.set("password", "Escalation123!");
    formData.set("isActive", "on");

    await expect(createUserAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/new?error=Only%20MASTER_ADMIN%20can%20assign%20MASTER_ADMIN%20role.",
    );

    expect(createAdminUser).not.toHaveBeenCalled();
  });

  it("maps service create-user MASTER_ADMIN restriction error to actionable message", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("MASTER_ADMIN"));
    vi.mocked(createAdminUser).mockRejectedValue(new Error("MASTER_ADMIN_ASSIGNMENT_FORBIDDEN"));

    const formData = new FormData();
    formData.set("name", "Escalation Attempt");
    formData.set("email", "escalation2@example.test");
    formData.set("role", "MASTER_ADMIN");
    formData.set("password", "Escalation123!");
    formData.set("isActive", "on");

    await expect(createUserAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/new?error=Only%20MASTER_ADMIN%20can%20assign%20MASTER_ADMIN%20role.",
    );
  });

  it("adjusts client credits and redirects", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(adjustAdminClientCredits).mockResolvedValue(undefined);

    const formData = new FormData();
    formData.set("userId", "client-1");
    formData.set("entitlementId", "ent-1");
    formData.set("creditDelta", "2");
    formData.set("reason", "Manual top-up");

    await expect(adjustClientCreditsAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/client-1/edit?success=Credits%20updated.",
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
    formData.set("reason", "Manual adjustment");

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
      "NEXT_REDIRECT:/admin/users/client-1/edit?success=Membership%20cancelled.",
    );
    expect(cancelAdminClientMembership).toHaveBeenCalledWith({
      clientId: "client-1",
      subscriptionContractId: "sub-1",
    });
  });
  it("returns explicit master admin restriction error", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminUser).mockRejectedValue(new Error("MASTER_ADMIN_MANAGEMENT_FORBIDDEN"));

    const formData = new FormData();
    formData.set("firstName", "Master");
    formData.set("lastName", "Admin");
    formData.set("email", "master@example.test");
    formData.set("role", "MASTER_ADMIN");
    formData.set("isActive", "on");

    await expect(updateUserAction("master-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/master-1/edit?error=Only%20MASTER_ADMIN%20can%20manage%20another%20MASTER_ADMIN.",
    );
  });

  it("updates session and redirects back to edit page with success", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminSession).mockResolvedValue({ id: "session-1" });
    vi.mocked(getSiteTimeZone).mockResolvedValue("Europe/Brussels");

    const formData = new FormData();
    formData.set("classTemplateId", "template-1");
    formData.set("teacherId", "teacher-1");
    formData.set("title", "Evening Flow");
    formData.set("startsAt", "2026-06-10T18:00");
    formData.set("endsAt", "2026-06-10T19:00");
    formData.set("capacity", "12");
    formData.set("status", "SCHEDULED");
    formData.set("isPublished", "on");

    await expect(updateSessionAction("session-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/sessions/session-1/edit?success=Session%20updated.",
    );
    expect(updateAdminSession).toHaveBeenCalledTimes(1);
    expect(updateAdminSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        startsAt: new Date("2026-06-10T16:00:00.000Z"),
        endsAt: new Date("2026-06-10T17:00:00.000Z"),
      }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/sessions/session-1/edit");
  });

  it("creates session using the configured site timezone for datetime-local parsing", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(getSiteTimeZone).mockResolvedValue("Europe/Brussels");
    vi.mocked(createAdminSessionService).mockResolvedValue({ id: "session-2" });

    const formData = new FormData();
    formData.set("classTemplateId", "template-1");
    formData.set("teacherId", "teacher-1");
    formData.set("title", "Morning Flow");
    formData.set("startsAt", "2026-03-29T03:30");
    formData.set("endsAt", "2026-03-29T04:30");
    formData.set("capacity", "10");
    formData.set("status", "SCHEDULED");
    formData.set("isPublished", "on");

    await expect(createSessionAction(formData)).rejects.toThrow("NEXT_REDIRECT:/admin/sessions");
    expect(createAdminSessionService).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: new Date("2026-03-29T01:30:00.000Z"),
        endsAt: new Date("2026-03-29T02:30:00.000Z"),
      }),
    );
  });

  it("rejects session creation when datetime-local input falls in the DST gap", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(getSiteTimeZone).mockResolvedValue("Europe/Brussels");

    const formData = new FormData();
    formData.set("classTemplateId", "template-1");
    formData.set("teacherId", "teacher-1");
    formData.set("title", "DST Gap");
    formData.set("startsAt", "2026-03-29T02:30");
    formData.set("endsAt", "2026-03-29T03:30");
    formData.set("capacity", "10");
    formData.set("status", "SCHEDULED");
    formData.set("isPublished", "on");

    await expect(createSessionAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/sessions/new?error=Please%20complete%20all%20required%20session%20fields.",
    );
    expect(createAdminSessionService).not.toHaveBeenCalled();
  });

  it("rejects session updates when datetime-local input is malformed", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(getSiteTimeZone).mockResolvedValue("Europe/Brussels");

    const formData = new FormData();
    formData.set("classTemplateId", "template-1");
    formData.set("teacherId", "teacher-1");
    formData.set("title", "Bad Input");
    formData.set("startsAt", "not-a-datetime");
    formData.set("endsAt", "2026-06-10T19:00");
    formData.set("capacity", "12");
    formData.set("status", "SCHEDULED");
    formData.set("isPublished", "on");

    await expect(updateSessionAction("session-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/sessions/session-1/edit?error=Please%20complete%20all%20required%20session%20fields.",
    );
    expect(updateAdminSession).not.toHaveBeenCalled();
  });

  it("adds attendee through service and redirects with success", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...createAdminSession("ADMIN"),
      user: {
        id: "admin-1",
        email: "admin@example.test",
        role: "ADMIN",
      },
    });
    vi.mocked(addSessionAttendeeByManager).mockResolvedValue({
      bookingId: "booking-1",
      status: "CONFIRMED",
      usedCreditEntitlementId: "ent-1",
      overrideApplied: false,
    });

    const formData = new FormData();
    formData.set("clientId", "client-1");
    formData.set("note", "manual add");

    await expect(addSessionAttendeeAction("session-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/sessions/session-1/edit?success=Attendee%20added.",
    );
    expect(addSessionAttendeeByManager).toHaveBeenCalledWith({
      studioSessionId: "session-1",
      clientId: "client-1",
      note: "manual add",
      overrideReason: undefined,
      actor: {
        userId: "admin-1",
        role: "ADMIN",
      },
    });
  });

  it("passes manual override reason for admin attendee add", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...createAdminSession("ADMIN"),
      user: {
        id: "admin-1",
        email: "admin@example.test",
        role: "ADMIN",
      },
    });
    vi.mocked(addSessionAttendeeByManager).mockResolvedValue({
      bookingId: "booking-1",
      status: "CONFIRMED",
      usedCreditEntitlementId: null,
      overrideApplied: true,
    });

    const formData = new FormData();
    formData.set("clientId", "client-1");
    formData.set("overrideReason", "Client approved trial");

    await expect(addSessionAttendeeAction("session-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/sessions/session-1/edit?success=Attendee%20added.",
    );
    expect(addSessionAttendeeByManager).toHaveBeenCalledWith({
      studioSessionId: "session-1",
      clientId: "client-1",
      note: undefined,
      overrideReason: "Client approved trial",
      actor: {
        userId: "admin-1",
        role: "ADMIN",
      },
    });
  });

  it("maps manager eligibility restriction to actionable message", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...createAdminSession("ADMIN"),
      user: {
        id: "teacher-1",
        email: "teacher@example.test",
        role: "TEACHER",
      },
    });
    vi.mocked(addSessionAttendeeByManager).mockRejectedValue(
      new Error("SESSION_ELIGIBILITY_REQUIRED"),
    );

    const formData = new FormData();
    formData.set("clientId", "client-1");
    formData.set("note", "override");

    await expect(addSessionAttendeeAction("session-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/sessions/session-1/edit?error=Client%20must%20have%20an%20eligible%20credit%20or%20qualifying%20subscription%20for%20this%20class.",
    );
  });

  it("removes attendee through service and redirects with success", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("MASTER_ADMIN"));
    vi.mocked(removeSessionAttendeeByManager).mockResolvedValue({
      bookingId: "booking-1",
      restoredCredit: true,
      alreadyCancelled: false,
    });

    const formData = new FormData();
    formData.set("bookingId", "booking-1");
    formData.set("note", "client requested");

    await expect(removeSessionAttendeeAction("session-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/sessions/session-1/edit?success=Attendee%20removed.",
    );
    expect(removeSessionAttendeeByManager).toHaveBeenCalledWith({
      studioSessionId: "session-1",
      bookingId: "booking-1",
      note: "client requested",
      actor: {
        userId: "user-1",
        role: "MASTER_ADMIN",
      },
    });
  });
  it("rejects teacher image upload when file type is invalid", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();
    formData.set("userId", "teacher-1");
    formData.set("teacherImage", new File(["bad"], "teacher.gif", { type: "image/gif" }));

    await expect(uploadTeacherImageAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/teacher-1/edit?error=Only%20valid%20JPG%2C%20PNG%2C%20or%20WEBP%20images%20are%20accepted.",
    );
    expect(updateAdminTeacherImage).not.toHaveBeenCalled();
  });

  it("uploads teacher image and stores relative image path", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminTeacherImage).mockResolvedValue({
      id: "teacher-1",
      image: "/uploads/teachers/teacher-teacher-1-1.png",
    });

    const formData = new FormData();
    formData.set("userId", "teacher-1");
    formData.set("teacherImage", createPngFile("teacher.png"));

    await expect(uploadTeacherImageAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/teacher-1/edit?success=Teacher%20picture%20updated.",
    );

    expect(mkdirMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(updateAdminTeacherImage).toHaveBeenCalledWith({
      userId: "teacher-1",
      imagePath: expect.stringMatching(/^\/uploads\/teachers\/teacher-teacher-1-/),
      adminUserId: "user-1",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/users/teacher-1/edit");
  });
  it("creates static weekly schedule row and revalidates paths", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(createAdminSiteWeeklyScheduleEntry).mockResolvedValue({
      id: "site-1",
      dayOfWeek: "MONDAY",
      startTime: "18:00",
      endTime: "19:00",
      serviceId: "service-1",
      label: "Pilates",
      displayOrder: 1,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const formData = new FormData();
    formData.set("dayOfWeek", "MONDAY");
    formData.set("startTime", "18:00");
    formData.set("endTime", "19:00");
    formData.set("serviceId", "service-1");
    formData.set("displayOrder", "1");
    formData.set("isActive", "on");

    await expect(createSiteWeeklyScheduleEntryAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/manage-site?success=Weekly%20schedule%20row%20added.",
    );

    expect(createAdminSiteWeeklyScheduleEntry).toHaveBeenCalledWith({
      dayOfWeek: "MONDAY",
      startTime: "18:00",
      endTime: "19:00",
      serviceId: "service-1",
      displayOrder: 1,
      isActive: true,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/manage-site");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  it("updates and deletes static weekly schedule row", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminSiteWeeklyScheduleEntry).mockResolvedValue({
      id: "site-1",
      dayOfWeek: "TUESDAY",
      startTime: "10:00",
      endTime: "11:00",
      serviceId: "service-2",
      label: "Yoga",
      displayOrder: 2,
      isActive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(deleteAdminSiteWeeklyScheduleEntry).mockResolvedValue(undefined);

    const updateForm = new FormData();
    updateForm.set("id", "site-1");
    updateForm.set("dayOfWeek", "TUESDAY");
    updateForm.set("startTime", "10:00");
    updateForm.set("endTime", "11:00");
    updateForm.set("serviceId", "service-2");
    updateForm.set("displayOrder", "2");

    await expect(updateSiteWeeklyScheduleEntryAction(updateForm)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/manage-site?success=Weekly%20schedule%20row%20updated.",
    );

    const deleteForm = new FormData();
    deleteForm.set("id", "site-1");

    await expect(deleteSiteWeeklyScheduleEntryAction(deleteForm)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/manage-site?success=Weekly%20schedule%20row%20removed.",
    );
    expect(deleteAdminSiteWeeklyScheduleEntry).toHaveBeenCalledWith("site-1");
  });

  it("rejects invalid cancellation period payload", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const invalidFormData = new FormData();
    invalidFormData.set("cancellationPeriodHours", "0");

    await expect(updateCancellationPeriodAction(invalidFormData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/manage-site?error=Cancellation%20period%20must%20be%20a%20positive%20whole%20number%20of%20hours.",
    );
    expect(updateAdminCancellationPeriodHours).not.toHaveBeenCalled();
  });

  it("updates cancellation period when payload is valid", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminCancellationPeriodHours).mockResolvedValue(36);

    const formData = new FormData();
    formData.set("cancellationPeriodHours", "36");

    await expect(updateCancellationPeriodAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/manage-site?success=Cancellation%20period%20updated.",
    );
    expect(updateAdminCancellationPeriodHours).toHaveBeenCalledWith(36);
  });

  it("updates site timezone when payload is valid", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminSiteTimeZone).mockResolvedValue("America/New_York");

    const formData = new FormData();
    formData.set("timeZone", "America/New_York");

    await expect(updateSiteTimeZoneAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/manage-site?success=Site%20timezone%20updated.",
    );
    expect(updateAdminSiteTimeZone).toHaveBeenCalledWith("America/New_York");
  });

  it("rejects invalid site timezone payload", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminSiteTimeZone).mockRejectedValue(new Error("INVALID_SITE_TIME_ZONE"));

    const formData = new FormData();
    formData.set("timeZone", "Not/AZone");

    await expect(updateSiteTimeZoneAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/manage-site?error=Select%20a%20valid%20site%20timezone.",
    );
    expect(updateAdminSiteTimeZone).toHaveBeenCalledWith("Not/AZone");
  });

  it("rejects addSessionAttendeeAction when CSRF check fails", async () => {
    vi.mocked(assertSameOriginServerAction).mockRejectedValueOnce(new Error("CSRF_INVALID_ORIGIN"));
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();
    formData.set("clientId", "client-1");

    await expect(addSessionAttendeeAction("session-1", formData)).rejects.toThrow("CSRF_INVALID_ORIGIN");
    expect(addSessionAttendeeByManager).not.toHaveBeenCalled();
  });

  it("rejects removeSessionAttendeeAction when CSRF check fails", async () => {
    vi.mocked(assertSameOriginServerAction).mockRejectedValueOnce(new Error("CSRF_INVALID_ORIGIN"));
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));

    const formData = new FormData();
    formData.set("bookingId", "booking-1");

    await expect(removeSessionAttendeeAction("session-1", formData)).rejects.toThrow("CSRF_INVALID_ORIGIN");
    expect(removeSessionAttendeeByManager).not.toHaveBeenCalled();
  });

  it("strips path traversal characters from userId when uploading teacher image", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminTeacherImage).mockResolvedValue({
      id: "teacher-1",
      image: "/uploads/teachers/teacher-teacher-1-1.png",
    });

    const formData = new FormData();
    formData.set("userId", "../../../etc/teacher-1");
    formData.set("teacherImage", createPngFile("teacher.png"));

    await expect(uploadTeacherImageAction(formData)).rejects.toThrow("NEXT_REDIRECT");

    const [writtenPath] = vi.mocked(writeFileMock).mock.calls[0] as [string, Buffer];
    expect(writtenPath).not.toContain("..");
    expect(writtenPath).not.toContain("/etc/");
    expect(updateAdminTeacherImage).toHaveBeenCalledWith(
      expect.objectContaining({
        imagePath: expect.not.stringContaining(".."),
      }),
    );
  });

  it("strips path traversal characters from classTypeId when uploading class image", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.spyOn(Date, "now").mockReturnValue(2);

    const formData = new FormData();
    formData.set("classTypeId", "../../../etc/class-1");
    formData.set("classImage", createPngFile("class.png"));

    await expect(uploadClassImageAction(formData)).rejects.toThrow("NEXT_REDIRECT");

    const [writtenPath] = vi.mocked(writeFileMock).mock.calls[0] as [string, Buffer];
    expect(writtenPath).not.toContain("..");
    expect(writtenPath).not.toContain("/etc/");
  });

  it("rejects updateSessionAttendanceAction when CSRF check fails", async () => {
    vi.mocked(assertSameOriginServerAction).mockRejectedValueOnce(new Error("CSRF_INVALID_ORIGIN"));

    const formData = new FormData();
    formData.set("bookingId", "booking-1");
    formData.set("targetStatus", "ATTENDED");

    await expect(updateSessionAttendanceAction("session-1", formData)).rejects.toThrow("CSRF_INVALID_ORIGIN");
  });

  it("strips path traversal characters from campaignId when storing campaign image", async () => {
    const dangerousId = "../../../etc/campaign-1";
    const safeDraft = { id: dangerousId, name: "Campaign", status: "DRAFT" };

    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(resolveAdminActorUser).mockResolvedValue({ id: "user-1", role: "ADMIN" });
    vi.mocked(updateMarketingCampaignFlowDraft).mockResolvedValue(safeDraft as never);
    vi.spyOn(Date, "now").mockReturnValue(3);

    const formData = new FormData();
    formData.set("campaignId", dangerousId);
    formData.set("campaignName", "Test Campaign");
    formData.set("subject", "Subject");
    formData.set("previewText", "Preview");
    formData.set("fromName", "Studio Team");
    formData.set("fromEmail", "no-reply@bookmyclass.app");
    formData.set("replyTo", "no-reply@bookmyclass.app");
    formData.set("campaignImage", createPngFile("img.png"));

    await expect(saveMarketingCampaignFlowDraftAction(formData)).rejects.toThrow("NEXT_REDIRECT");

    const [writtenPath] = vi.mocked(writeFileMock).mock.calls[0] as [string, Buffer];
    expect(writtenPath).not.toContain("..");
    expect(writtenPath).not.toContain("/etc/");
  });
});



