import "./helpers/setup-env";

import { MarketingAudienceType, MarketingCampaignStatus, MarketingRecipientStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getMarketingCampaignGlobalMetrics,
  getMarketingCampaignListPageData,
  getMarketingSentCampaignSummaryById,
} from "../../src/lib/marketing/marketing-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("marketing observability", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function seedCampaigns() {
    const admin = await prisma.user.create({
      data: {
        name: "Admin User",
        firstName: "Admin",
        lastName: "User",
        email: `admin.obs.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const category = await prisma.marketingCategory.create({
      data: {
        name: "Retention",
        slug: `retention-${Date.now()}`,
        isActive: true,
      },
    });

    const draftCampaign = await prisma.marketingCampaign.create({
      data: {
        name: "Draft Alpha",
        status: MarketingCampaignStatus.DRAFT,
        categoryId: category.id,
        audienceType: MarketingAudienceType.ALL_USERS,
        manualAudienceJson: { emails: [], userIds: [] },
        subject: "Draft Subject",
        previewText: "Draft Preview",
        fromName: "Studio Team",
        fromEmail: "no-reply@bookmyclass.app",
        replyTo: "no-reply@bookmyclass.app",
        contentJson: { blocks: [{ type: "paragraph", contentHtml: "<p>Draft</p>" }] },
        htmlSnapshot: "<p>Draft</p>",
        createdById: admin.id,
      },
    });

    const sentRecent = await prisma.marketingCampaign.create({
      data: {
        name: "Sent Spring",
        status: MarketingCampaignStatus.SENT,
        sentAt: new Date(),
        categoryId: category.id,
        audienceType: MarketingAudienceType.ALL_USERS,
        manualAudienceJson: { emails: [], userIds: [], flow: { selectedSegmentIds: [] } },
        subject: "Spring Subject",
        previewText: "Spring Preview",
        fromName: "Studio Team",
        fromEmail: "no-reply@bookmyclass.app",
        replyTo: "no-reply@bookmyclass.app",
        contentJson: { blocks: [{ type: "paragraph", contentHtml: "<p>Sent</p>" }] },
        htmlSnapshot: "<p>Sent</p>",
        createdById: admin.id,
      },
    });

    const sentOld = await prisma.marketingCampaign.create({
      data: {
        name: "Sent Winter",
        status: MarketingCampaignStatus.SENT,
        sentAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        categoryId: category.id,
        audienceType: MarketingAudienceType.ALL_USERS,
        manualAudienceJson: { emails: [], userIds: [] },
        subject: "Winter Subject",
        previewText: "Winter Preview",
        fromName: "Studio Team",
        fromEmail: "no-reply@bookmyclass.app",
        replyTo: "no-reply@bookmyclass.app",
        contentJson: { blocks: [{ type: "paragraph", contentHtml: "<p>Sent</p>" }] },
        htmlSnapshot: "<p>Sent</p>",
        createdById: admin.id,
      },
    });

    await prisma.marketingCampaignRecipient.createMany({
      data: [
        {
          campaignId: sentRecent.id,
          email: `recent.one.${Date.now()}@example.test`,
          status: MarketingRecipientStatus.SENT,
          sentAt: new Date(),
        },
        {
          campaignId: sentRecent.id,
          email: `recent.two.${Date.now()}@example.test`,
          status: MarketingRecipientStatus.FAILED,
        },
        {
          campaignId: sentOld.id,
          email: `old.one.${Date.now()}@example.test`,
          status: MarketingRecipientStatus.SENT,
          sentAt: new Date(),
        },
      ],
    });

    return { draftCampaign, sentRecent, sentOld };
  }

  it("lists campaigns with filter, search, and pagination", async () => {
    await seedCampaigns();

    const sentPage = await getMarketingCampaignListPageData({
      page: 1,
      pageSize: 1,
      filter: "sent",
      query: "spring",
    });

    expect(sentPage.totalItems).toBe(1);
    expect(sentPage.totalPages).toBe(1);
    expect(sentPage.items).toHaveLength(1);
    expect(sentPage.items[0]?.name).toBe("Sent Spring");

    const draftPage = await getMarketingCampaignListPageData({
      page: 1,
      pageSize: 20,
      filter: "draft",
      query: "alpha",
    });

    expect(draftPage.totalItems).toBe(1);
    expect(draftPage.items[0]?.status).toBe(MarketingCampaignStatus.DRAFT);
  });

  it("returns global metrics from persisted campaign and recipient truth", async () => {
    await seedCampaigns();

    const metrics = await getMarketingCampaignGlobalMetrics();

    expect(metrics.totalCampaigns).toBe(3);
    expect(metrics.totalSentCampaigns).toBe(2);
    expect(metrics.totalDraftCampaigns).toBe(1);
    expect(metrics.sentInLast30Days).toBe(1);
    expect(metrics.totalRecipientsReached).toBe(3);
    expect(metrics.averageRecipientsPerSentCampaign).toBe(1.5);
  });

  it("returns sent campaign summary from persisted backend truth", async () => {
    const { sentRecent, draftCampaign } = await seedCampaigns();

    const summary = await getMarketingSentCampaignSummaryById(sentRecent.id);
    expect(summary?.campaignId).toBe(sentRecent.id);
    expect(summary?.status).toBe(MarketingCampaignStatus.SENT);
    expect(summary?.recipientCount).toBe(2);
    expect(summary?.recipientSentCount).toBe(1);
    expect(summary?.recipientFailedCount).toBe(1);

    const draftSummary = await getMarketingSentCampaignSummaryById(draftCampaign.id);
    expect(draftSummary?.status).toBe(MarketingCampaignStatus.DRAFT);
  });
});
