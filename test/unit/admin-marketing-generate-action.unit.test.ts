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
  createMarketingCampaignFlowDraft: vi.fn(),
  updateMarketingCampaignFlowDraft: vi.fn(),
  getMarketingCampaignFlowDraftById: vi.fn(),
}));

import { resolveAdminActorUser } from "@/lib/admin/admin-service";
import {
  createMarketingCampaignFlowDraft,
  updateMarketingCampaignFlowDraft,
} from "@/lib/marketing/marketing-service";
import {
  generateMarketingCampaignFlowDraftAction,
  saveMarketingCampaignFlowDraftAction,
} from "../../src/app/admin/(private)/actions";

const existingDraft = {
  id: "campaign-1",
  name: "Campaign",
  categoryId: null,
  categoryName: null,
  goalSummary: "",
  goalPrompt: "",
  subject: "Subject",
  previewText: "Preview",
  fromName: "Studio Team",
  fromEmail: "hello@studio.example",
  replyTo: null,
  imageAssetUrl: null,
  selectedSegmentIds: [],
  contentJson: { blocks: [{ type: "paragraph", text: "Existing body" }] },
  htmlSnapshot: "<p>Existing body</p>",
  currentStep: "STEP_1",
  status: "DRAFT",
} as const;

function buildStep1FormData() {
  const formData = new FormData();
  formData.set("campaignId", "campaign-1");
  formData.set("campaignName", "Campaign");
  formData.set("subject", "Subject");
  formData.set("previewText", "Preview");
  formData.set("contentJson", JSON.stringify({ blocks: [{ type: "paragraph", text: "Hello" }] }));
  return formData;
}

describe("marketing flow step 1 actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveAdminActorUser).mockResolvedValue({ id: "admin-1", role: "ADMIN" } as never);
    vi.mocked(createMarketingCampaignFlowDraft).mockResolvedValue(existingDraft as never);
    vi.mocked(updateMarketingCampaignFlowDraft).mockResolvedValue(existingDraft as never);
  });

  it("save action validates required fields", async () => {
    const formData = new FormData();
    formData.set("campaignName", "Campaign");

    await expect(saveMarketingCampaignFlowDraftAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/new?campaignName=Campaign&error=Subject%20is%20required.",
    );
  });

  it("save action persists blocks and redirects back to step 1 with campaign id", async () => {
    await expect(saveMarketingCampaignFlowDraftAction(buildStep1FormData())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/new?campaignId=campaign-1&success=Draft%20saved.",
    );

    expect(updateMarketingCampaignFlowDraft).toHaveBeenCalledWith(
      "campaign-1",
      expect.objectContaining({
        name: "Campaign",
        subject: "Subject",
        previewText: "Preview",
        currentStep: "STEP_1",
      }),
    );
  });

  it("save action maps invalid blocks payload to explicit message", async () => {
    const formData = buildStep1FormData();
    formData.set("contentJson", "{not-json");

    await expect(saveMarketingCampaignFlowDraftAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/new?error=Campaign%20content%20blocks%20are%20invalid.",
    );
  });

  it("generate action is disabled in the new flow", async () => {
    const formData = new FormData();
    formData.set("campaignId", "campaign-1");

    await expect(generateMarketingCampaignFlowDraftAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/new?campaignId=campaign-1&error=AI%20draft%20generation%20is%20disabled.%20Use%20Save%20draft%20with%20content%20blocks.",
    );
  });
});