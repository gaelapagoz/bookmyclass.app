/* @vitest-environment jsdom */
import "./helpers/setup-env";

import "@testing-library/jest-dom/vitest";
import { MarketingAudienceType, MarketingCampaignStatus, MarketingRecipientStatus, Role } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import CampaignPreview from "../../src/components/admin/marketing/CampaignPreview";
import { getMarketingSentCampaignSummaryById } from "../../src/lib/marketing/marketing-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("marketing campaign preview sanitization boundary", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("renders persisted campaign content through summary service and preserves safe snapshot structure", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        firstName: "Admin",
        lastName: "User",
        email: `admin.preview.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const campaign = await prisma.marketingCampaign.create({
      data: {
        name: "Snapshot Campaign",
        status: MarketingCampaignStatus.SENT,
        sentAt: new Date(),
        audienceType: MarketingAudienceType.ALL_USERS,
        manualAudienceJson: { emails: [], userIds: [] },
        subject: "Subject",
        previewText: "Preview",
        fromName: "Studio Team",
        fromEmail: "no-reply@bookmyclass.app",
        replyTo: "no-reply@bookmyclass.app",
        contentJson: {
          blocks: [
            { type: "heading", contentHtml: '<p style="text-align:center;font-size:40px">Heading</p>' },
            { type: "paragraph", contentHtml: "<p>Body</p>" },
            { type: "image", url: "https://example.com/hero.jpg", alt: "Hero image" },
            { type: "divider" },
            { type: "button", labelHtml: "<strong>Book now</strong>", url: "https://example.com/book" },
          ],
        },
        htmlSnapshot: "<p>legacy</p>",
        createdById: admin.id,
      },
    });

    await prisma.marketingCampaignRecipient.create({
      data: {
        campaignId: campaign.id,
        email: `recipient.preview.${Date.now()}@example.test`,
        status: MarketingRecipientStatus.SENT,
        sentAt: new Date(),
      },
    });

    const summary = await getMarketingSentCampaignSummaryById(campaign.id);
    expect(summary).not.toBeNull();

    render(
      <CampaignPreview
        fromName={summary!.fromName}
        subject={summary!.subject}
        previewText={summary!.previewText}
        htmlSnapshot={summary!.htmlSnapshot}
      />,
    );

    expect(screen.getByText("Heading")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Hero image" })).toHaveAttribute("src", "https://example.com/hero.jpg");
    expect(screen.getByRole("link", { name: "Book now" })).toHaveAttribute("href", "https://example.com/book");
    expect(document.querySelector("hr")).not.toBeNull();
  });
});
