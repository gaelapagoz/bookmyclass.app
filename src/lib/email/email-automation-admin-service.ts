import { EmailAutomationEventStatus, EmailTemplateAuditAction, Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { normalizeMarketingContentJson, renderMarketingPreviewHtml } from "@/lib/marketing/marketing-renderer";
import { isDeterministicEmailDeliveryMode, sendEmailViaResend } from "@/lib/email/resend-delivery";
import { extractTemplateTokens, getAllowedTokensForTemplate, getTokenGroupsForTemplate } from "@/lib/email/email-template-token-registry";

export type AutomationTemplateListItem = {
  templateKey: string;
  name: string;
  category: string;
  isActive: boolean;
  subjectTemplate: string;
  pendingCount: number;
  sentCount: number;
  deadLetterCount: number;
};

export type AutomationScaffoldRow = {
  templateKey: string;
  triggerLabel: string;
  category: string;
  subject: string;
  previewText: string;
  whenDescription: string;
  status: "Active" | "Draft" | "Paused";
  marketingStatus: string;
  sentLast30Days: number;
  pendingCount: number;
  deadLetterCount: number;
  openRate: number | null;
  clickRate: number | null;
  unsubscribeRate: number | null;
  exists: boolean;
};

type ExpectedAutomationTemplate = {
  templateKey: string;
  triggerLabel: string;
  category: string;
  whenDescription: string;
  defaultSubject: string;
};

type DefaultTemplateContent = {
  subjectTemplate?: string;
  previewText?: string;
  blocks: Prisma.InputJsonValue[];
};

const LEGACY_AUTOMATION_TEMPLATE_KEYS: Record<string, string> = {
  "purchase.product.confirmation": "payment.purchase.confirmation",
};

const AUTOMATION_TEMPLATE_RECONCILIATION_CONFLICT = "AUTOMATION_TEMPLATE_RECONCILIATION_CONFLICT";

const EXPECTED_AUTOMATION_TEMPLATES: readonly ExpectedAutomationTemplate[] = [
  { templateKey: "booking.welcome", triggerLabel: "Welcome", category: "Lifecycle", whenDescription: "Immediately", defaultSubject: "Welcome to {{website.name}}" },
  { templateKey: "subscription.cancelled", triggerLabel: "Cancel Subscription", category: "Subscription", whenDescription: "Immediately on cancellation", defaultSubject: "Your subscription has been cancelled" },
  { templateKey: "subscription.renewal", triggerLabel: "Renewal Subscription", category: "Subscription", whenDescription: "Immediately on charge success", defaultSubject: "Your subscription has renewed" },
  { templateKey: "booking.class-booked", triggerLabel: "Booked Class", category: "Booking", whenDescription: "Immediately", defaultSubject: "You're booked for {{booking.classTitle}}" },
  { templateKey: "booking.class-cancelled", triggerLabel: "Class Cancelled", category: "Booking", whenDescription: "Immediately on session cancel", defaultSubject: "Class cancelled: {{booking.classTitle}}" },
  { templateKey: "booking.class-reminder", triggerLabel: "Class Reminder", category: "Booking", whenDescription: "2x cancellation policy before start", defaultSubject: "Reminder: {{booking.classTitle}}" },
  { templateKey: "waitlist.on-list", triggerLabel: "On Waiting List", category: "Waitlist", whenDescription: "Immediately", defaultSubject: "You're on the waitlist for {{waitlist.classTitle}}" },
  { templateKey: "waitlist.promoted", triggerLabel: "Promoted Waiting List", category: "Waitlist", whenDescription: "Immediately on promotion", defaultSubject: "Spot available: {{waitlist.classTitle}}" },
  { templateKey: "waitlist.not-promoted", triggerLabel: "Not Promoted Waiting List", category: "Waitlist", whenDescription: "At class start", defaultSubject: "Waitlist update for {{waitlist.classTitle}}" },
  { templateKey: "auth.verify-email", triggerLabel: "Auth Verification Email", category: "Auth", whenDescription: "Immediately after signup", defaultSubject: "Verify your email" },
  { templateKey: "auth.password-reset", triggerLabel: "Auth Password Reset Email", category: "Auth", whenDescription: "On password reset request", defaultSubject: "Reset your password" },
  { templateKey: "auth.verify-email-change", triggerLabel: "Auth Email Change Verification", category: "Auth", whenDescription: "On email change request", defaultSubject: "Confirm your new email" },
  { templateKey: "payment.purchase.confirmation", triggerLabel: "Payment Purchase Confirmation", category: "Payment", whenDescription: "Immediately on payment success", defaultSubject: "Payment purchase confirmation" },
  { templateKey: "store.purchase.confirmation", triggerLabel: "Store Purchase Confirmation", category: "Store", whenDescription: "Immediately on checkout success", defaultSubject: "Store purchase confirmation" },
  { templateKey: "gift-card.issuance", triggerLabel: "Gift Card Issuance", category: "Gift card", whenDescription: "Immediately after gift card purchase", defaultSubject: "Your gift card is ready" },
] as const;

function getCanonicalAutomationTemplateKey(templateKey: string): string {
  return LEGACY_AUTOMATION_TEMPLATE_KEYS[templateKey] ?? templateKey;
}

function getTemplateLookupKeys(templateKey: string): string[] {
  const canonicalTemplateKey = getCanonicalAutomationTemplateKey(templateKey);
  const lookupKeys = [canonicalTemplateKey];
  for (const [legacyTemplateKey, mappedCanonicalTemplateKey] of Object.entries(LEGACY_AUTOMATION_TEMPLATE_KEYS)) {
    if (mappedCanonicalTemplateKey === canonicalTemplateKey) {
      lookupKeys.push(legacyTemplateKey);
    }
  }
  return [...new Set(lookupKeys)];
}

function getDefaultTemplateContent(templateKey: string, triggerLabel: string): DefaultTemplateContent {
  const generic = (body: string): DefaultTemplateContent => ({
    blocks: [
      { type: "heading", contentHtml: `<p>${triggerLabel}</p>` },
      { type: "paragraph", contentHtml: `<p>${body}</p>` },
    ],
  });

  switch (templateKey) {
    case "auth.verify-email":
      return {
        subjectTemplate: "Verify your email",
        blocks: [
          { type: "paragraph", contentHtml: "<p>Hello {{contact.fullName}},</p>" },
          { type: "paragraph", contentHtml: "<p>Please verify your email to continue.</p>" },
          { type: "button", labelHtml: "Verify email", url: "{{verificationUrl}}" },
          { type: "paragraph", contentHtml: "<p>This link expires in 24 hours.</p>" },
        ],
      };
    case "auth.verify-email-change":
      return {
        subjectTemplate: "Confirm your new email",
        blocks: [
          { type: "paragraph", contentHtml: "<p>Hello {{contact.fullName}},</p>" },
          { type: "paragraph", contentHtml: "<p>Please confirm your new email address.</p>" },
          { type: "button", labelHtml: "Confirm new email", url: "{{emailChangeVerificationUrl}}" },
          { type: "paragraph", contentHtml: "<p>This link expires in 24 hours.</p>" },
        ],
      };
    case "auth.password-reset":
      return {
        subjectTemplate: "Reset your password",
        blocks: [
          { type: "paragraph", contentHtml: "<p>Hello {{contact.fullName}},</p>" },
          { type: "paragraph", contentHtml: "<p>We received a request to reset your password.</p>" },
          { type: "button", labelHtml: "Reset your password", url: "{{resetPasswordUrl}}" },
          { type: "paragraph", contentHtml: "<p>This link expires soon and can only be used once.</p>" },
        ],
      };
    case "payment.purchase.confirmation":
      return {
        subjectTemplate: "Your Studio Purchase Confirmation",
        blocks: [
          { type: "paragraph", contentHtml: "<p>Purchase Confirmed</p>" },
          { type: "paragraph", contentHtml: "<p>Hi {{contact.fullName}},</p>" },
          { type: "paragraph", contentHtml: "<p>Your purchase is confirmed. Your credits and entitlements are now active in your account.</p>" },
          { type: "paragraph", contentHtml: "<p>Order: {{order.number}}</p>" },
          { type: "paragraph", contentHtml: "<p>Total: {{order.total}}</p>" },
          { type: "paragraph", contentHtml: "<p>View your credits and active plans in Dashboard &gt; Membership &amp; Credits.</p>" },
        ],
      };
    case "store.purchase.confirmation":
      return {
        subjectTemplate: "Your Studio Purchase Confirmation",
        blocks: [
          { type: "paragraph", contentHtml: "<p>Purchase Confirmed</p>" },
          { type: "paragraph", contentHtml: "<p>Hi {{contact.fullName}},</p>" },
          { type: "paragraph", contentHtml: "<p>Thank you for your purchase! Your order is confirmed.</p>" },
          { type: "paragraph", contentHtml: "<p>Order: {{order.number}}</p>" },
          { type: "paragraph", contentHtml: "<p>Pickup at studio. Please bring this confirmation when you collect your order.</p>" },
        ],
      };
    case "gift-card.issuance":
      return {
        subjectTemplate: "Your gift card code",
        blocks: [
          { type: "heading", contentHtml: "<p>Your Gift Card is Ready</p>", textColor: "#7a2f2f" },
          { type: "paragraph", contentHtml: "<p>Hi {{giftCard.recipientName}},</p>" },
          { type: "paragraph", contentHtml: "<p>Thank you for your purchase. Your {{giftCard.amount}} gift card code is below.</p>" },
          { type: "paragraph", contentHtml: "<p><strong>{{giftCard.code}}</strong></p>" },
          { type: "paragraph", contentHtml: "<p>To redeem this code, sign in to your account and go to Dashboard → Wallet.</p>" },
          { type: "paragraph", contentHtml: "<p>Keep this code safe. It can only be used once.</p>" },
        ],
      };
    case "booking.welcome":
      return {
        blocks: [
          { type: "paragraph", contentHtml: "<p>Hello {{contact.fullName}},</p>" },
          { type: "paragraph", contentHtml: "<p>Welcome to {{website.name}}. Your account is ready.</p>" },
          { type: "button", labelHtml: "Browse classes", url: "{{website.url}}" },
        ],
      };
    case "booking.class-booked":
      return generic("You're booked for {{booking.classTitle}} on {{booking.startAt}}.");
    case "booking.class-cancelled":
      return generic("Your class {{booking.classTitle}} has been cancelled.");
    case "booking.class-reminder":
      return generic("Reminder: {{booking.classTitle}} starts at {{booking.startAt}}.");
    case "waitlist.on-list":
      return generic("You're on the waitlist for {{waitlist.classTitle}}.");
    case "waitlist.promoted":
      return generic("Good news. A spot opened for {{waitlist.classTitle}}.");
    case "waitlist.not-promoted":
      return generic("No spot opened for {{waitlist.classTitle}} this time.");
    case "subscription.cancelled":
      return generic("Your subscription has been cancelled.");
    case "subscription.renewal":
      return generic("Your {{subscription.planName}} subscription was renewed.");
    default:
      return generic("Template ready.");
  }
}

function isBootstrapPlaceholderBody(bodyTemplateJson: unknown): boolean {
  if (!bodyTemplateJson || typeof bodyTemplateJson !== "object") return true;
  try {
    const normalized = normalizeMarketingContentJson(bodyTemplateJson);
    if (normalized.blocks.length === 0) return true;
    const serialized = JSON.stringify(normalized.blocks).toLowerCase();
    if (serialized.includes("not configured yet")) return true;
    if (normalized.blocks.length <= 2) {
      const textContent = normalized.blocks
        .map((block) => {
          if (block.type === "heading" || block.type === "paragraph") return block.contentHtml ?? "";
          if (block.type === "button") return `${block.labelHtml ?? ""}${block.url ?? ""}`;
          return "";
        })
        .join(" ")
        .toLowerCase();
      if (textContent.includes("template ready")) return true;
    }
  } catch {
    return true;
  }
  return false;
}

function getExpectedTemplateDefinition(templateKey: string): ExpectedAutomationTemplate | null {
  const canonicalTemplateKey = getCanonicalAutomationTemplateKey(templateKey);
  return EXPECTED_AUTOMATION_TEMPLATES.find((item) => item.templateKey === canonicalTemplateKey) ?? null;
}

function buildDefaultTemplateJson(templateKey: string, triggerLabel: string): {
  subjectTemplate: string;
  bodyTemplateJson: Prisma.InputJsonValue;
} {
  const defaultContent = getDefaultTemplateContent(templateKey, triggerLabel);
  return {
    subjectTemplate: defaultContent.subjectTemplate ?? getExpectedTemplateDefinition(templateKey)?.defaultSubject ?? "Template ready.",
    bodyTemplateJson: {
      previewText: defaultContent.previewText ?? "",
      blocks: defaultContent.blocks,
    } as Prisma.InputJsonValue,
  };
}

function toPrismaInputJsonValue(value: Prisma.JsonValue): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function matchesDefaultTemplateContent(input: {
  templateKey: string;
  subjectTemplate: string;
  bodyTemplateJson: unknown;
}): boolean {
  const expected = getExpectedTemplateDefinition(input.templateKey);
  if (!expected) return false;
  const defaults = buildDefaultTemplateJson(expected.templateKey, expected.triggerLabel);

  try {
    const normalizedActual = normalizeMarketingContentJson(input.bodyTemplateJson);
    const normalizedDefault = normalizeMarketingContentJson(defaults.bodyTemplateJson);
    return (
      input.subjectTemplate.trim() === defaults.subjectTemplate.trim() &&
      JSON.stringify(normalizedActual) === JSON.stringify(normalizedDefault)
    );
  } catch {
    return false;
  }
}

async function reconcileLegacyAutomationTemplateKey(templateKey: string): Promise<void> {
  const canonicalTemplateKey = getCanonicalAutomationTemplateKey(templateKey);
  const legacyTemplateKey = Object.entries(LEGACY_AUTOMATION_TEMPLATE_KEYS).find(([, canonical]) => canonical === canonicalTemplateKey)?.[0];
  if (!legacyTemplateKey) return;

  const expected = getExpectedTemplateDefinition(canonicalTemplateKey);
  if (!expected) return;

  await prisma.$transaction(async (tx) => {
    const [canonical, legacy] = await Promise.all([
      tx.emailTemplate.findUnique({
        where: { templateKey: canonicalTemplateKey },
        select: {
          id: true,
          templateKey: true,
          name: true,
          category: true,
          description: true,
          subjectTemplate: true,
          bodyTemplateJson: true,
          isActive: true,
        },
      }),
      tx.emailTemplate.findUnique({
        where: { templateKey: legacyTemplateKey },
        select: {
          id: true,
          templateKey: true,
          name: true,
          category: true,
          description: true,
          subjectTemplate: true,
          bodyTemplateJson: true,
          isActive: true,
        },
      }),
    ]);

    if (!legacy) return;

    const legacyUsesDefaultContent = matchesDefaultTemplateContent({
      templateKey: legacy.templateKey,
      subjectTemplate: legacy.subjectTemplate,
      bodyTemplateJson: legacy.bodyTemplateJson,
    });
    const canonicalUsesDefaultContent =
      canonical == null
        ? true
        : matchesDefaultTemplateContent({
            templateKey: canonical.templateKey,
            subjectTemplate: canonical.subjectTemplate,
            bodyTemplateJson: canonical.bodyTemplateJson,
          });
    const canonicalDefaults = buildDefaultTemplateJson(canonicalTemplateKey, expected.triggerLabel);

    if (!canonical) {
      const migrated = await tx.emailTemplate.update({
        where: { id: legacy.id },
        data: {
          templateKey: canonicalTemplateKey,
          name: expected.triggerLabel,
          category: expected.category,
          description: expected.whenDescription,
          subjectTemplate: legacyUsesDefaultContent ? canonicalDefaults.subjectTemplate : legacy.subjectTemplate,
          bodyTemplateJson: legacyUsesDefaultContent
            ? canonicalDefaults.bodyTemplateJson
            : toPrismaInputJsonValue(legacy.bodyTemplateJson),
        },
      });
      await tx.emailTemplateAuditLog.create({
        data: {
          templateId: migrated.id,
          action: EmailTemplateAuditAction.UPDATED,
          beforeJson: {
            reconciliation: {
              legacyTemplateKey,
              canonicalTemplateKey,
              strategy: "rename-legacy-to-canonical",
            },
            legacyTemplate: {
              subjectTemplate: legacy.subjectTemplate,
              bodyTemplateJson: legacy.bodyTemplateJson,
              isActive: legacy.isActive,
            },
          } as Prisma.InputJsonValue,
          afterJson: {
            reconciliation: {
              legacyTemplateKey,
              canonicalTemplateKey,
              strategy: "rename-legacy-to-canonical",
            },
            canonicalTemplate: {
              subjectTemplate: migrated.subjectTemplate,
              bodyTemplateJson: migrated.bodyTemplateJson,
              isActive: migrated.isActive,
            },
          } as Prisma.InputJsonValue,
        },
      });
      return;
    }

    if (!legacyUsesDefaultContent && !canonicalUsesDefaultContent) {
      throw new Error(AUTOMATION_TEMPLATE_RECONCILIATION_CONFLICT);
    }

    const shouldPromoteLegacyContent = !legacyUsesDefaultContent && canonicalUsesDefaultContent;
    const canonicalBefore = {
      subjectTemplate: canonical.subjectTemplate,
      bodyTemplateJson: canonical.bodyTemplateJson,
      isActive: canonical.isActive,
    };
    const mergedCanonical = shouldPromoteLegacyContent
      ? await tx.emailTemplate.update({
          where: { id: canonical.id },
          data: {
            name: expected.triggerLabel,
            category: expected.category,
            description: expected.whenDescription,
            subjectTemplate: legacy.subjectTemplate,
            bodyTemplateJson: toPrismaInputJsonValue(legacy.bodyTemplateJson),
            isActive: legacy.isActive,
          },
        })
      : await tx.emailTemplate.update({
          where: { id: canonical.id },
          data: {
            name: expected.triggerLabel,
            category: expected.category,
            description: expected.whenDescription,
          },
        });

    await tx.emailAutomationEvent.updateMany({
      where: { templateId: legacy.id },
      data: { templateId: canonical.id },
    });
    await tx.emailTemplateAuditLog.updateMany({
      where: { templateId: legacy.id },
      data: { templateId: canonical.id },
    });
    await tx.emailTemplateAuditLog.create({
      data: {
        templateId: canonical.id,
        action: EmailTemplateAuditAction.UPDATED,
        beforeJson: {
          reconciliation: {
            legacyTemplateKey,
            canonicalTemplateKey,
            strategy: shouldPromoteLegacyContent ? "promote-legacy-content" : "preserve-canonical-content",
          },
          canonicalTemplate: canonicalBefore,
          legacyTemplate: {
            subjectTemplate: legacy.subjectTemplate,
            bodyTemplateJson: legacy.bodyTemplateJson,
            isActive: legacy.isActive,
          },
        } as Prisma.InputJsonValue,
        afterJson: {
          reconciliation: {
            legacyTemplateKey,
            canonicalTemplateKey,
            strategy: shouldPromoteLegacyContent ? "promote-legacy-content" : "preserve-canonical-content",
            deletedLegacyTemplateKey: legacyTemplateKey,
          },
          canonicalTemplate: {
            subjectTemplate: mergedCanonical.subjectTemplate,
            bodyTemplateJson: mergedCanonical.bodyTemplateJson,
            isActive: mergedCanonical.isActive,
          },
        } as Prisma.InputJsonValue,
      },
    });
    await tx.emailTemplate.delete({
      where: { id: legacy.id },
    });
  });
}

async function findAutomationTemplateRecord<T extends Prisma.EmailTemplateFindUniqueArgs["select"]>(input: {
  templateKey: string;
  select: T;
}): Promise<Prisma.EmailTemplateGetPayload<{ select: NonNullable<T> }> | null> {
  const canonicalTemplateKey = getCanonicalAutomationTemplateKey(input.templateKey);
  const canonicalTemplate = await prisma.emailTemplate.findUnique({
    where: { templateKey: canonicalTemplateKey },
    select: input.select,
  });
  if (canonicalTemplate) {
    return canonicalTemplate as unknown as Prisma.EmailTemplateGetPayload<{ select: NonNullable<T> }>;
  }

  for (const lookupKey of getTemplateLookupKeys(input.templateKey)) {
    if (lookupKey === canonicalTemplateKey) continue;
    const template = await prisma.emailTemplate.findUnique({
      where: { templateKey: lookupKey },
      select: input.select,
    });
    if (template) {
      return template as unknown as Prisma.EmailTemplateGetPayload<{ select: NonNullable<T> }>;
    }
  }

  return null;
}

export type AutomationTemplateDetail = {
  id: string;
  templateKey: string;
  name: string;
  category: string;
  isActive: boolean;
  subjectTemplate: string;
  bodyTemplateJson: unknown;
  contentSchemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
  totalEvents: number;
  pendingCount: number;
  sentCount: number;
  deadLetterCount: number;
  lastHeartbeatAt: Date | null;
};

export type AutomationDeadLetterItem = {
  id: string;
  recipientEmail: string;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  deadLetteredAt: Date | null;
  createdAt: Date;
};

export type AutomationDeadLetterPage = {
  items: AutomationDeadLetterItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type AutomationAuditLogItem = {
  id: string;
  action: EmailTemplateAuditAction;
  actorEmail: string | null;
  actorName: string | null;
  createdAt: Date;
};

export type AutomationAuditLogPage = {
  items: AutomationAuditLogItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export async function getAutomationTemplateList(): Promise<AutomationTemplateListItem[]> {
  const templates = await prisma.emailTemplate.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, templateKey: true, name: true, category: true, isActive: true, subjectTemplate: true },
  });

  if (templates.length === 0) {
    return [];
  }

  const templateIds = templates.map((t) => t.id);
  const eventCounts = await prisma.emailAutomationEvent.groupBy({
    by: ["templateId", "status"],
    _count: { id: true },
    where: { templateId: { in: templateIds } },
  });

  const countMap = new Map<string, { pending: number; sent: number; deadLetter: number }>();
  for (const row of eventCounts) {
    if (!countMap.has(row.templateId)) {
      countMap.set(row.templateId, { pending: 0, sent: 0, deadLetter: 0 });
    }
    const entry = countMap.get(row.templateId)!;
    if (row.status === EmailAutomationEventStatus.PENDING || row.status === EmailAutomationEventStatus.LEASED) {
      entry.pending += row._count.id;
    } else if (row.status === EmailAutomationEventStatus.SENT) {
      entry.sent += row._count.id;
    } else if (row.status === EmailAutomationEventStatus.DEAD_LETTER) {
      entry.deadLetter += row._count.id;
    }
  }

  return templates.map((template) => {
    const counts = countMap.get(template.id) ?? { pending: 0, sent: 0, deadLetter: 0 };
    return {
      templateKey: template.templateKey,
      name: template.name,
      category: template.category,
      isActive: template.isActive,
      subjectTemplate: template.subjectTemplate,
      pendingCount: counts.pending,
      sentCount: counts.sent,
      deadLetterCount: counts.deadLetter,
    };
  });
}

