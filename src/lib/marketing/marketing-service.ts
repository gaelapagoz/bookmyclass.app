import { MarketingAudienceType, MarketingCampaignStatus, MarketingRecipientStatus, MarketingSubscriptionStatus, Prisma, Role } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { isDeterministicEmailDeliveryMode } from "@/lib/email/resend-delivery";
import { excludeUnsubscribedRecipients, resolveMarketingAudience } from "@/lib/marketing/marketing-audience";
import { extractTrackingLinks, normalizeMarketingContentJson, renderMarketingEmailHtml, renderMarketingPreviewHtml } from "@/lib/marketing/marketing-renderer";
import { sendMarketingCampaignTest, sendMarketingEmailViaResend } from "@/lib/marketing/marketing-delivery";
import { buildTrackingToken, createRecipientTrackingToken } from "@/lib/marketing/marketing-tracking";

export type MarketingCampaignPageFilter = "draft" | "sent" | "all";

export type MarketingCampaignListPageItem = {
  id: string;
  name: string;
  categoryName: string;
  status: MarketingCampaignStatus;
  sentAt: Date | null;
  updatedAt: Date;
  recipientCount: number;
};

export type MarketingCampaignListPageData = {
  filter: MarketingCampaignPageFilter;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  query: string;
  items: MarketingCampaignListPageItem[];
};

export type MarketingCampaignGlobalMetrics = {
  totalCampaigns: number;
  totalSentCampaigns: number;
  totalDraftCampaigns: number;
  sentInLast30Days: number;
  totalRecipientsReached: number;
  averageRecipientsPerSentCampaign: number;
};

export type MarketingCampaignEditorInput = {
  name: string;
  categoryId?: string | null;
  audienceType: MarketingAudienceType;
  manualAudienceJson?: Prisma.JsonValue | null;
  subject: string;
  previewText: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  contentJson: unknown;
};

export type MarketingCampaignFlowStep = "STEP_1" | "STEP_2" | "STEP_3" | "STEP_4" | "SENT";

type MarketingCampaignFlowMeta = {
  goalSummary?: string;
  goalPrompt?: string;
  imageAssetUrl?: string | null;
  currentStep?: MarketingCampaignFlowStep;
  selectedSegmentIds?: string[];
};

export type MarketingCampaignFlowDraft = {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  goalSummary: string;
  goalPrompt: string;
  subject: string;
  previewText: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  imageAssetUrl: string | null;
  selectedSegmentIds: string[];
  contentJson: unknown;
  htmlSnapshot: string;
  currentStep: MarketingCampaignFlowStep;
  status: MarketingCampaignStatus;
};

export type MarketingCampaignFlowSegmentOption = {
  id: string;
  name: string;
};

export type MarketingCampaignFlowRecipient = {
  id: string;
  name: string;
  email: string;
  marketingSubscriptionStatus: MarketingSubscriptionStatus;
};

export type MarketingCampaignFlowRecipientResolution = {
  selectedSegmentIds: string[];
  segmentOptions: MarketingCampaignFlowSegmentOption[];
  totalRecipients: number;
  page: number;
  pageSize: number;
  totalPages: number;
  recipients: MarketingCampaignFlowRecipient[];
};

export type MarketingCampaignFlowSentSummary = {
  campaignId: string;
  campaignName: string;
  status: MarketingCampaignStatus;
  recipientCount: number;
  categoryName: string | null;
  selectedSegmentIds: string[];
  selectedSegmentNames: string[];
  sentAt: Date | null;
};

