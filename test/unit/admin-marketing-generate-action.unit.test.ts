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

import { resolveAdminActorUser } from "@/lib/admin/admin-catalog-core-service";
import {
  createMarketingCampaignFlowDraft,
  updateMarketingCampaignFlowDraft,
} from "@/lib/marketing/marketing-service";
import {
  generateMarketingCampaignFlowDraftAction,
  saveMarketingCampaignFlowContentAction,
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
  formData.set("fromName", "Studio Team");
  formData.set("fromEmail", "no-reply@bookmyclass.app");
  formData.set("replyTo", "no-reply@bookmyclass.app");
  return formData;
}

function buildStep2FormData() {
  const formData = new FormData();
  formData.set("campaignId", "campaign-1");
  formData.set("name", "Campaign");
  formData.set("subjectTemplate", "Subject");
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

  it("save action persists metadata and redirects to step 2", async () => {
    await expect(saveMarketingCampaignFlowDraftAction(buildStep1FormData())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/campaign-1/target",
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

  it("save action validates from email", async () => {
    const formData = buildStep1FormData();
    formData.set("fromEmail", "bad-email");

    await expect(saveMarketingCampaignFlowDraftAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/new?campaignName=Campaign&subject=Subject&previewText=Preview&error=From%20email%20is%20required.",
    );
  });

  it("generate action is disabled in the new flow", async () => {
    const formData = new FormData();
    formData.set("campaignId", "campaign-1");

    await expect(generateMarketingCampaignFlowDraftAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/new?campaignId=campaign-1&error=AI%20draft%20generation%20is%20disabled.",
    );
  });

  it("step 2 save intent stays on step 2 with success message", async () => {
    const formData = buildStep2FormData();
    formData.set("intent", "save");
    await expect(saveMarketingCampaignFlowContentAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/campaign-1/target?success=Draft%20saved.",
    );
    expect(updateMarketingCampaignFlowDraft).toHaveBeenCalledWith(
      "campaign-1",
      expect.objectContaining({ currentStep: "STEP_2" }),
    );
  });

  it("step 2 next intent redirects to review", async () => {
    const formData = buildStep2FormData();
    formData.set("intent", "next");
    await expect(saveMarketingCampaignFlowContentAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/campaign-1/review",
    );
    expect(updateMarketingCampaignFlowDraft).toHaveBeenCalledWith(
      "campaign-1",
      expect.objectContaining({ currentStep: "STEP_3" }),
    );
  });

  it("step 2 invalid content redirects with explicit message", async () => {
    const formData = buildStep2FormData();
    formData.set("contentJson", "{bad-json");
    await expect(saveMarketingCampaignFlowContentAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/campaign-1/target?error=Campaign%20content%20blocks%20are%20invalid.",
    );
  });

  it("step 2 null update handling redirects with campaign not found", async () => {
    vi.mocked(updateMarketingCampaignFlowDraft).mockResolvedValueOnce(null as never);
    const formData = buildStep2FormData();
    await expect(saveMarketingCampaignFlowContentAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/marketing/campaigns/campaign-1/target?error=Campaign%20not%20found.",
    );
  });
});

