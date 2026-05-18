import { prisma } from "@/lib/db";
import { dispatchEmailAutomationBatch } from "@/lib/email/email-automation-dispatcher-service";
import { enqueueEmailAutomationEvent } from "@/lib/email/email-automation-outbox-service";

type LifecycleTemplateInput = {
  templateKey: string;
  name: string;
  category: string;
  subjectTemplate: string;
  bodyTemplateJson: unknown;
};

export const PAYMENT_PURCHASE_CONFIRMATION_TEMPLATE_KEY = "payment.purchase.confirmation";
export const STORE_PURCHASE_CONFIRMATION_TEMPLATE_KEY = "store.purchase.confirmation";
export const GIFT_CARD_ISSUANCE_TEMPLATE_KEY = "gift-card.issuance";

export async function ensureLifecycleEmailTemplate(input: LifecycleTemplateInput): Promise<void> {
  await prisma.emailTemplate.upsert({
    where: { templateKey: input.templateKey },
    update: {
      name: input.name,
      category: input.category,
      subjectTemplate: input.subjectTemplate,
      bodyTemplateJson: input.bodyTemplateJson as object,
      contentSchemaVersion: 1,
      isActive: true,
    },
    create: {
      templateKey: input.templateKey,
      name: input.name,
      category: input.category,
      subjectTemplate: input.subjectTemplate,
      bodyTemplateJson: input.bodyTemplateJson as object,
      contentSchemaVersion: 1,
      isActive: true,
    },
  });
}

export async function enqueueLifecycleEmail(input: {
  templateKey: string;
  recipientEmail: string;
  payloadJson: Record<string, unknown>;
  idempotencyKey: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  await enqueueEmailAutomationEvent({
    templateKey: input.templateKey,
    recipientEmail: input.recipientEmail,
    payloadJson: input.payloadJson,
    idempotencyKey: input.idempotencyKey,
    availableAt: new Date(now.getTime() - 1),
  });
}

export async function attemptImmediateLifecycleDispatch(now: Date): Promise<void> {
  await dispatchEmailAutomationBatch({
    workerId: `lifecycle-fast-lane:${process.pid}`,
    maxEvents: 10,
    leaseMs: 30_000,
    now,
  });
}