export type MarketingSentCampaignSummary = {
  campaignId: string;
  campaignName: string;
  status: MarketingCampaignStatus;
  sentAt: Date | null;
  categoryName: string | null;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  subject: string;
  previewText: string;
  selectedSegmentIds: string[];
  selectedSegmentNames: string[];
  recipientCount: number;
  recipientSentCount: number;
  recipientFailedCount: number;
  recipientPendingCount: number;
  htmlSnapshot: string;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const marketingSenderEmailSchema = z.email();

function ensureJsonObject(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Prisma.JsonObject;
}

function readFlowMeta(value: Prisma.JsonValue | null | undefined): MarketingCampaignFlowMeta {
  const root = ensureJsonObject(value);
  const flowValue = root.flow;
  if (!flowValue || typeof flowValue !== "object" || Array.isArray(flowValue)) {
    return {};
  }
  const flow = flowValue as Record<string, unknown>;
  const stepValue = typeof flow.currentStep === "string" ? flow.currentStep : undefined;

  const allowedStepSet: MarketingCampaignFlowStep[] = ["STEP_1", "STEP_2", "STEP_3", "STEP_4", "SENT"];
  const currentStep = stepValue && allowedStepSet.includes(stepValue as MarketingCampaignFlowStep)
    ? (stepValue as MarketingCampaignFlowStep)
    : undefined;

  return {
    goalSummary: typeof flow.goalSummary === "string" ? flow.goalSummary : undefined,
    goalPrompt: typeof flow.goalPrompt === "string" ? flow.goalPrompt : undefined,
    imageAssetUrl: typeof flow.imageAssetUrl === "string" ? flow.imageAssetUrl : null,
    currentStep,
    selectedSegmentIds: Array.isArray(flow.selectedSegmentIds) ? [...new Set(flow.selectedSegmentIds.map(String).filter(Boolean))] : [],
  };
}

function mergeFlowMeta(
  value: Prisma.JsonValue | null | undefined,
  updates: Partial<MarketingCampaignFlowMeta>,
): Prisma.InputJsonValue {
  const root = ensureJsonObject(value);
  const current = readFlowMeta(value);
  const next: MarketingCampaignFlowMeta = {
    goalSummary: updates.goalSummary ?? current.goalSummary ?? "",
    goalPrompt: updates.goalPrompt ?? current.goalPrompt ?? "",
    imageAssetUrl:
      updates.imageAssetUrl === undefined ? (current.imageAssetUrl ?? null) : updates.imageAssetUrl,
    currentStep: updates.currentStep ?? current.currentStep ?? "STEP_1",
    selectedSegmentIds:
      updates.selectedSegmentIds === undefined
        ? (current.selectedSegmentIds ?? [])
        : [...new Set(updates.selectedSegmentIds.map(String).filter(Boolean))],
  };

  const rawEmails = Array.isArray(root.emails) ? root.emails.map(String) : [];
  const rawUserIds = Array.isArray(root.userIds) ? root.userIds.map(String) : [];

  return {
    ...root,
    emails: [...new Set(rawEmails.map(normalizeEmail).filter(Boolean))],
    userIds: [...new Set(rawUserIds.filter(Boolean))],
    flow: next,
  } as Prisma.InputJsonValue;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toManualAudience(value: Prisma.JsonValue | null | undefined): { emails: string[]; userIds: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { emails: [], userIds: [] };
  }

  const obj = value as { emails?: unknown; userIds?: unknown };
  const emails = Array.isArray(obj.emails) ? obj.emails.map(String).map(normalizeEmail).filter(Boolean) : [];
  const userIds = Array.isArray(obj.userIds) ? obj.userIds.map(String).filter(Boolean) : [];
  return {
    emails: [...new Set(emails)],
    userIds: [...new Set(userIds)],
  };
}

function buildDefaultDraftContent(input: { campaignName: string; goalPrompt: string; imageAssetUrl: string | null }) {
  const blocks: Array<Record<string, unknown>> = [];
  if (input.imageAssetUrl) {
    blocks.push({
      type: "image",
      url: input.imageAssetUrl,
      alt: `${input.campaignName} hero image`,
    });
  }
  blocks.push(
    {
      type: "heading",
      text: input.campaignName.trim() || "Campaign draft",
    },
    {
      type: "paragraph",
      text: input.goalPrompt.trim() || "Campaign goal",
    },
    {
      type: "button",
      text: "Book now",
      url: "https://example.com/book",
    },
  );
  return normalizeMarketingContentJson({ blocks });
}

function toFlowDraft(campaign: {
  id: string;
  name: string;
  status: MarketingCampaignStatus;
  categoryId: string | null;
  category?: { name: string } | null;
  manualAudienceJson: Prisma.JsonValue | null;
  subject: string;
  previewText: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  contentJson: Prisma.JsonValue;
  htmlSnapshot: string | null;
}): MarketingCampaignFlowDraft {
  const meta = readFlowMeta(campaign.manualAudienceJson);
  const contentJson = normalizeMarketingContentJson(campaign.contentJson);
  const htmlSnapshot = campaign.htmlSnapshot?.trim() || renderMarketingPreviewHtml(contentJson);
  return {
    id: campaign.id,
    name: campaign.name,
    categoryId: campaign.categoryId,
    categoryName: campaign.category?.name ?? null,
    goalSummary: meta.goalSummary ?? "",
    goalPrompt: meta.goalPrompt ?? "",
    subject: campaign.subject,
    previewText: campaign.previewText,
    fromName: campaign.fromName,
    fromEmail: campaign.fromEmail,
    replyTo: campaign.replyTo,
    imageAssetUrl: meta.imageAssetUrl ?? null,
    selectedSegmentIds: meta.selectedSegmentIds ?? [],
    contentJson,
    htmlSnapshot,
    currentStep: meta.currentStep ?? "STEP_1",
    status: campaign.status,
  };
}

export async function getMarketingCampaignFlowDraftById(id: string): Promise<MarketingCampaignFlowDraft | null> {
  const campaign = await prisma.marketingCampaign.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      categoryId: true,
      category: { select: { name: true } },
      manualAudienceJson: true,
      subject: true,
      previewText: true,
      fromName: true,
      fromEmail: true,
      replyTo: true,
      contentJson: true,
      htmlSnapshot: true,
    },
  });

  if (!campaign) {
    return null;
  }

  return toFlowDraft(campaign);
}

