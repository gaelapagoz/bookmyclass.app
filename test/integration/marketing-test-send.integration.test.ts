import "./helpers/setup-env";

import { MarketingCampaignStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { createMarketingCampaignFlowDraft, sendMarketingCampaignFlowTestEmail } from "../../src/lib/marketing/marketing-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("marketing flow test email send", () => {
  beforeEach(async () => {
    await resetDb();
    delete process.env.RESEND_API_KEY;
  });

  it("sends test email from persisted draft content without marking campaign sent", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin User",
        firstName: "Admin",
        lastName: "User",
        email: `admin.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const draft = await createMarketingCampaignFlowDraft({
      createdById: admin.id,
      name: "Flow Test Campaign",
      goalPrompt: "",
      generatedDraft: {
        subject: "Hello from blocks",
        previewText: "Preview from blocks",
        contentJson: {
          blocks: [
            { type: "heading", contentHtml: "<p>Heading</p>" },
            { type: "paragraph", contentHtml: "<p>Body</p>" },
            { type: "button", labelHtml: "Book now", url: "https://example.com/book" },
          ],
        },
      },
    });

    await sendMarketingCampaignFlowTestEmail({
      campaignId: draft!.id,
      toEmail: "tester@example.test",
    });

    const persisted = await prisma.marketingCampaign.findUnique({ where: { id: draft!.id } });
    const recipientRows = await prisma.marketingCampaignRecipient.count({ where: { campaignId: draft!.id } });

    expect(persisted?.status).toBe(MarketingCampaignStatus.DRAFT);
    expect(persisted?.sentAt).toBeNull();
    expect(recipientRows).toBe(0);
  });

  it("rejects invalid email and requires valid persisted draft content", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin User",
        firstName: "Admin",
        lastName: "User",
        email: `admin.invalid.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const draft = await createMarketingCampaignFlowDraft({
      createdById: admin.id,
      name: "Flow Test Invalid",
      goalPrompt: "",
      generatedDraft: {
        subject: "Subject",
        previewText: "Preview",
        contentJson: {
          blocks: [{ type: "paragraph", contentHtml: "<p>Body</p>" }],
        },
      },
    });

    await expect(
      sendMarketingCampaignFlowTestEmail({ campaignId: draft!.id, toEmail: "not-an-email" }),
    ).rejects.toThrow("MARKETING_TEST_EMAIL_INVALID");

    await prisma.marketingCampaign.update({
      where: { id: draft!.id },
      data: {
        contentJson: { blocks: [] },
      },
    });

    await expect(
      sendMarketingCampaignFlowTestEmail({ campaignId: draft!.id, toEmail: "tester@example.test" }),
    ).rejects.toThrow("MARKETING_FLOW_TEST_PREVIEW_RENDER_FAILED");
  });
});
