/**
 * Provisions all canonical email automation templates into the database.
 * Safe to run multiple times (idempotent). Metadata is always updated;
 * bodyTemplateJson is only written when the existing body is empty/absent.
 * Run with: npm run email:provision-templates
 */

import prisma from "../src/lib/db";

type TemplateInput = {
  templateKey: string;
  name: string;
  category: string;
  subjectTemplate: string;
  bodyTemplateJson: object;
};

const CANONICAL_TEMPLATES: TemplateInput[] = [
  // AUTH
  {
    templateKey: "auth.verify-email",
    name: "Auth Verification Email",
    category: "AUTH",
    subjectTemplate: "Verify your email",
    bodyTemplateJson: {
      blocks: [
        { type: "paragraph", contentHtml: "<p>Hello {{name}},</p>" },
        { type: "paragraph", contentHtml: "<p>Please verify your email to continue.</p>" },
        { type: "button", labelHtml: "Verify email", url: "https://example.com", textColor: "#ffffff", backgroundColor: "#1d3652" },
        { type: "paragraph", contentHtml: "<p>This link expires in 24 hours.</p>" },
      ],
    },
  },
  {
    templateKey: "auth.verify-email-change",
    name: "Auth Email Change Verification",
    category: "AUTH",
    subjectTemplate: "Confirm your new email",
    bodyTemplateJson: {
      blocks: [
        { type: "paragraph", contentHtml: "<p>Hello {{name}},</p>" },
        { type: "paragraph", contentHtml: "<p>Please verify your new email address to continue.</p>" },
        { type: "button", labelHtml: "Verify email", url: "https://example.com", textColor: "#ffffff", backgroundColor: "#1d3652" },
        { type: "paragraph", contentHtml: "<p>This link expires in 24 hours.</p>" },
      ],
    },
  },
  {
    templateKey: "auth.password-reset",
    name: "Auth Password Reset Email",
    category: "AUTH",
    subjectTemplate: "Reset your password",
    bodyTemplateJson: {
      blocks: [
        { type: "paragraph", contentHtml: "<p>Hello {{userName}},</p>" },
        { type: "paragraph", contentHtml: "<p>We received a request to reset your password.</p>" },
        { type: "button", labelHtml: "Reset your password", url: "https://example.com", textColor: "#ffffff", backgroundColor: "#1d3652" },
        { type: "paragraph", contentHtml: "<p>This link expires in {{expiresInMinutes}} minutes and can only be used once.</p>" },
      ],
    },
  },
  // PAYMENT
  {
    templateKey: "payment.purchase.confirmation",
    name: "Payment Purchase Confirmation",
    category: "PAYMENT",
    subjectTemplate: "Your Studio Purchase Confirmation",
    bodyTemplateJson: {
      blocks: [
        { type: "heading", contentHtml: "<p>Purchase Confirmed</p>", textColor: "#1f2735" },
        { type: "paragraph", contentHtml: "<p>{{greeting}}</p>" },
        { type: "paragraph", contentHtml: "<p>Your purchase is confirmed. Your credits and entitlements are now active in your account.</p>" },
        { type: "paragraph", contentHtml: "<p>Order: {{orderSummaryText}}</p>" },
        { type: "paragraph", contentHtml: "<p>Total: {{totalAmountFormatted}}</p>" },
        { type: "paragraph", contentHtml: "<p>{{walletAmountLine}}</p>" },
        { type: "paragraph", contentHtml: "<p>{{stripeAmountLine}}</p>" },
        { type: "paragraph", contentHtml: "<p>View your credits and active plans in Dashboard &gt; Membership &amp; Credits.</p>" },
      ],
    },
  },
  // STORE
  {
    templateKey: "store.purchase.confirmation",
    name: "Store Purchase Confirmation",
    category: "STORE",
    subjectTemplate: "Your Studio Purchase Confirmation",
    bodyTemplateJson: {
      blocks: [
        { type: "heading", contentHtml: "<p>Purchase Confirmed</p>", textColor: "#1f2735" },
        { type: "paragraph", contentHtml: "<p>{{greeting}}</p>" },
        { type: "paragraph", contentHtml: "<p>Thank you for your purchase! Your order is confirmed.</p>" },
        { type: "paragraph", contentHtml: "<p>Order: {{orderSummaryText}}</p>" },
        { type: "paragraph", contentHtml: "<p>Pickup at studio. Please bring this confirmation when you collect your order.</p>" },
      ],
    },
  },
  // GIFT_CARD
  {
    templateKey: "gift-card.issuance",
    name: "Gift Card Issuance",
    category: "GIFT_CARD",
    subjectTemplate: "Your gift card code",
    bodyTemplateJson: {
      blocks: [
        { type: "heading", contentHtml: "<p>Your gift card code</p>", textColor: "#1f2735" },
        { type: "paragraph", contentHtml: "<p>{{greeting}}</p>" },
        { type: "paragraph", contentHtml: "<p>Your {{amountFormatted}} gift card code is below.</p>" },
        { type: "paragraph", contentHtml: "<p>{{plaintextCode}}</p>" },
        { type: "paragraph", contentHtml: "<p>{{escapedAdminMessage}}</p>" },
        { type: "paragraph", contentHtml: "<p>To redeem this code, sign in and go to Dashboard &rarr; Wallet.</p>" },
        { type: "paragraph", contentHtml: "<p>Keep this code safe &mdash; it can only be used once.</p>" },
      ],
    },
  },
];

function hasNonEmptyBody(bodyTemplateJson: unknown): boolean {
  if (!bodyTemplateJson || typeof bodyTemplateJson !== "object") return false;
  const blocks = (bodyTemplateJson as Record<string, unknown>).blocks;
  return Array.isArray(blocks) && blocks.length > 0;
}

async function provisionEmailTemplates(): Promise<void> {
  console.log(`Provisioning ${CANONICAL_TEMPLATES.length} canonical email templates...`);

  for (const template of CANONICAL_TEMPLATES) {
    const existing = await prisma.emailTemplate.findUnique({
      where: { templateKey: template.templateKey },
      select: { id: true, bodyTemplateJson: true },
    });

    if (!existing) {
      await prisma.emailTemplate.create({
        data: {
          templateKey: template.templateKey,
          name: template.name,
          category: template.category,
          subjectTemplate: template.subjectTemplate,
          bodyTemplateJson: template.bodyTemplateJson,
          contentSchemaVersion: 1,
          isActive: true,
        },
      });
      console.log(`  created: ${template.templateKey}`);
    } else {
      await prisma.emailTemplate.update({
        where: { templateKey: template.templateKey },
        data: {
          name: template.name,
          category: template.category,
          subjectTemplate: template.subjectTemplate,
          contentSchemaVersion: 1,
          isActive: true,
          // Preserve body if already customized; only seed if empty
          ...(hasNonEmptyBody(existing.bodyTemplateJson) ? {} : { bodyTemplateJson: template.bodyTemplateJson }),
        },
      });
      console.log(`  updated: ${template.templateKey}`);
    }
  }

  console.log("Done.");
}

provisionEmailTemplates()
  .catch((error) => {
    console.error("Provision failed:", error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