function summarizePreviewText(bodyTemplateJson: unknown): string {
  try {
    const normalized = normalizeMarketingContentJson(bodyTemplateJson);
    if (normalized.previewText?.trim()) {
      return normalized.previewText.trim();
    }
    const paragraph = normalized.blocks.find((block) => block.type === "paragraph");
    if (!paragraph || paragraph.type !== "paragraph") return "";
    return (paragraph.contentHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  } catch {
    return "";
  }
}

export function buildAutomationScaffoldRows(input: {
  templates: Array<{
    id: string;
    templateKey: string;
    subjectTemplate: string;
    bodyTemplateJson: unknown;
    isActive: boolean;
  }>;
  eventCounts: Array<{ templateId: string; status: EmailAutomationEventStatus; count: number }>;
  sentLast30: Array<{ templateId: string; count: number }>;
}): AutomationScaffoldRow[] {
  const templateByKey = new Map<string, (typeof input.templates)[number]>();
  for (const row of input.templates) {
    const canonicalTemplateKey = getCanonicalAutomationTemplateKey(row.templateKey);
    const existing = templateByKey.get(canonicalTemplateKey);
    if (!existing) {
      templateByKey.set(canonicalTemplateKey, { ...row, templateKey: canonicalTemplateKey });
      continue;
    }
    const rowIsCanonical = row.templateKey === canonicalTemplateKey;
    const existingIsCanonical = existing.templateKey === canonicalTemplateKey;
    if (rowIsCanonical && !existingIsCanonical) {
      templateByKey.set(canonicalTemplateKey, { ...row, templateKey: canonicalTemplateKey });
    }
  }
  const countsByTemplate = new Map<string, { pending: number; deadLetter: number }>();
  for (const row of input.eventCounts) {
    const existing = countsByTemplate.get(row.templateId) ?? { pending: 0, deadLetter: 0 };
    if (row.status === EmailAutomationEventStatus.PENDING || row.status === EmailAutomationEventStatus.LEASED) {
      existing.pending += row.count;
    }
    if (row.status === EmailAutomationEventStatus.DEAD_LETTER) {
      existing.deadLetter += row.count;
    }
    countsByTemplate.set(row.templateId, existing);
  }
  const sentByTemplate = new Map(input.sentLast30.map((row) => [row.templateId, row.count]));

  return EXPECTED_AUTOMATION_TEMPLATES.map((expected) => {
    const template = templateByKey.get(expected.templateKey);
    if (!template) {
      return {
        templateKey: expected.templateKey,
        triggerLabel: expected.triggerLabel,
        category: expected.category,
        subject: "Not configured",
        previewText: "",
        whenDescription: expected.whenDescription,
        status: "Draft",
        marketingStatus: "Never sent",
        sentLast30Days: 0,
        pendingCount: 0,
        deadLetterCount: 0,
        openRate: null,
        clickRate: null,
        unsubscribeRate: null,
        exists: false,
      };
    }

    const counts = countsByTemplate.get(template.id) ?? { pending: 0, deadLetter: 0 };
    return {
      templateKey: template.templateKey,
      triggerLabel: expected.triggerLabel,
      category: expected.category,
      subject: template.subjectTemplate,
      previewText: summarizePreviewText(template.bodyTemplateJson),
      whenDescription: expected.whenDescription,
      status: template.isActive ? "Active" : "Paused",
      marketingStatus: "Never sent",
      sentLast30Days: sentByTemplate.get(template.id) ?? 0,
      pendingCount: counts.pending,
      deadLetterCount: counts.deadLetter,
      openRate: null,
      clickRate: null,
      unsubscribeRate: null,
      exists: true,
    };
  });
}

export async function getAutomationScaffoldRows(): Promise<AutomationScaffoldRow[]> {
  const templates = await prisma.emailTemplate.findMany({
    select: {
      id: true,
      templateKey: true,
      name: true,
      category: true,
      subjectTemplate: true,
      bodyTemplateJson: true,
      isActive: true,
    },
  });
  const templateIds = templates.map((item) => item.id);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const [eventCounts, sentLast30] =
    templateIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.emailAutomationEvent.groupBy({
            by: ["templateId", "status"],
            _count: { id: true },
            where: { templateId: { in: templateIds } },
          }),
          prisma.emailAutomationEvent.groupBy({
            by: ["templateId"],
            _count: { id: true },
            where: {
              templateId: { in: templateIds },
              status: EmailAutomationEventStatus.SENT,
              sentAt: { gte: thirtyDaysAgo },
            },
          }),
        ]);

  return buildAutomationScaffoldRows({
    templates,
    eventCounts: eventCounts.map((row) => ({ templateId: row.templateId, status: row.status, count: row._count.id })),
    sentLast30: sentLast30.map((row) => ({ templateId: row.templateId, count: row._count.id })),
  });
}

