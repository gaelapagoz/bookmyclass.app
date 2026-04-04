import { MarketingCampaignStatus, MarketingRecipientStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { excludeUnsubscribedRecipients, resolveMarketingAudience } from "@/lib/marketing/marketing-audience";
import { renderMarketingEmailHtml, extractTrackingLinks, normalizeMarketingContentJson } from "@/lib/marketing/marketing-renderer";
import { buildTrackingToken, createRecipientTrackingToken, parseRecipientTrackingToken } from "@/lib/marketing/marketing-tracking";

const SEND_BATCH_SIZE = 50;

export async function sendMarketingEmailViaResend(input: {
  to: string;
  subject: string;
  html: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[marketing-delivery] RESEND_API_KEY missing, skipping provider send", { to: input.to });
    return { sent: true };
  }

  const from = `${input.fromName} <${input.fromEmail}>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("[marketing-delivery] resend-failed", {
      to: input.to,
      status: response.status,
      statusText: response.statusText,
      details,
    });
    return { sent: false };
  }

  return { sent: true };
}

export async function sendMarketingCampaignNow(campaignId: string) {
  const now = new Date();

  const moved = await prisma.marketingCampaign.updateMany({
    where: {
      id: campaignId,
      status: MarketingCampaignStatus.DRAFT,
    },
    data: {
      status: MarketingCampaignStatus.SENDING,
      updatedAt: now,
    },
  });

  if (moved.count < 1) {
    throw new Error("MARKETING_CAMPAIGN_NOT_DRAFT");
  }

  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new Error("MARKETING_CAMPAIGN_NOT_FOUND");
  }

  try {
    const contentJson = normalizeMarketingContentJson(campaign.contentJson);
    const manualAudience = campaign.manualAudienceJson && typeof campaign.manualAudienceJson === "object" && !Array.isArray(campaign.manualAudienceJson)
      ? {
          emails: Array.isArray((campaign.manualAudienceJson as { emails?: unknown }).emails)
            ? (campaign.manualAudienceJson as { emails: unknown[] }).emails.map(String)
            : [],
          userIds: Array.isArray((campaign.manualAudienceJson as { userIds?: unknown }).userIds)
            ? (campaign.manualAudienceJson as { userIds: unknown[] }).userIds.map(String)
            : [],
        }
      : { emails: [], userIds: [] };

    const resolved = await resolveMarketingAudience({
      audienceType: campaign.audienceType,
      manualAudience,
    });
    const recipients = await excludeUnsubscribedRecipients(resolved);

    await prisma.marketingCampaignRecipient.createMany({
      data: recipients.map((recipient) => ({
        campaignId: campaign.id,
        userId: recipient.userId,
        email: recipient.email,
        status: MarketingRecipientStatus.PENDING,
      })),
      skipDuplicates: true,
    });

    const recipientRows = await prisma.marketingCampaignRecipient.findMany({
      where: {
        campaignId: campaign.id,
        status: MarketingRecipientStatus.PENDING,
      },
      orderBy: { createdAt: "asc" },
    });

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

    for (let index = 0; index < recipientRows.length; index += SEND_BATCH_SIZE) {
      const batch = recipientRows.slice(index, index + SEND_BATCH_SIZE);
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
            fromEmail: campaign.fromEmail,
            replyTo: campaign.replyTo,
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
    }

    const snapshotHtml = renderMarketingEmailHtml({
      contentJson,
      links: storedLinks.map((link) => ({ url: link.url, token: link.token })),
      appUrl,
      recipientToken: createRecipientTrackingToken("preview-snapshot"),
    });

    await prisma.marketingCampaign.update({
      where: { id: campaign.id },
      data: {
        status: MarketingCampaignStatus.SENT,
        sentAt: now,
        htmlSnapshot: snapshotHtml,
      },
    });
  } catch (error) {
    await prisma.marketingCampaign.update({
      where: { id: campaignId },
      data: {
        status: MarketingCampaignStatus.DRAFT,
      },
    });
    throw error;
  }
}

export async function sendMarketingCampaignTest(input: {
  campaignId: string;
  toEmail: string;
}) {
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign) {
    throw new Error("MARKETING_CAMPAIGN_NOT_FOUND");
  }

  const contentJson = normalizeMarketingContentJson(campaign.contentJson);
  const links = extractTrackingLinks(contentJson);
  const appUrl = process.env.APP_URL?.trim() || "http://localhost:3000";
  const html = renderMarketingEmailHtml({
    contentJson,
    links,
    appUrl,
    recipientToken: createRecipientTrackingToken("test-email"),
  });

  const result = await sendMarketingEmailViaResend({
    to: input.toEmail.trim().toLowerCase(),
    subject: `[TEST] ${campaign.subject}`,
    html,
    fromName: campaign.fromName,
    fromEmail: campaign.fromEmail,
    replyTo: campaign.replyTo,
  });

  if (!result.sent) {
    throw new Error("MARKETING_TEST_SEND_FAILED");
  }
}

export async function recordMarketingOpenByToken(token: string) {
  const recipientId = parseRecipientTrackingToken(token);
  if (!recipientId) {
    return;
  }

  await prisma.marketingCampaignRecipient.updateMany({
    where: {
      id: recipientId,
      openedAt: null,
    },
    data: {
      openedAt: new Date(),
    },
  });
}

export async function recordMarketingClickByToken(input: {
  linkToken: string;
  recipientToken?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const link = await prisma.marketingCampaignLink.findUnique({
    where: { token: input.linkToken },
    select: { id: true, url: true },
  });

  if (!link) {
    return { redirectUrl: null as string | null };
  }

  const recipientId = input.recipientToken ? parseRecipientTrackingToken(input.recipientToken) : null;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.marketingCampaignLink.update({
      where: { id: link.id },
      data: {
        clickCount: {
          increment: 1,
        },
      },
    });

    await tx.marketingCampaignLinkClick.create({
      data: {
        campaignLinkId: link.id,
        recipientId,
        clickedAt: now,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });

    if (recipientId) {
      await tx.marketingCampaignRecipient.updateMany({
        where: {
          id: recipientId,
          clickedAt: null,
        },
        data: {
          clickedAt: now,
        },
      });
    }
  });

  return { redirectUrl: link.url };
}

export async function unsubscribeMarketingByToken(token: string) {
  const recipientId = parseRecipientTrackingToken(token);
  if (!recipientId) {
    return;
  }

  const recipient = await prisma.marketingCampaignRecipient.findUnique({
    where: { id: recipientId },
    select: { id: true, userId: true, email: true },
  });

  if (!recipient) {
    return;
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.marketingCampaignRecipient.updateMany({
      where: { id: recipient.id, unsubscribedAt: null },
      data: { unsubscribedAt: now },
    });

    await tx.marketingUnsubscribe.upsert({
      where: { email: recipient.email },
      update: { userId: recipient.userId ?? undefined, unsubscribedAt: now },
      create: {
        email: recipient.email,
        userId: recipient.userId,
        unsubscribedAt: now,
      },
    });
  });
}
