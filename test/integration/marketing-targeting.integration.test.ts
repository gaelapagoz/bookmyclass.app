import "./helpers/setup-env";

import { MarketingSubscriptionStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createMarketingCampaignFlowDraft,
  getMarketingCampaignFlowDraftById,
  resolveMarketingCampaignFlowRecipients,
  updateMarketingCampaignFlowDraft,
} from "../../src/lib/marketing/marketing-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("marketing targeting resolver", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("includes only SUBSCRIBED CLIENT users and excludes UNSUBSCRIBED/NEVER_SUBSCRIBED", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        firstName: "Admin",
        lastName: "User",
        email: `admin.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const [vip, chill] = await Promise.all([
      prisma.marketingSegment.create({
        data: { name: "VIP", slug: `vip-${Date.now()}`, isActive: true },
      }),
      prisma.marketingSegment.create({
        data: { name: "Chill", slug: `chill-${Date.now()}`, isActive: true },
      }),
    ]);

    const [subscribedA, unsubscribed, neverSubscribed, subscribedB] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Subscribed A",
          firstName: "Subscribed",
          lastName: "A",
          email: `sub-a.${Date.now()}@example.test`,
          role: Role.CLIENT,
          marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
        },
      }),
      prisma.user.create({
        data: {
          name: "Unsubscribed",
          firstName: "Unsubscribed",
          lastName: "User",
          email: `unsub.${Date.now()}@example.test`,
          role: Role.CLIENT,
          marketingSubscriptionStatus: MarketingSubscriptionStatus.UNSUBSCRIBED,
        },
      }),
      prisma.user.create({
        data: {
          name: "Never Subscribed",
          firstName: "Never",
          lastName: "User",
          email: `never.${Date.now()}@example.test`,
          role: Role.CLIENT,
          marketingSubscriptionStatus: MarketingSubscriptionStatus.NEVER_SUBSCRIBED,
        },
      }),
      prisma.user.create({
        data: {
          name: "Subscribed B",
          firstName: "Subscribed",
          lastName: "B",
          email: `sub-b.${Date.now()}@example.test`,
          role: Role.CLIENT,
          marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
        },
      }),
    ]);

    await prisma.marketingUserSegment.createMany({
      data: [
        { userId: subscribedA.id, segmentId: vip.id },
        { userId: unsubscribed.id, segmentId: vip.id },
        { userId: neverSubscribed.id, segmentId: chill.id },
        { userId: subscribedB.id, segmentId: chill.id },
      ],
    });

    const draft = await createMarketingCampaignFlowDraft({
      createdById: admin.id,
      name: "Targeting Test",
      goalPrompt: "Test goal",
    });

    expect(draft).not.toBeNull();

    const resolution = await resolveMarketingCampaignFlowRecipients({
      campaignId: draft!.id,
      selectedSegmentIds: [vip.id, chill.id],
      page: 1,
      pageSize: 20,
    });

    expect(resolution.totalRecipients).toBe(2);
    expect(resolution.recipients.map((item) => item.id).sort()).toEqual([subscribedA.id, subscribedB.id].sort());
    expect(resolution.recipients.every((item) => item.marketingSubscriptionStatus === MarketingSubscriptionStatus.SUBSCRIBED)).toBe(true);
  });

  it("uses OR semantics across selected segments and returns stable pagination", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        firstName: "Admin",
        lastName: "User",
        email: `admin.pagination.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const [segA, segB] = await Promise.all([
      prisma.marketingSegment.create({
        data: { name: "Segment A", slug: `seg-a-${Date.now()}`, isActive: true },
      }),
      prisma.marketingSegment.create({
        data: { name: "Segment B", slug: `seg-b-${Date.now()}`, isActive: true },
      }),
    ]);

    const clients = await Promise.all(
      Array.from({ length: 5 }).map((_, index) =>
        prisma.user.create({
          data: {
            name: `Client ${index + 1}`,
            firstName: "Client",
            lastName: `${index + 1}`,
            email: `client-${index + 1}.${Date.now()}@example.test`,
            role: Role.CLIENT,
            marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
          },
        }),
      ),
    );

    await prisma.marketingUserSegment.createMany({
      data: [
        { userId: clients[0]!.id, segmentId: segA.id },
        { userId: clients[1]!.id, segmentId: segA.id },
        { userId: clients[2]!.id, segmentId: segB.id },
        { userId: clients[3]!.id, segmentId: segB.id },
        { userId: clients[4]!.id, segmentId: segA.id },
      ],
    });

    const draft = await createMarketingCampaignFlowDraft({
      createdById: admin.id,
      name: "Pagination Test",
      goalPrompt: "Pagination goal",
    });

    const page1 = await resolveMarketingCampaignFlowRecipients({
      campaignId: draft!.id,
      selectedSegmentIds: [segA.id, segB.id],
      page: 1,
      pageSize: 2,
    });

    const page3 = await resolveMarketingCampaignFlowRecipients({
      campaignId: draft!.id,
      selectedSegmentIds: [segA.id, segB.id],
      page: 3,
      pageSize: 2,
    });

    expect(page1.totalRecipients).toBe(5);
    expect(page1.totalPages).toBe(3);
    expect(page1.recipients).toHaveLength(2);
    expect(page3.page).toBe(3);
    expect(page3.recipients).toHaveLength(1);
  });

  it("persists and rehydrates selected segment IDs in flow draft metadata", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        firstName: "Admin",
        lastName: "User",
        email: `admin.persist.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const [segmentA, segmentB] = await Promise.all([
      prisma.marketingSegment.create({
        data: { name: "Persist A", slug: `persist-a-${Date.now()}`, isActive: true },
      }),
      prisma.marketingSegment.create({
        data: { name: "Persist B", slug: `persist-b-${Date.now()}`, isActive: true },
      }),
    ]);

    const draft = await createMarketingCampaignFlowDraft({
      createdById: admin.id,
      name: "Persist Selection",
      goalPrompt: "Persist flow metadata",
    });

    await updateMarketingCampaignFlowDraft(draft!.id, {
      selectedSegmentIds: [segmentA.id, segmentB.id],
      currentStep: "STEP_3",
    });

    const rehydrated = await getMarketingCampaignFlowDraftById(draft!.id);
    expect(rehydrated?.selectedSegmentIds.sort()).toEqual([segmentA.id, segmentB.id].sort());
  });
});
