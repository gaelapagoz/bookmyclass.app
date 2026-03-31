import { MarketingAudienceType, MarketingCampaignStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { excludeUnsubscribedRecipients, resolveMarketingAudience } from "@/lib/marketing/marketing-audience";
import { normalizeMarketingContentJson } from "@/lib/marketing/marketing-renderer";

export type MarketingCampaignListFilter = "draft" | "sent";
export type MarketingCampaignPageFilter = MarketingCampaignListFilter | "all";

export type MarketingCampaignListItem = {
  id: string;
  name: string;
  categoryName: string;
  status: string;
  audience: string;
  updatedAt: Date;
  sentAt: Date | null;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  openRate: number;
  clickRate: number;
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

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
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

export async function listMarketingCampaigns(filter: MarketingCampaignListFilter) {
  const status = filter === "sent" ? MarketingCampaignStatus.SENT : MarketingCampaignStatus.DRAFT;
  return prisma.marketingCampaign.findMany({
    where: { status },
    include: {
      category: { select: { name: true } },
      recipients: {
        select: {
          id: true,
          sentAt: true,
          openedAt: true,
          clickedAt: true,
          unsubscribedAt: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listMarketingCampaignListItems(filter: MarketingCampaignPageFilter = "all"): Promise<MarketingCampaignListItem[]> {
  const where =
    filter === "all"
      ? undefined
      : { status: filter === "sent" ? MarketingCampaignStatus.SENT : MarketingCampaignStatus.DRAFT };

  const rows = await prisma.marketingCampaign.findMany({
    where,
    include: {
      category: { select: { name: true } },
      recipients: {
        select: {
          sentAt: true,
          openedAt: true,
          clickedAt: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return rows.map((row) => {
    const sentCount = row.recipients.filter((recipient) => Boolean(recipient.sentAt)).length;
    const openedCount = row.recipients.filter((recipient) => Boolean(recipient.openedAt)).length;
    const clickedCount = row.recipients.filter((recipient) => Boolean(recipient.clickedAt)).length;

    return {
      id: row.id,
      name: row.name,
      categoryName: row.category?.name ?? "-",
      status: row.status,
      audience: row.audienceType,
      updatedAt: row.updatedAt,
      sentAt: row.sentAt,
      sentCount,
      openedCount,
      clickedCount,
      openRate: sentCount > 0 ? Number(((openedCount / sentCount) * 100).toFixed(1)) : 0,
      clickRate: sentCount > 0 ? Number(((clickedCount / sentCount) * 100).toFixed(1)) : 0,
    };
  });
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