export async function ensureExpectedAutomationTemplateExists(templateKey: string): Promise<void> {
  const canonicalTemplateKey = getCanonicalAutomationTemplateKey(templateKey);
  await reconcileLegacyAutomationTemplateKey(canonicalTemplateKey);

  const expected = getExpectedTemplateDefinition(canonicalTemplateKey);
  if (!expected) return;
  const existing = await prisma.emailTemplate.findUnique({
    where: { templateKey: expected.templateKey },
    select: { id: true, bodyTemplateJson: true, subjectTemplate: true },
  });
  const defaults = buildDefaultTemplateJson(expected.templateKey, expected.triggerLabel);
  const defaultSubject = defaults.subjectTemplate;
  const defaultBody = defaults.bodyTemplateJson;

  if (existing) {
    if (!isBootstrapPlaceholderBody(existing.bodyTemplateJson)) {
      return;
    }
    await prisma.emailTemplate.update({
      where: { id: existing.id },
      data: {
        name: expected.triggerLabel,
        category: expected.category,
        description: expected.whenDescription,
        subjectTemplate: existing.subjectTemplate?.trim() ? existing.subjectTemplate : defaultSubject,
        contentSchemaVersion: 1,
        bodyTemplateJson: defaultBody,
      },
    });
    return;
  }

  await prisma.emailTemplate.create({
    data: {
      templateKey: expected.templateKey,
      name: expected.triggerLabel,
      category: expected.category,
      description: expected.whenDescription,
      subjectTemplate: defaultSubject,
      contentSchemaVersion: 1,
      isActive: false,
      bodyTemplateJson: defaultBody,
    },
  });
}

