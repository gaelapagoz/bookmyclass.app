import { prisma } from "@/lib/db";
import { renderMarketingEmailHtml, extractTrackingLinks, normalizeMarketingContentJson } from "@/lib/marketing/marketing-renderer";
import { createRecipientTrackingToken, parseRecipientTrackingToken } from "@/lib/marketing/marketing-tracking";
import { sendEmailViaResend } from "@/lib/email/resend-delivery";

export async function sendMarketingEmailViaResend(input: {
  to: string;
  subject: string;
  html: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
}) {
  const from = `${input.fromName} <${input.fromEmail}>`;
  try {
    const result = await sendEmailViaResend({
      context: "marketing-delivery",
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo,
    });
    return { sent: result.sent };
  } catch (error: unknown) {
    const details =
      typeof error === "object" && error !== null && "details" in error
        ? (error as { details?: unknown }).details
        : error instanceof Error
          ? error.message
          : String(error);
    console.error("[marketing-delivery] resend-failed", {
      to: input.to,
      details,
    });
    return { sent: false };
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
