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

const { mkdirMock, writeFileMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock,
  writeFile: writeFileMock,
}));
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

vi.mock("@/lib/admin/admin-service", () => ({
  addSessionAttendeeByManager: vi.fn(),
  adjustAdminClientCredits: vi.fn(),
  cancelAdminClientMembership: vi.fn(),
  createAdminClass: vi.fn(),
  upsertAdminClassScheduleConfig: vi.fn(),
  createAdminRecurringSessions: vi.fn(),
  createAdminSession: vi.fn(),
  createAdminPlan: vi.fn(),
  createAdminSubscription: vi.fn(),
  createAdminSiteWeeklyScheduleEntry: vi.fn(),
  updateAdminSiteWeeklyScheduleEntry: vi.fn(),
  deleteAdminSiteWeeklyScheduleEntry: vi.fn(),
  updateAdminCancellationPeriodHours: vi.fn(),
  removeSessionAttendeeByManager: vi.fn(),
  updateAdminLearningProgram: vi.fn(),
  updateAdminLearningVideo: vi.fn(),
  updateAdminPlan: vi.fn(),
  updateAdminSession: vi.fn(),
  updateAdminTeacherImage: vi.fn(),
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
  addSessionAttendeeByManager,
  adjustAdminClientCredits,
  cancelAdminClientMembership,
  createAdminClass,
  createAdminPlan,
  createAdminSubscription,
  createAdminSiteWeeklyScheduleEntry,
  updateAdminSiteWeeklyScheduleEntry,
  deleteAdminSiteWeeklyScheduleEntry,
  updateAdminCancellationPeriodHours,
  upsertAdminClassScheduleConfig,
  removeSessionAttendeeByManager,
  updateAdminLearningProgram,
  updateAdminLearningVideo,
  updateAdminPlan,
  updateAdminSession,
  updateAdminTeacherImage,
  updateAdminUser,
} from "@/lib/admin/admin-service";

import {
  addSessionAttendeeAction,
  adjustClientCreditsAction,
  cancelClientMembershipAction,
  createClassAction,
  createPlanAction,
  createSiteWeeklyScheduleEntryAction,
  createSubscriptionAction,
  deleteSiteWeeklyScheduleEntryAction,
  removeSessionAttendeeAction,
  updateCancellationPeriodAction,
  updateLearningProgramAction,
  updateLearningVideoAction,
  updatePlanAction,
  updateSessionAction,
  updateSiteWeeklyScheduleEntryAction,
  uploadTeacherImageAction,
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

    const formData = new FormData();    formData.set("title", "Intro");
    formData.set("category", "Yoga");
    formData.set("priority", "1");

    await expect(updateLearningVideoAction("video-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-videos",
    );
    expect(updateAdminLearningVideo).toHaveBeenCalledWith(
      "video-1",
      expect.objectContaining({ title: "Intro", category: "Yoga", priority: 1 }),
    );
  });

  it("updates learning program and redirects", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminLearningProgram).mockResolvedValue({ id: "program-1" });

    const formData = new FormData();
    formData.set("mainTitle", "Main Program");
    formData.set("courseType", "Yoga");
    formData.set("title", "Program Title");

    await expect(updateLearningProgramAction("program-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/learning-programs",
    );
    expect(updateAdminLearningProgram).toHaveBeenCalledWith(
      "program-1",
      expect.objectContaining({ mainTitle: "Main Program", courseType: "Yoga", title: "Program Title" }),
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

    await expect(updateUserAction("user-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/user-1/edit?success=User%20updated.",
    );
    expect(updateAdminUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ firstName: "Jane", lastName: "Doe", email: "jane@example.test", role: "ADMIN" }),
      expect.objectContaining({ id: "user-1", role: "ADMIN" }),
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
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/sessions/session-1/edit");
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
      actor: {
        userId: "admin-1",
        role: "ADMIN",
      },
    });
  });

  it("maps teacher add-without-credit restriction to actionable message", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...createAdminSession("ADMIN"),
      user: {
        id: "teacher-1",
        email: "teacher@example.test",
        role: "TEACHER",
      },
    });
    vi.mocked(addSessionAttendeeByManager).mockRejectedValue(
      new Error("TEACHER_CREDIT_OVERRIDE_FORBIDDEN"),
    );

    const formData = new FormData();
    formData.set("clientId", "client-1");
    formData.set("note", "override");

    await expect(addSessionAttendeeAction("session-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/sessions/session-1/edit?error=Teachers%20cannot%20add%20attendees%20without%20available%20credits.",
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
      "NEXT_REDIRECT:/admin/users/teacher-1/edit?error=Only%20JPG%2C%20PNG%2C%20or%20WEBP%20images%20are%20accepted.",
    );
    expect(updateAdminTeacherImage).not.toHaveBeenCalled();
  });

  it("uploads teacher image and stores relative image path", async () => {
    vi.mocked(auth).mockResolvedValue(createAdminSession("ADMIN"));
    vi.mocked(updateAdminTeacherImage).mockResolvedValue({
      id: "teacher-1",
      image: "/images/instructors/teacher-teacher-1-1.png",
    });
    vi.spyOn(Date, "now").mockReturnValue(1);

    const formData = new FormData();
    formData.set("userId", "teacher-1");
    formData.set("teacherImage", new File(["png"], "teacher.png", { type: "image/png" }));

    await expect(uploadTeacherImageAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/users/teacher-1/edit?success=Teacher%20picture%20updated.",
    );

    expect(mkdirMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(updateAdminTeacherImage).toHaveBeenCalledWith({
      userId: "teacher-1",
      imagePath: "/images/instructors/teacher-teacher-1-1.png",
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
});
