import "./helpers/setup-env";

import { MarketingCampaignStatus, MarketingSubscriptionStatus, Role } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const originalNodeEnv = process.env.NODE_ENV;
  const originalResendApiKey = process.env.RESEND_API_KEY;
  const originalE2eMode = process.env.E2E_TEST_MODE;
  const originalTrackingSecret = process.env.MARKETING_TRACKING_SECRET;

  beforeEach(async () => {
    await resetDb();
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "test";
    delete process.env.E2E_TEST_MODE;
    process.env.MARKETING_TRACKING_SECRET = process.env.MARKETING_TRACKING_SECRET || "test-marketing-tracking-secret";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.RESEND_API_KEY = originalResendApiKey;
    process.env.E2E_TEST_MODE = originalE2eMode;
    process.env.MARKETING_TRACKING_SECRET = originalTrackingSecret;
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

  it("does not mark campaign SENT when provider config is missing outside deterministic mode", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.E2E_TEST_MODE;
    delete process.env.RESEND_API_KEY;
    process.env.MARKETING_TRACKING_SECRET = "test-marketing-tracking-secret";

    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        firstName: "Admin",
        lastName: "User",
        email: `admin.missing-provider.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });
    const recipient = await prisma.user.create({
      data: {
        name: "Recipient",
        firstName: "Recipient",
        lastName: "User",
        email: `recipient.missing-provider.${Date.now()}@example.test`,
        role: Role.CLIENT,
        marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
      },
    });
    expect(recipient.id).toBeTruthy();

    const draft = await createMarketingCampaignFlowDraft({
      createdById: admin.id,
      name: "Missing Provider Config Campaign",
      goalPrompt: "",
      generatedDraft: {
        subject: "Provider config missing",
        previewText: "Preview",
        contentJson: { blocks: [{ type: "paragraph", contentHtml: "<p>Body</p>" }] },
      },
    });
    await updateMarketingCampaignFlowDraft(draft!.id, {
      currentStep: "STEP_4",
      fromEmail: "no-reply@bookmyclass.app",
      replyTo: "no-reply@bookmyclass.app",
    });

    await expect(sendMarketingCampaignFlowNow({ campaignId: draft!.id })).rejects.toThrow(
      "MARKETING_CAMPAIGN_DELIVERY_INCOMPLETE",
    );

    const persistedCampaign = await prisma.marketingCampaign.findUnique({
      where: { id: draft!.id },
      select: { status: true, sentAt: true },
    });
    expect(persistedCampaign?.status).toBe(MarketingCampaignStatus.SENDING);
    expect(persistedCampaign?.sentAt).toBeNull();
  });

  it("does not mark campaign SENT when provider send fails outside deterministic mode", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.E2E_TEST_MODE;
    process.env.RESEND_API_KEY = "resend-failing-key";
    process.env.MARKETING_TRACKING_SECRET = "test-marketing-tracking-secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "provider down" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    try {
      const admin = await prisma.user.create({
        data: {
          name: "Admin",
          firstName: "Admin",
          lastName: "User",
          email: `admin.provider-failure.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      });
      await prisma.user.create({
        data: {
          name: "Recipient",
          firstName: "Recipient",
          lastName: "User",
          email: `recipient.provider-failure.${Date.now()}@example.test`,
          role: Role.CLIENT,
          marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
        },
      });

      const draft = await createMarketingCampaignFlowDraft({
        createdById: admin.id,
        name: "Provider Failure Campaign",
        goalPrompt: "",
        generatedDraft: {
          subject: "Provider failure",
          previewText: "Preview",
          contentJson: { blocks: [{ type: "paragraph", contentHtml: "<p>Body</p>" }] },
        },
      });
      await updateMarketingCampaignFlowDraft(draft!.id, {
        currentStep: "STEP_4",
        fromEmail: "no-reply@bookmyclass.app",
        replyTo: "no-reply@bookmyclass.app",
      });

      await expect(sendMarketingCampaignFlowNow({ campaignId: draft!.id })).rejects.toThrow(
        "MARKETING_CAMPAIGN_DELIVERY_INCOMPLETE",
      );

      const persistedCampaign = await prisma.marketingCampaign.findUnique({
        where: { id: draft!.id },
        select: { status: true, sentAt: true },
      });
      expect(persistedCampaign?.status).toBe(MarketingCampaignStatus.SENDING);
      expect(persistedCampaign?.sentAt).toBeNull();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("succeeds cleanly when recipients were persisted before the SENDING flip (crash-safe ordering)", async () => {
    // This verifies the crash-safe ordering: createMany runs before updateMany(SENDING).
    // If the process had crashed after createMany but before the CAS flip, the campaign
    // stays DRAFT with PENDING recipients. A retry must not duplicate rows and must succeed.
    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        firstName: "Admin",
        lastName: "User",
        email: `admin.crash-ordering.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const subscriber = await prisma.user.create({
      data: {
        name: "Subscriber",
        firstName: "Sub",
        lastName: "User",
        email: `sub.crash-ordering.${Date.now()}@example.test`,
        role: Role.CLIENT,
        marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
      },
    });

    const draft = await createMarketingCampaignFlowDraft({
      createdById: admin.id,
      name: "Crash-Ordering Campaign",
      goalPrompt: "",
      generatedDraft: {
        subject: "Crash ordering subject",
        previewText: "Preview",
        contentJson: { blocks: [{ type: "paragraph", contentHtml: "<p>Body</p>" }] },
      },
    });
    await updateMarketingCampaignFlowDraft(draft!.id, {
      currentStep: "STEP_4",
      fromEmail: "no-reply@bookmyclass.app",
      replyTo: "no-reply@bookmyclass.app",
    });

    // Simulate crash after createMany but before CAS: pre-seed PENDING recipients while
    // the campaign is still in DRAFT (the new ordering guarantees this state is reachable).
    await prisma.marketingCampaignRecipient.create({
      data: {
        campaignId: draft!.id,
        userId: subscriber.id,
        email: subscriber.email,
        status: "PENDING",
      },
    });

    // Retry: campaign is still DRAFT, one PENDING recipient already exists.
    await sendMarketingCampaignFlowNow({ campaignId: draft!.id });

    const recipients = await prisma.marketingCampaignRecipient.findMany({
      where: { campaignId: draft!.id },
    });
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.status).toBe("SENT");

    const campaign = await prisma.marketingCampaign.findUnique({ where: { id: draft!.id } });
    expect(campaign?.status).toBe(MarketingCampaignStatus.SENT);
  });

  it("uses EMAIL_FROM env var as fromEmail when set", async () => {
    const originalEmailFrom = process.env.EMAIL_FROM;
    process.env.EMAIL_FROM = "custom@studio.example";

    try {
      const admin = await prisma.user.create({
        data: {
          name: "Admin",
          firstName: "Admin",
          lastName: "User",
          email: `admin.emailfrom.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      });

      const draft = await createMarketingCampaignFlowDraft({
        createdById: admin.id,
        name: "EMAIL_FROM Campaign",
        goalPrompt: "",
        generatedDraft: {
          subject: "Subject",
          previewText: "Preview",
          contentJson: { blocks: [{ type: "paragraph", contentHtml: "<p>Body</p>" }] },
        },
      });

      expect(draft?.fromEmail).toBe("custom@studio.example");
      expect(draft?.replyTo).toBe("custom@studio.example");
    } finally {
      process.env.EMAIL_FROM = originalEmailFrom;
    }
  });

  it("preserves already-sent recipients when campaign is reset and retried (idempotent createMany)", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        firstName: "Admin",
        lastName: "User",
        email: `admin.idempotent.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const subscribedUser = await prisma.user.create({
      data: {
        name: "Subscriber",
        firstName: "Sub",
        lastName: "User",
        email: `sub.idempotent.${Date.now()}@example.test`,
        role: Role.CLIENT,
        marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
      },
    });

    const draft = await createMarketingCampaignFlowDraft({
      createdById: admin.id,
      name: "Idempotent Send Campaign",
      goalPrompt: "",
      generatedDraft: {
        subject: "Idempotent subject",
        previewText: "Preview",
        contentJson: { blocks: [{ type: "paragraph", contentHtml: "<p>Body</p>" }] },
      },
    });
    await updateMarketingCampaignFlowDraft(draft!.id, {
      currentStep: "STEP_4",
      fromEmail: "no-reply@bookmyclass.app",
      replyTo: "no-reply@bookmyclass.app",
    });

    // Simulate a partial failure: manually pre-seed a SENT recipient row and put
    // the campaign in SENDING state, then reset it back to DRAFT (admin recovery).
    await prisma.marketingCampaignRecipient.create({
      data: {
        campaignId: draft!.id,
        userId: subscribedUser.id,
        email: subscribedUser.email,
        status: "SENT",
        sentAt: new Date(),
      },
    });
    await prisma.marketingCampaign.update({
      where: { id: draft!.id },
      data: { status: MarketingCampaignStatus.DRAFT },
    });

    // Retry the send — with skipDuplicates the pre-seeded row must not be overwritten.
    await sendMarketingCampaignFlowNow({ campaignId: draft!.id });

    const recipients = await prisma.marketingCampaignRecipient.findMany({
      where: { campaignId: draft!.id },
    });
    // There should be exactly one recipient row (not duplicated).
    expect(recipients).toHaveLength(1);
    // The row must not be downgraded from SENT to PENDING.
    expect(recipients[0]?.status).toBe("SENT");
  });
});