export async function createMarketingCampaignFlowDraft(input: {
  createdById: string;
  name: string;
  goalSummary?: string;
  goalPrompt: string;
  imageAssetUrl?: string | null;
  generatedDraft?: {
    subject: string;
    previewText: string;
    contentJson: unknown;
  } | null;
}) {
  const campaignName = input.name.trim();
  const goalSummary = input.goalSummary?.trim() ?? "";
  const goalPrompt = input.goalPrompt.trim();
  const contentJson = input.generatedDraft
    ? normalizeMarketingContentJson(input.generatedDraft.contentJson)
    : buildDefaultDraftContent({
      campaignName,
      goalPrompt,
      imageAssetUrl: input.imageAssetUrl ?? null,
    });

  const htmlSnapshot = renderMarketingPreviewHtml(contentJson);

  const created = await prisma.marketingCampaign.create({
    data: {
      name: campaignName,
      status: MarketingCampaignStatus.DRAFT,
      categoryId: null,
      audienceType: MarketingAudienceType.ALL_USERS,
      manualAudienceJson: mergeFlowMeta(
        { emails: [], userIds: [] },
        {
          goalPrompt,
          goalSummary,
          imageAssetUrl: input.imageAssetUrl ?? null,
          currentStep: "STEP_1",
        },
      ),
      subject: input.generatedDraft?.subject?.trim() || `New campaign: ${campaignName}`,
      previewText: input.generatedDraft?.previewText?.trim() || goalSummary.slice(0, 180) || goalPrompt.slice(0, 180) || "Campaign preview",
      fromName: "Studio Team",
      fromEmail: process.env.EMAIL_FROM?.trim() || "no-reply@bookmyclass.app",
      replyTo: process.env.EMAIL_FROM?.trim() || "no-reply@bookmyclass.app",
      contentJson,
      htmlSnapshot,
      createdById: input.createdById,
    },
  });

  return getMarketingCampaignFlowDraftById(created.id);
}

export async function updateMarketingCampaignFlowDraft(
  id: string,
  updates: {
    name?: string;
    categoryId?: string | null;
    goalSummary?: string;
    goalPrompt?: string;
    subject?: string;
    previewText?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string | null;
    imageAssetUrl?: string | null;
    selectedSegmentIds?: string[];
    contentJson?: unknown;
    currentStep?: MarketingCampaignFlowStep;
  },
) {
  const existing = await prisma.marketingCampaign.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      name: true,
      categoryId: true,
      category: { select: { name: true } },
      manualAudienceJson: true,
      subject: true,
      previewText: true,
      fromName: true,
      fromEmail: true,
      replyTo: true,
      contentJson: true,
      htmlSnapshot: true,
    },
  });

  if (!existing) {
    throw new Error("MARKETING_CAMPAIGN_NOT_FOUND");
  }
  if (existing.status !== MarketingCampaignStatus.DRAFT) {
    throw new Error("MARKETING_CAMPAIGN_NOT_DRAFT");
  }

  let baseContent: ReturnType<typeof normalizeMarketingContentJson>;
  try {
    baseContent = updates.contentJson
      ? normalizeMarketingContentJson(updates.contentJson)
      : normalizeMarketingContentJson(existing.contentJson);
  } catch {
    throw new Error("MARKETING_DRAFT_RENDER_INVALID_CONTENT");
  }

  const imageAssetUrlFromMeta =
    updates.imageAssetUrl === undefined ? readFlowMeta(existing.manualAudienceJson).imageAssetUrl : updates.imageAssetUrl;

  const blocksWithoutImages = baseContent.blocks.filter((block) => block.type !== "image");
  const normalizedContent = imageAssetUrlFromMeta
    ? normalizeMarketingContentJson({
      blocks: [{ type: "image", url: imageAssetUrlFromMeta, alt: `${(updates.name?.trim() || existing.name)} hero image` }, ...blocksWithoutImages],
    })
    : baseContent;
  let htmlSnapshot: string;
  try {
    htmlSnapshot = renderMarketingPreviewHtml(normalizedContent);
  } catch {
    throw new Error("MARKETING_DRAFT_PREVIEW_RENDER_FAILED");
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.marketingCampaign.update({
        where: { id },
        data: {
          name: updates.name?.trim() || existing.name,
          categoryId: updates.categoryId === undefined ? existing.categoryId : updates.categoryId,
          subject: updates.subject?.trim() || existing.subject,
          previewText: updates.previewText?.trim() || existing.previewText,
          fromName: updates.fromName?.trim() || existing.fromName,
          fromEmail: updates.fromEmail ? normalizeEmail(updates.fromEmail) : existing.fromEmail,
          replyTo:
            updates.replyTo === undefined
              ? existing.replyTo
              : updates.replyTo?.trim()
                ? normalizeEmail(updates.replyTo)
                : null,
          contentJson: normalizedContent,
          htmlSnapshot,
          manualAudienceJson: mergeFlowMeta(existing.manualAudienceJson, {
            goalSummary: updates.goalSummary,
            goalPrompt: updates.goalPrompt,
            imageAssetUrl: updates.imageAssetUrl,
            selectedSegmentIds: updates.selectedSegmentIds,
            currentStep: updates.currentStep,
          }),
        },
      });

    });
  } catch {
    throw new Error("MARKETING_DRAFT_PERSIST_FAILED");
  }

  return getMarketingCampaignFlowDraftById(id);
}