export async function ensureAllExpectedAutomationTemplatesExist(): Promise<void> {
  await Promise.all(EXPECTED_AUTOMATION_TEMPLATES.map((template) => ensureExpectedAutomationTemplateExists(template.templateKey)));
}

export async function ensureAllExpectedAutomationTemplatesHaveStatus(isActive: boolean): Promise<void> {
  await ensureAllExpectedAutomationTemplatesExist();
  await prisma.emailTemplate.updateMany({
    where: {
      templateKey: {
        in: EXPECTED_AUTOMATION_TEMPLATES.map((template) => template.templateKey),
      },
    },
    data: {
      isActive,
    },
  });
}

const setAutomationTemplateStatusSchema = z.object({
  templateKey: z.string().trim().min(1),
  isActive: z.boolean(),
  actorId: z.string().trim().min(1).optional(),
});

export async function setAutomationTemplateStatus(input: z.input<typeof setAutomationTemplateStatusSchema>): Promise<void> {
  const parsed = setAutomationTemplateStatusSchema.parse(input);
  const templateKey = getCanonicalAutomationTemplateKey(parsed.templateKey);
  if (parsed.templateKey !== templateKey) {
    await reconcileLegacyAutomationTemplateKey(templateKey);
  }
  const template = await findAutomationTemplateRecord({
    templateKey,
    select: { id: true, isActive: true },
  });
  if (!template) {
    throw new Error("AUTOMATION_TEMPLATE_NOT_FOUND");
  }
  if (template.isActive === parsed.isActive) {
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.emailTemplate.update({
      where: { id: template.id },
      data: {
        isActive: parsed.isActive,
        updatedById: parsed.actorId ?? null,
      },
    });
    await tx.emailTemplateAuditLog.create({
      data: {
        templateId: template.id,
        action: EmailTemplateAuditAction.UPDATED,
        actorId: parsed.actorId ?? null,
        beforeJson: { isActive: template.isActive } as Prisma.InputJsonValue,
        afterJson: { isActive: parsed.isActive } as Prisma.InputJsonValue,
      },
    });
  });
}

