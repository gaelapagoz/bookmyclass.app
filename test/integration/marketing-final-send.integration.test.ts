import "./helpers/setup-env";

import { MarketingCampaignStatus, MarketingSubscriptionStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createMarketingCampaignFlowDraft,
  getMarketingCampaignFlowDraftById,
  getMarketingCampaignFlowSentSummary,
  sendMarketingCampaignFlowNow,
  updateMarketingCampaignFlowDraft,
} from "../../src/lib/marketing/marketing-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("marketing final send", () => {
  beforeEach(async () => {
    await resetDb();
    delete process.env.RESEND_API_KEY;
  });

  it("sends from Step 4 using persisted block content and phase-3 recipient resolution", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        firstName: "Admin",
        lastName: "User",
        email: `admin.final.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const [segA, segB] = await Promise.all([
      prisma.marketingSegment.create({ data: { name: "Segment A", slug: `seg-a-${Date.now()}`, isActive: true } }),
      prisma.marketingSegment.create({ data: { name: "Segment B", slug: `seg-b-${Date.now()}`, isActive: true } }),
    ]);

    const [subA, subB, unsubscribed, neverSub] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Sub A",
          firstName: "Sub",
          lastName: "A",
          email: `sub-a.${Date.now()}@example.test`,
          role: Role.CLIENT,
          marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
        },
      }),
      prisma.user.create({
        data: {
          name: "Sub B",
          firstName: "Sub",
          lastName: "B",
          email: `sub-b.${Date.now()}@example.test`,
          role: Role.CLIENT,
          marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
        },
      }),
      prisma.user.create({
        data: {
          name: "Unsubscribed",
          firstName: "Un",
          lastName: "Sub",
          email: `unsub.${Date.now()}@example.test`,
          role: Role.CLIENT,
          marketingSubscriptionStatus: MarketingSubscriptionStatus.UNSUBSCRIBED,
        },
      }),
      prisma.user.create({
        data: {
          name: "Never",
          firstName: "Never",
          lastName: "Sub",
          email: `never.${Date.now()}@example.test`,
          role: Role.CLIENT,
          marketingSubscriptionStatus: MarketingSubscriptionStatus.NEVER_SUBSCRIBED,
        },
      }),
    ]);

    await prisma.marketingUserSegment.createMany({
      data: [
        { userId: subA.id, segmentId: segA.id },
        { userId: subB.id, segmentId: segB.id },
        { userId: unsubscribed.id, segmentId: segA.id },
        { userId: neverSub.id, segmentId: segB.id },
      ],
    });

    const draft = await createMarketingCampaignFlowDraft({
      createdById: admin.id,
      name: "Final Send Campaign",
      goalPrompt: "",
      generatedDraft: {
        subject: "Styled subject",
        previewText: "Styled preview",
        contentJson: {
          blocks: [
            { type: "heading", contentHtml: "<p>Header</p>", textColor: "#2563eb" },
            { type: "paragraph", contentHtml: "<p>Body</p>", textColor: "#334155" },
            {
              type: "button",
              labelHtml: "Book now",
              url: "https://example.com/book",
              textColor: "#ffffff",
              backgroundColor: "#1d3652",
            },
          ],
        },
      },
    });

    expect(draft?.fromEmail).toBe("no-reply@bookmyclass.app");
    expect(draft?.replyTo).toBe("no-reply@bookmyclass.app");

    await updateMarketingCampaignFlowDraft(draft!.id, {
      selectedSegmentIds: [segA.id, segB.id],
      currentStep: "STEP_4",
      fromName: "BookMyClass",
      fromEmail: "no-reply@bookmyclass.app",
      replyTo: "no-reply@bookmyclass.app",
    });

    const rehydratedDraft = await getMarketingCampaignFlowDraftById(draft!.id);
    expect(rehydratedDraft?.contentJson).toEqual(
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: "heading", textColor: "#2563eb" }),
          expect.objectContaining({ type: "paragraph", textColor: "#334155" }),
          expect.objectContaining({ type: "button", textColor: "#ffffff", backgroundColor: "#1d3652" }),
        ]),
      }),
    );

    await sendMarketingCampaignFlowNow({ campaignId: draft!.id });

    const persistedCampaign = await prisma.marketingCampaign.findUnique({
      where: { id: draft!.id },
      include: { recipients: true },
    });

    expect(persistedCampaign?.status).toBe(MarketingCampaignStatus.SENT);
    expect(persistedCampaign?.sentAt).toBeTruthy();
    expect(persistedCampaign?.htmlSnapshot).toContain("color:#2563eb");
    expect(persistedCampaign?.htmlSnapshot).toContain("background:#1d3652");

    const recipientEmails = (persistedCampaign?.recipients ?? []).map((row) => row.email).sort();
    expect(recipientEmails).toEqual([subA.email, subB.email].sort());

    const sentSummary = await getMarketingCampaignFlowSentSummary(draft!.id);
    expect(sentSummary?.recipientCount).toBe(2);
    expect(sentSummary?.selectedSegmentNames.sort()).toEqual(["Segment A", "Segment B"]);
  });

  it("blocks duplicate final sends", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        firstName: "Admin",
        lastName: "User",
        email: `admin.duplicate.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const draft = await createMarketingCampaignFlowDraft({
      createdById: admin.id,
      name: "Duplicate Send Campaign",
      goalPrompt: "",
      generatedDraft: {
        subject: "Subject",
        previewText: "Preview",
        contentJson: {
          blocks: [{ type: "paragraph", contentHtml: "<p>Body</p>" }],
        },
      },
    });

    await updateMarketingCampaignFlowDraft(draft!.id, {
      currentStep: "STEP_4",
      fromEmail: "no-reply@bookmyclass.app",
      replyTo: "no-reply@bookmyclass.app",
    });

    await sendMarketingCampaignFlowNow({ campaignId: draft!.id });

    await expect(sendMarketingCampaignFlowNow({ campaignId: draft!.id })).rejects.toThrow(
      "MARKETING_CAMPAIGN_ALREADY_SENT",
    );
  });
});