export async function resolveMarketingCampaignFlowRecipients(input: {
  campaignId: string;
  selectedSegmentIds?: string[];
  page?: number;
  pageSize?: number;
}): Promise<MarketingCampaignFlowRecipientResolution> {
  const draft = await getMarketingCampaignFlowDraftById(input.campaignId);
  if (!draft) {
    throw new Error("MARKETING_CAMPAIGN_NOT_FOUND");
  }

  const [activeSegments, existingSelectedSegments] = await Promise.all([
    prisma.marketingSegment.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.marketingSegment.findMany({
      where: {
        id: {
          in: input.selectedSegmentIds?.length ? input.selectedSegmentIds : draft.selectedSegmentIds,
        },
      },
      select: { id: true },
    }),
  ]);

  const selectedSegmentIds = existingSelectedSegments.map((segment) => segment.id);
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));
  const requestedPage = Math.max(1, input.page ?? 1);

  const where: Prisma.UserWhereInput = {
    role: Role.CLIENT,
    marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
    ...(selectedSegmentIds.length
      ? {
        marketingSegments: {
          some: {
            segmentId: { in: selectedSegmentIds },
          },
        },
      }
      : {}),
  };

  const totalRecipients = await prisma.user.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalRecipients / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * pageSize;

  const recipients = await prisma.user.findMany({
    where,
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { name: "asc" }, { email: "asc" }],
    skip,
    take: pageSize,
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      marketingSubscriptionStatus: true,
    },
  });

  return {
    selectedSegmentIds,
    segmentOptions: activeSegments,
    totalRecipients,
    page,
    pageSize,
    totalPages,
    recipients: recipients.map((recipient) => {
      const displayName = recipient.name?.trim()
        || [recipient.firstName, recipient.lastName].filter(Boolean).join(" ").trim()
        || recipient.email;
      return {
        id: recipient.id,
        name: displayName,
        email: recipient.email,
        marketingSubscriptionStatus: recipient.marketingSubscriptionStatus,
      };
    }),
  };
}

export async function sendMarketingCampaignFlowTestEmail(input: {
  campaignId: string;
  toEmail: string;
}) {
  const emailParse = z.email().safeParse(input.toEmail.trim().toLowerCase());
  if (!emailParse.success) {
    throw new Error("MARKETING_TEST_EMAIL_INVALID");
  }

  let draft: MarketingCampaignFlowDraft | null;
  try {
    draft = await getMarketingCampaignFlowDraftById(input.campaignId);
  } catch {
    throw new Error("MARKETING_FLOW_TEST_PREVIEW_RENDER_FAILED");
  }
  if (!draft || draft.status !== MarketingCampaignStatus.DRAFT) {
    throw new Error("MARKETING_FLOW_TEST_DRAFT_REQUIRED");
  }

  try {
    renderMarketingPreviewHtml(normalizeMarketingContentJson(draft.contentJson));
  } catch {
    throw new Error("MARKETING_FLOW_TEST_PREVIEW_RENDER_FAILED");
  }

  await sendMarketingCampaignTest({
    campaignId: draft.id,
    toEmail: emailParse.data,
  });
}