const bulkSetAutomationTemplateStatusSchema = z.object({
  templateKeys: z.array(z.string().trim().min(1)).min(1),
  isActive: z.boolean(),
  actorId: z.string().trim().min(1).optional(),
});

export async function bulkSetAutomationTemplateStatus(input: z.input<typeof bulkSetAutomationTemplateStatusSchema>): Promise<number> {
  const parsed = bulkSetAutomationTemplateStatusSchema.parse(input);
  const templateKeys = [...new Set(parsed.templateKeys.map((templateKey) => getCanonicalAutomationTemplateKey(templateKey)))];
  const includesLegacyAlias = parsed.templateKeys.some((templateKey) => getCanonicalAutomationTemplateKey(templateKey) !== templateKey);
  if (includesLegacyAlias) {
    await Promise.all(templateKeys.map((templateKey) => reconcileLegacyAutomationTemplateKey(templateKey)));
  }
  const resolvedTemplates = await Promise.all(
    templateKeys.map((templateKey) =>
      findAutomationTemplateRecord({
        templateKey,
        select: { id: true, templateKey: true, isActive: true },
      }),
    ),
  );
  const templates = resolvedTemplates.filter((template): template is NonNullable<typeof template> => template != null);
  if (templates.length === 0) return 0;
  const toUpdate = templates.filter((template) => template.isActive !== parsed.isActive);
  if (toUpdate.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    await tx.emailTemplate.updateMany({
      where: { id: { in: toUpdate.map((row) => row.id) } },
      data: { isActive: parsed.isActive, updatedById: parsed.actorId ?? null },
    });
    await tx.emailTemplateAuditLog.createMany({
      data: toUpdate.map((template) => ({
        templateId: template.id,
        action: EmailTemplateAuditAction.UPDATED,
        actorId: parsed.actorId ?? null,
        beforeJson: { isActive: template.isActive } as Prisma.InputJsonValue,
        afterJson: { isActive: parsed.isActive } as Prisma.InputJsonValue,
      })),
    });
  });
  return toUpdate.length;
}

