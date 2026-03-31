import { SubscriptionStatus } from "@prisma/client";

import { prisma } from "@/lib/db";

export type MarketingAudienceInput = {
  audienceType: "ALL_USERS" | "ACTIVE_USERS" | "PAYING_SUBSCRIBERS" | "MANUAL";
  manualAudience?: {
    emails?: string[];
    userIds?: string[];
  } | null;
};

export type MarketingRecipientTarget = {
  userId: string | null;
  email: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function dedupeTargets(items: MarketingRecipientTarget[]): MarketingRecipientTarget[] {
  const map = new Map<string, MarketingRecipientTarget>();
  for (const item of items) {
    const email = normalizeEmail(item.email);
    if (!email) {
      continue;
    }
    if (!map.has(email)) {
      map.set(email, { ...item, email });
    }
  }
  return [...map.values()];
}

export async function resolveMarketingAudience(input: MarketingAudienceInput): Promise<MarketingRecipientTarget[]> {
  if (input.audienceType === "ALL_USERS") {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true },
      orderBy: { createdAt: "desc" },
    });
    return dedupeTargets(users.map((user) => ({ userId: user.id, email: user.email })));
  }

  if (input.audienceType === "ACTIVE_USERS") {
    const users = await prisma.user.findMany({
      where: { isActive: true, lastLoginAt: { not: null } },
      select: { id: true, email: true },
      orderBy: { lastLoginAt: "desc" },
    });
    return dedupeTargets(users.map((user) => ({ userId: user.id, email: user.email })));
  }

  if (input.audienceType === "PAYING_SUBSCRIBERS") {
    const rows = await prisma.subscriptionContract.findMany({
      where: { status: SubscriptionStatus.ACTIVE },
      select: {
        client: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
    return dedupeTargets(rows.map((row) => ({ userId: row.client.id, email: row.client.email })));
  }

  const manualEmails = input.manualAudience?.emails ?? [];
  const manualUserIds = input.manualAudience?.userIds ?? [];
  const users =
    manualUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: manualUserIds } },
          select: { id: true, email: true },
        })
      : [];

  return dedupeTargets([
    ...manualEmails.map((email) => ({ userId: null, email })),
    ...users.map((user) => ({ userId: user.id, email: user.email })),
  ]);
}

export async function excludeUnsubscribedRecipients(
  recipients: MarketingRecipientTarget[],
): Promise<MarketingRecipientTarget[]> {
  if (recipients.length === 0) {
    return [];
  }

  const emails = recipients.map((item) => normalizeEmail(item.email));
  const unsubscribed = await prisma.marketingUnsubscribe.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  });

  const blocked = new Set(unsubscribed.map((entry) => normalizeEmail(entry.email)));
  return recipients.filter((item) => !blocked.has(normalizeEmail(item.email)));
}
