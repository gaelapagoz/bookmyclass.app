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

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  withScope: vi.fn((fn: (scope: { setTag: (k: string, v: string) => void; setContext: (k: string, v: unknown) => void }) => void) => {
    fn({ setTag: vi.fn(), setContext: vi.fn() });
  }),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  })),
}));

vi.mock("@/lib/admin/admin-service", () => ({
  addSessionAttendeeByManager: vi.fn(),
  adjustAdminClientCredits: vi.fn(),
  cancelAdminClientMembership: vi.fn(),
  createAdminClass: vi.fn(),
  upsertAdminClassScheduleConfig: vi.fn(),
  createAdminLearningProgram: vi.fn(),
  createAdminLearningVideo: vi.fn(),
  createAdminPlan: vi.fn(),
  createAdminSession: vi.fn(),
  createAdminRecurringSessions: vi.fn(),
  createAdminSubscription: vi.fn(),
  createAdminUser: vi.fn(),
  updateAdminClass: vi.fn(),
  updateAdminClassImage: vi.fn(),
  updateAdminLearningProgram: vi.fn(),
  updateAdminLearningVideo: vi.fn(),
  updateAdminPlan: vi.fn(),
  updateAdminSession: vi.fn(),
  updateAdminSubscription: vi.fn(),
  updateAdminTeacherImage: vi.fn(),
  updateAdminUser: vi.fn(),
  removeSessionAttendeeByManager: vi.fn(),
  bulkAddClientMarketingSegments: vi.fn(),
  bulkRemoveClientMarketingSegments: vi.fn(),
  bulkSetClientMarketingSubscriptionStatus: vi.fn(),
  resolveAdminActorUser: vi.fn(),
}));

vi.mock("@/lib/public-documents/agenda-document-service", () => ({
  upsertActiveAgendaPdfDocument: vi.fn(),
}));

vi.mock("@/lib/client-messages/client-message-service", () => ({
  updateClientMessageStatus: vi.fn(),
}));

vi.mock("@/lib/marketing/marketing-service", () => ({
  sendMarketingCampaignFlowTestEmail: vi.fn(),
}));

import { sendMarketingCampaignFlowTestEmail } from "@/lib/marketing/marketing-service";
import { sendMarketingCampaignFlowTestEmailAction } from "../../src/app/admin/(private)/actions";

function buildFormData(overrides?: { toEmail?: string }) {
  const form = new FormData();
  form.set("campaignId", "camp-1");
  form.set("page", "2");
  form.append("segments", "seg-a");
  form.append("segments", "seg-b");
  form.set("toEmail", overrides?.toEmail ?? "tester@example.test");
  return form;
}

describe("sendMarketingCampaignFlowTestEmailAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects with validation error for invalid email", async () => {
    await expect(sendMarketingCampaignFlowTestEmailAction(buildFormData({ toEmail: "invalid" }))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/camp-1/review?segments=seg-a&segments=seg-b&page=2&testEmail=invalid&error=Enter%20a%20valid%20test%20email%20address.",
    );

    expect(sendMarketingCampaignFlowTestEmail).not.toHaveBeenCalled();
  });

  it("sends test email and keeps review context on success", async () => {
    vi.mocked(sendMarketingCampaignFlowTestEmail).mockResolvedValue(undefined);

    await expect(sendMarketingCampaignFlowTestEmailAction(buildFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/camp-1/review?segments=seg-a&segments=seg-b&page=2&testEmail=tester%40example.test&success=Test+email+sent.",
    );

    expect(sendMarketingCampaignFlowTestEmail).toHaveBeenCalledWith({
      campaignId: "camp-1",
      toEmail: "tester@example.test",
    });
  });
});