export async function getAutomationTemplateDetail(templateKey: string): Promise<AutomationTemplateDetail | null> {
  const template = await findAutomationTemplateRecord({
    templateKey,
    select: {
      id: true,
      templateKey: true,
      name: true,
      category: true,
      isActive: true,
      subjectTemplate: true,
      bodyTemplateJson: true,
      contentSchemaVersion: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!template) {
    return null;
  }

  const [eventCounts, heartbeat] = await Promise.all([
    prisma.emailAutomationEvent.groupBy({
      by: ["status"],
      _count: { id: true },
      where: { templateId: template.id },
    }),
    prisma.emailDispatcherHeartbeat.findFirst({
      orderBy: { lastHeartbeatAt: "desc" },
      select: { lastHeartbeatAt: true },
    }),
  ]);

  let totalEvents = 0;
  let pendingCount = 0;
  let sentCount = 0;
  let deadLetterCount = 0;

  for (const row of eventCounts) {
    totalEvents += row._count.id;
    if (row.status === EmailAutomationEventStatus.PENDING || row.status === EmailAutomationEventStatus.LEASED) {
      pendingCount += row._count.id;
    } else if (row.status === EmailAutomationEventStatus.SENT) {
      sentCount += row._count.id;
    } else if (row.status === EmailAutomationEventStatus.DEAD_LETTER) {
      deadLetterCount += row._count.id;
    }
  }

  return {
    ...template,
    totalEvents,
    pendingCount,
    sentCount,
    deadLetterCount,
    lastHeartbeatAt: heartbeat?.lastHeartbeatAt ?? null,
  };
}

export async function getAutomationDeadLetterPage(
  templateKey: string,
  page: number,
  pageSize: number,
): Promise<AutomationDeadLetterPage> {
  const template = await findAutomationTemplateRecord({
    templateKey,
    select: { id: true },
  });

  if (!template) {
    return { items: [], page, pageSize, totalItems: 0, totalPages: 0 };
  }

  const where = { templateId: template.id, status: EmailAutomationEventStatus.DEAD_LETTER };
  const [totalItems, rows] = await Promise.all([
    prisma.emailAutomationEvent.count({ where }),
    prisma.emailAutomationEvent.findMany({
      where,
      orderBy: { deadLetteredAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        recipientEmail: true,
        idempotencyKey: true,
        attempts: true,
        maxAttempts: true,
        lastError: true,
        deadLetteredAt: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    items: rows,
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

export async function getAutomationAuditLogPage(
  templateKey: string,
  page: number,
  pageSize: number,
): Promise<AutomationAuditLogPage> {
  const template = await findAutomationTemplateRecord({
    templateKey,
    select: { id: true },
  });

  if (!template) {
    return { items: [], page, pageSize, totalItems: 0, totalPages: 0 };
  }

  const where = { templateId: template.id };
  const [totalItems, rows] = await Promise.all([
    prisma.emailTemplateAuditLog.count({ where }),
    prisma.emailTemplateAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        createdAt: true,
        actor: { select: { email: true, name: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorEmail: row.actor?.email ?? null,
      actorName: row.actor?.name ?? null,
      createdAt: row.createdAt,
    })),
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

const replaySchema = z.object({
  eventId: z.string().trim().min(1),
  templateKey: z.string().trim().min(1),
});

export async function replayAutomationDeadLetterEvent(
  input: z.input<typeof replaySchema>,
): Promise<{ replayed: boolean }> {
  const parsed = replaySchema.parse(input);
  const templateKey = getCanonicalAutomationTemplateKey(parsed.templateKey);
  if (parsed.templateKey !== templateKey) {
    await reconcileLegacyAutomationTemplateKey(templateKey);
  }
  const template = await findAutomationTemplateRecord({
    templateKey,
    select: { id: true },
  });

  if (!template) {
    return { replayed: false };
  }

  const now = new Date();
  const result = await prisma.emailAutomationEvent.updateMany({
    where: {
      id: parsed.eventId,
      templateId: template.id,
      status: EmailAutomationEventStatus.DEAD_LETTER,
    },
    data: {
      status: EmailAutomationEventStatus.PENDING,
      attempts: 0,
      availableAt: now,
      leaseOwner: null,
      leasedAt: null,
      leaseExpiresAt: null,
      deadLetteredAt: null,
      lastError: null,
    },
  });

  return { replayed: result.count === 1 };
}

const testSendSchema = z.object({
  templateKey: z.string().trim().min(1),
  toEmail: z.string().trim().email(),
});

function resolveTestFromAddress(): string {
  const configured = process.env.EMAIL_FROM?.trim();
  if (configured) {
    return configured;
  }
  if (isDeterministicEmailDeliveryMode()) {
    return "Book My Class Test <no-reply@test.local>";
  }
  throw new Error("Missing EMAIL_FROM.");
}

const updateTemplateSchema = z.object({
  templateKey: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  subjectTemplate: z.string().trim().min(1).max(500),
  bodyTemplateJson: z.unknown(),
  actorId: z.string().trim().min(1).optional(),
});

export async function updateAutomationTemplate(input: z.input<typeof updateTemplateSchema>): Promise<void> {
  const parsed = updateTemplateSchema.parse(input);
  const templateKey = getCanonicalAutomationTemplateKey(parsed.templateKey);
  if (parsed.templateKey !== templateKey) {
    await reconcileLegacyAutomationTemplateKey(templateKey);
  }
  const template = await findAutomationTemplateRecord({
    templateKey,
    select: { id: true, name: true, subjectTemplate: true, bodyTemplateJson: true },
  });

  if (!template) {
    throw new Error("AUTOMATION_TEMPLATE_NOT_FOUND");
  }

  const normalizedBody = normalizeMarketingContentJson(parsed.bodyTemplateJson);
  const tokenValidation = validateTemplateTokenUsage({
    templateKey,
    subjectTemplate: parsed.subjectTemplate,
    bodyTemplateJson: normalizedBody,
  });
  if (!tokenValidation.ok) {
    throw new Error(`AUTOMATION_TEMPLATE_INVALID_TOKENS:${tokenValidation.invalidTokens.join(",")}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.emailTemplate.update({
      where: { id: template.id },
      data: {
        name: parsed.name,
        subjectTemplate: parsed.subjectTemplate,
        bodyTemplateJson: normalizedBody as Prisma.InputJsonValue,
        updatedById: parsed.actorId ?? null,
      },
    });

    await tx.emailTemplateAuditLog.create({
      data: {
        templateId: template.id,
        action: EmailTemplateAuditAction.UPDATED,
        actorId: parsed.actorId ?? null,
        beforeJson: {
          name: template.name,
          subjectTemplate: template.subjectTemplate,
          bodyTemplateJson: template.bodyTemplateJson,
        } as Prisma.InputJsonValue,
        afterJson: {
          name: parsed.name,
          subjectTemplate: parsed.subjectTemplate,
          bodyTemplateJson: normalizedBody,
        } as Prisma.InputJsonValue,
      },
    });
  });
}

function renderSubjectWithEmptyTokens(subjectTemplate: string): string {
  return subjectTemplate.replace(/\{\{\s*[\w.-]+\s*\}\}/g, "").trim();
}

export async function sendAutomationTemplateTestEmail(input: z.input<typeof testSendSchema>): Promise<void> {
  const parsed = testSendSchema.parse(input);
  const templateKey = getCanonicalAutomationTemplateKey(parsed.templateKey);
  if (parsed.templateKey !== templateKey) {
    await reconcileLegacyAutomationTemplateKey(templateKey);
  }
  const template = await findAutomationTemplateRecord({
    templateKey,
    select: {
      isActive: true,
      subjectTemplate: true,
      bodyTemplateJson: true,
      contentSchemaVersion: true,
    },
  });

  if (!template || !template.isActive) {
    throw new Error("AUTOMATION_TEST_EMAIL_TEMPLATE_NOT_FOUND");
  }

  if (template.contentSchemaVersion !== 1) {
    throw new Error("AUTOMATION_TEST_EMAIL_UNSUPPORTED_SCHEMA");
  }

  const samplePayload = buildTemplateSamplePayload(parsed.templateKey);
  const samplePayloadTemplateKey = templateKey;
  const subject = replaceSubjectTokens(template.subjectTemplate, samplePayload) || renderSubjectWithEmptyTokens(template.subjectTemplate);
  const normalizedContent = normalizeMarketingContentJson(template.bodyTemplateJson);
  const html = replaceTemplateTokensInHtml(renderMarketingPreviewHtml(normalizedContent), samplePayload);

  await sendEmailViaResend({
    to: parsed.toEmail,
    from: resolveTestFromAddress(),
    subject: `[TEST] ${subject}`,
    html,
    context: `automation-test:${samplePayloadTemplateKey}`,
  });
}

function buildTemplateSamplePayload(_templateKey: string): Record<string, string> {
  return {
    "website.name": "Yoga Pilates Fitness Studio",
    "website.url": "https://bookmyclass.app",
    "website.logoUrl": "https://bookmyclass.app/logo.png",
    "website.address": "27 Calle de la Luz, Madrid",
    "contact.name.first": "Alex",
    "contact.name.last": "Taylor",
    "contact.email": "alex@example.com",
    "contact.fullName": "Alex Taylor",
    firstName: "Alex",
    lastName: "Taylor",
    name: "Alex Taylor",
    verificationUrl: "https://bookmyclass.app/verify-email?token=test",
    resetPasswordUrl: "https://bookmyclass.app/reset-password?token=test",
    emailChangeVerificationUrl: "https://bookmyclass.app/verify-email?emailChangeToken=test",
    "token.expiresAt": "2026-05-18T12:00:00Z",
  };
}

function replaceSubjectTokens(subjectTemplate: string, payload: Record<string, string>): string {
  return subjectTemplate.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, token) => payload[token] ?? `{{${token}}}`).trim();
}

function replaceTemplateTokensInHtml(input: string, payload: Record<string, string>): string {
  return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, token) => payload[token] ?? `{{${token}}}`);
}

export function validateTemplateTokenUsage(input: { templateKey: string; subjectTemplate: string; bodyTemplateJson: unknown }) {
  const allowed = getAllowedTokensForTemplate(getCanonicalAutomationTemplateKey(input.templateKey));
  const normalized = normalizeMarketingContentJson(input.bodyTemplateJson);
  const collected = [input.subjectTemplate, JSON.stringify(normalized)].flatMap((chunk) => extractTemplateTokens(chunk));
  const invalidTokens = [...new Set(collected.filter((token) => !allowed.has(token)))];
  return {
    ok: invalidTokens.length === 0,
    invalidTokens,
    tokenGroups: getTokenGroupsForTemplate(getCanonicalAutomationTemplateKey(input.templateKey)),
  };
}

export { AUTOMATION_TEMPLATE_RECONCILIATION_CONFLICT };