export async function sendMarketingCampaignFlowNow(input: { campaignId: string }) {
  const campaign = await prisma.marketingCampaign.findUnique({
    where: { id: input.campaignId },
    select: {
      id: true,
      status: true,
      sentAt: true,
      name: true,
      subject: true,
      fromName: true,
      fromEmail: true,
      replyTo: true,
      contentJson: true,
      manualAudienceJson: true,
      htmlSnapshot: true,
      category: { select: { name: true } },
    },
  });

  if (!campaign) {
    throw new Error("MARKETING_CAMPAIGN_NOT_FOUND");
  }
  if (campaign.status === MarketingCampaignStatus.SENT || campaign.sentAt) {
    throw new Error("MARKETING_CAMPAIGN_ALREADY_SENT");
  }
  if (campaign.status !== MarketingCampaignStatus.DRAFT) {
    throw new Error("MARKETING_CAMPAIGN_NOT_DRAFT");
  }

  const flowMeta = readFlowMeta(campaign.manualAudienceJson);
  if (flowMeta.currentStep !== "STEP_4") {
    throw new Error("MARKETING_FLOW_SEND_STEP_INVALID");
  }

  const fromEmail = marketingSenderEmailSchema.safeParse(campaign.fromEmail.trim().toLowerCase());
  const replyToValue = campaign.replyTo?.trim() || campaign.fromEmail.trim();
  const replyTo = marketingSenderEmailSchema.safeParse(replyToValue.toLowerCase());
  if (!fromEmail.success || !replyTo.success || !campaign.fromName.trim()) {
    throw new Error("MARKETING_FLOW_INVALID_SENDER");
  }

  const contentJson = normalizeMarketingContentJson(campaign.contentJson);
  const previewHtml = renderMarketingPreviewHtml(contentJson);

  const selectedSegmentIds = flowMeta.selectedSegmentIds ?? [];
  const where: Prisma.UserWhereInput = {
    role: Role.CLIENT,
    marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
    ...(selectedSegmentIds.length
      ? {
        marketingSegments: {
          some: {
            segmentId: { in: selectedSegmentIds },
          },
        },
      }
      : {}),
  };

  // Persist recipient snapshot before the SENDING status flip so a crash between
  // the two operations leaves the campaign in DRAFT with recipients intact (clean retry).
  // Paginated to avoid loading thousands of user rows into memory at once.
  const RECIPIENT_SNAPSHOT_PAGE = 500;
  let snapshotCursor: string | undefined;
  while (true) {
    const userPage = await prisma.user.findMany({
      where,
      take: RECIPIENT_SNAPSHOT_PAGE,
      ...(snapshotCursor ? { cursor: { id: snapshotCursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: { id: true, email: true },
    });
    if (userPage.length === 0) break;
    await prisma.marketingCampaignRecipient.createMany({
      data: userPage.map((u) => ({
        campaignId: campaign.id,
        userId: u.id,
        email: u.email,
        status: MarketingRecipientStatus.PENDING,
      })),
      skipDuplicates: true,
    });
    snapshotCursor = userPage[userPage.length - 1].id;
    if (userPage.length < RECIPIENT_SNAPSHOT_PAGE) break;
  }

  const moved = await prisma.marketingCampaign.updateMany({
    where: {
      id: campaign.id,
      status: MarketingCampaignStatus.DRAFT,
      sentAt: null,
    },
    data: {
      status: MarketingCampaignStatus.SENDING,
      updatedAt: new Date(),
    },
  });
  if (moved.count < 1) {
    throw new Error("MARKETING_CAMPAIGN_ALREADY_SENT");
  }

  try {

    const links = extractTrackingLinks(contentJson);
    await prisma.$transaction(async (tx) => {
      await tx.marketingCampaignLink.deleteMany({ where: { campaignId: campaign.id } });
      if (links.length > 0) {
        await tx.marketingCampaignLink.createMany({
          data: links.map((link) => ({
            campaignId: campaign.id,
            url: link.url,
            token: link.token || buildTrackingToken(),
            clickCount: 0,
          })),
          skipDuplicates: true,
        });
      }
    });

    const storedLinks = await prisma.marketingCampaignLink.findMany({ where: { campaignId: campaign.id } });
    const appUrl = process.env.APP_URL?.trim() || "http://localhost:3000";
    const now = new Date();

    // Cursor-paginate the send loop to avoid loading all PENDING recipients into memory.
    // Each batch is fetched fresh; rows become SENT/FAILED after processing so they
    // are excluded from subsequent pages.
    const SEND_BATCH_SIZE = 50;
    while (true) {
      const batch = await prisma.marketingCampaignRecipient.findMany({
        where: { campaignId: campaign.id, status: MarketingRecipientStatus.PENDING },
        take: SEND_BATCH_SIZE,
        orderBy: { id: "asc" },
      });
      if (batch.length === 0) break;
      await Promise.all(
        batch.map(async (recipient) => {
          const recipientToken = createRecipientTrackingToken(recipient.id);
          const html = renderMarketingEmailHtml({
            contentJson,
            links: storedLinks.map((link) => ({ url: link.url, token: link.token })),
            appUrl,
            recipientToken,
          });
          const providerResult = await sendMarketingEmailViaResend({
            to: recipient.email,
            subject: campaign.subject,
            html,
            fromName: campaign.fromName,
            fromEmail: fromEmail.data,
            replyTo: replyTo.data,
          });

          await prisma.marketingCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
              status: providerResult.sent ? MarketingRecipientStatus.SENT : MarketingRecipientStatus.FAILED,
              sentAt: providerResult.sent ? now : null,
            },
          });
        }),
      );
      if (batch.length < SEND_BATCH_SIZE) break;
    }

    const recipientStatusRows = await prisma.marketingCampaignRecipient.groupBy({
      by: ["status"],
      where: { campaignId: campaign.id },
      _count: { _all: true },
    });
    const failedRecipientCount = recipientStatusRows.find((row) => row.status === MarketingRecipientStatus.FAILED)?._count._all ?? 0;
    if (!isDeterministicEmailDeliveryMode() && failedRecipientCount > 0) {
      await prisma.marketingCampaign.update({
        where: { id: campaign.id },
        data: {
          status: MarketingCampaignStatus.SENDING,
          sentAt: null,
          htmlSnapshot: previewHtml,
        },
      });
      throw new Error("MARKETING_CAMPAIGN_DELIVERY_INCOMPLETE");
    }

    await prisma.marketingCampaign.update({
      where: { id: campaign.id },
      data: {
        status: MarketingCampaignStatus.SENT,
        sentAt: new Date(),
        htmlSnapshot: previewHtml,
        manualAudienceJson: mergeFlowMeta(campaign.manualAudienceJson, { currentStep: "SENT" }),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MARKETING_CAMPAIGN_DELIVERY_INCOMPLETE") {
      throw error;
    }
    await prisma.marketingCampaign.update({
      where: { id: campaign.id },
      data: { status: MarketingCampaignStatus.DRAFT },
    });
    throw error;
  }
}

export async function getMarketingCampaignFlowSentSummary(campaignId: string): Promise<MarketingCampaignFlowSentSummary | null> {
  const campaign = await prisma.marketingCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      status: true,
      sentAt: true,
      manualAudienceJson: true,
      category: { select: { name: true } },
      _count: { select: { recipients: true } },
    },
  });
  if (!campaign) {
    return null;
  }

  const selectedSegmentIds = readFlowMeta(campaign.manualAudienceJson).selectedSegmentIds ?? [];
  const selectedSegments = selectedSegmentIds.length
    ? await prisma.marketingSegment.findMany({
      where: { id: { in: selectedSegmentIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
    : [];

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    status: campaign.status,
    recipientCount: campaign._count.recipients,
    categoryName: campaign.category?.name ?? null,
    selectedSegmentIds,
    selectedSegmentNames: selectedSegments.map((segment) => segment.name),
    sentAt: campaign.sentAt,
  };
}

function toCampaignStatusWhere(filter: MarketingCampaignPageFilter): Prisma.MarketingCampaignWhereInput {
  if (filter === "sent") {
    return { status: MarketingCampaignStatus.SENT };
  }
  if (filter === "draft") {
    return { status: MarketingCampaignStatus.DRAFT };
  }
  return {};
}

export async function getMarketingCampaignGlobalMetrics(now: Date = new Date()): Promise<MarketingCampaignGlobalMetrics> {
  const sentInLast30DaysStart = new Date(now);
  sentInLast30DaysStart.setDate(sentInLast30DaysStart.getDate() - 30);

  const [totalCampaigns, totalSentCampaigns, totalDraftCampaigns, sentInLast30Days, totalRecipientsReached] = await Promise.all([
    prisma.marketingCampaign.count(),
    prisma.marketingCampaign.count({
      where: { status: MarketingCampaignStatus.SENT },
    }),
    prisma.marketingCampaign.count({
      where: { status: MarketingCampaignStatus.DRAFT },
    }),
    prisma.marketingCampaign.count({
      where: {
        status: MarketingCampaignStatus.SENT,
        sentAt: { gte: sentInLast30DaysStart },
      },
    }),
    prisma.marketingCampaignRecipient.count({
      where: { campaign: { status: MarketingCampaignStatus.SENT } },
    }),
  ]);

  return {
    totalCampaigns,
    totalSentCampaigns,
    totalDraftCampaigns,
    sentInLast30Days,
    totalRecipientsReached,
    averageRecipientsPerSentCampaign:
      totalSentCampaigns > 0 ? Number((totalRecipientsReached / totalSentCampaigns).toFixed(1)) : 0,
  };
}

export async function getMarketingCampaignListPageData(input: {
  page: number;
  pageSize?: number;
  filter: MarketingCampaignPageFilter;
  query?: string;
}): Promise<MarketingCampaignListPageData> {
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));
  const page = Math.max(1, Math.floor(input.page));
  const query = input.query?.trim() ?? "";

  const where: Prisma.MarketingCampaignWhereInput = {
    ...toCampaignStatusWhere(input.filter),
    ...(query
      ? {
        OR: [
          {
            name: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            subject: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            category: {
              is: {
                name: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
          },
        ],
      }
      : {}),
  };

  const totalItems = await prisma.marketingCampaign.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const skip = (safePage - 1) * pageSize;

  const rows = await prisma.marketingCampaign.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    skip,
    take: pageSize,
    select: {
      id: true,
      name: true,
      status: true,
      sentAt: true,
      updatedAt: true,
      category: {
        select: {
          name: true,
        },
      },
      _count: {
        select: {
          recipients: true,
        },
      },
    },
  });

  return {
    filter: input.filter,
    query,
    page: safePage,
    pageSize,
    totalItems,
    totalPages,
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      categoryName: row.category?.name ?? "-",
      status: row.status,
      sentAt: row.sentAt,
      updatedAt: row.updatedAt,
      recipientCount: row._count.recipients,
    })),
  };
}

export async function getMarketingSentCampaignSummaryById(campaignId: string): Promise<MarketingSentCampaignSummary | null> {
  const [campaign, recipientCounts] = await Promise.all([
    prisma.marketingCampaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        name: true,
        status: true,
        sentAt: true,
        manualAudienceJson: true,
        fromName: true,
        fromEmail: true,
        replyTo: true,
        subject: true,
        previewText: true,
        htmlSnapshot: true,
        contentJson: true,
        category: { select: { name: true } },
      },
    }),
    prisma.marketingCampaignRecipient.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: { _all: true },
    }),
  ]);

  if (!campaign) {
    return null;
  }

  const selectedSegmentIds = readFlowMeta(campaign.manualAudienceJson).selectedSegmentIds ?? [];
  const selectedSegments = selectedSegmentIds.length
    ? await prisma.marketingSegment.findMany({
      where: { id: { in: selectedSegmentIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
    : [];

  const getCount = (status: MarketingRecipientStatus) =>
    recipientCounts.find((r) => r.status === status)?._count._all ?? 0;

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    status: campaign.status,
    sentAt: campaign.sentAt,
    categoryName: campaign.category?.name ?? null,
    fromName: campaign.fromName,
    fromEmail: campaign.fromEmail,
    replyTo: campaign.replyTo,
    subject: campaign.subject,
    previewText: campaign.previewText,
    selectedSegmentIds,
    selectedSegmentNames: selectedSegments.map((segment) => segment.name),
    recipientCount: recipientCounts.reduce((sum, r) => sum + r._count._all, 0),
    recipientSentCount: getCount(MarketingRecipientStatus.SENT),
    recipientFailedCount: getCount(MarketingRecipientStatus.FAILED),
    recipientPendingCount: getCount(MarketingRecipientStatus.PENDING),
    htmlSnapshot: campaign.htmlSnapshot?.trim() || renderMarketingPreviewHtml(normalizeMarketingContentJson(campaign.contentJson)),
  };
}

export async function getMarketingCampaignById(id: string) {
  return prisma.marketingCampaign.findUnique({
    where: { id },
    include: {
      category: true,
      recipients: true,
    },
  });
}

export async function createMarketingCampaignDraft(input: MarketingCampaignEditorInput & { createdById: string }) {
  const contentJson = normalizeMarketingContentJson(input.contentJson);
  return prisma.marketingCampaign.create({
    data: {
      name: input.name.trim(),
      status: MarketingCampaignStatus.DRAFT,
      categoryId: input.categoryId ?? null,
      audienceType: input.audienceType,
      manualAudienceJson: toManualAudience(input.manualAudienceJson),
      subject: input.subject.trim(),
      previewText: input.previewText.trim(),
      fromName: input.fromName.trim(),
      fromEmail: normalizeEmail(input.fromEmail),
      replyTo: input.replyTo?.trim() ? normalizeEmail(input.replyTo) : null,
      contentJson,
      createdById: input.createdById,
    },
  });
}

export async function updateMarketingCampaignDraft(id: string, input: MarketingCampaignEditorInput) {
  const contentJson = normalizeMarketingContentJson(input.contentJson);
  const updated = await prisma.marketingCampaign.updateMany({
    where: {
      id,
      status: MarketingCampaignStatus.DRAFT,
    },
    data: {
      name: input.name.trim(),
      categoryId: input.categoryId ?? null,
      audienceType: input.audienceType,
      manualAudienceJson: toManualAudience(input.manualAudienceJson),
      subject: input.subject.trim(),
      previewText: input.previewText.trim(),
      fromName: input.fromName.trim(),
      fromEmail: normalizeEmail(input.fromEmail),
      replyTo: input.replyTo?.trim() ? normalizeEmail(input.replyTo) : null,
      contentJson,
    },
  });

  if (updated.count < 1) {
    throw new Error("MARKETING_CAMPAIGN_NOT_DRAFT");
  }
}

export async function deleteMarketingCampaignDraft(id: string) {
  const result = await prisma.marketingCampaign.deleteMany({
    where: {
      id,
      status: MarketingCampaignStatus.DRAFT,
    },
  });

  if (result.count < 1) {
    throw new Error("MARKETING_CAMPAIGN_NOT_DRAFT");
  }
}

export async function duplicateMarketingCampaign(id: string, createdById: string) {
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!campaign) {
    throw new Error("MARKETING_CAMPAIGN_NOT_FOUND");
  }

  return prisma.marketingCampaign.create({
    data: {
      name: `${campaign.name} (Copy)`,
      status: MarketingCampaignStatus.DRAFT,
      categoryId: campaign.categoryId,
      audienceType: campaign.audienceType,
      manualAudienceJson: toManualAudience(campaign.manualAudienceJson),
      subject: campaign.subject,
      previewText: campaign.previewText,
      fromName: campaign.fromName,
      fromEmail: campaign.fromEmail,
      replyTo: campaign.replyTo,
      contentJson: normalizeMarketingContentJson(campaign.contentJson),
      createdById,
    },
  });
}

export async function listMarketingCategories() {
  const [categories, usage] = await Promise.all([
    prisma.marketingCategory.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.marketingCampaign.groupBy({
      by: ["categoryId"],
      _count: { _all: true },
      where: { categoryId: { not: null } },
    }),
  ]);

  const usageMap = new Map(usage.map((row) => [row.categoryId, row._count._all]));
  return categories.map((category) => ({
    ...category,
    usageCount: usageMap.get(category.id) ?? 0,
  }));
}

export async function listMarketingSegments() {
  const [segments, usage] = await Promise.all([
    prisma.marketingSegment.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.marketingUserSegment.groupBy({
      by: ["segmentId"],
      _count: { _all: true },
    }),
  ]);

  const usageMap = new Map(usage.map((row) => [row.segmentId, row._count._all]));
  return segments.map((segment) => ({
    ...segment,
    usageCount: usageMap.get(segment.id) ?? 0,
  }));
}

export async function createMarketingCategory(input: { name: string; isActive: boolean }) {
  const baseSlug = slugify(input.name);
  const slug = baseSlug || `category-${Date.now()}`;

  return prisma.marketingCategory.create({
    data: {
      name: input.name.trim(),
      slug,
      isActive: input.isActive,
    },
  });
}

export async function createMarketingSegment(input: { name: string; isActive: boolean }) {
  const baseSlug = slugify(input.name);
  const slug = baseSlug || `segment-${Date.now()}`;

  return prisma.marketingSegment.create({
    data: {
      name: input.name.trim(),
      slug,
      isActive: input.isActive,
    },
  });
}

export async function updateMarketingCategory(input: { id: string; name: string; isActive: boolean }) {
  const slug = slugify(input.name) || `category-${Date.now()}`;

  return prisma.marketingCategory.update({
    where: { id: input.id },
    data: {
      name: input.name.trim(),
      slug,
      isActive: input.isActive,
    },
  });
}

export async function updateMarketingSegment(input: { id: string; name: string; isActive: boolean }) {
  const slug = slugify(input.name) || `segment-${Date.now()}`;

  return prisma.marketingSegment.update({
    where: { id: input.id },
    data: {
      name: input.name.trim(),
      slug,
      isActive: input.isActive,
    },
  });
}

export async function estimateAudienceForCampaign(input: {
  audienceType: MarketingAudienceType;
  manualAudienceJson?: Prisma.JsonValue | null;
}) {
  const manualAudience = toManualAudience(input.manualAudienceJson);
  const resolved = await resolveMarketingAudience({
    audienceType: input.audienceType,
    manualAudience,
  });
  const filtered = await excludeUnsubscribedRecipients(resolved);
  return {
    totalResolved: resolved.length,
    totalAfterUnsubscribe: filtered.length,
  };
}

