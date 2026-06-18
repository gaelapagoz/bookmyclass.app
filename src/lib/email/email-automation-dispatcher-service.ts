import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  acquireEmailAutomationLease,
  finalizeEmailAutomationLease,
  recordEmailDispatcherHeartbeat,
} from "@/lib/email/email-automation-outbox-service";
import { normalizeMarketingContentJson, renderMarketingPreviewHtml } from "@/lib/marketing/marketing-renderer";
import { isDeterministicEmailDeliveryMode, sendEmailViaResend } from "@/lib/email/resend-delivery";

const dispatcherInputSchema = z.object({
  workerId: z.string().trim().min(1),
  maxEvents: z.coerce.number().int().min(1).max(100).default(25),
  leaseMs: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  now: z.coerce.date().optional(),
});

const payloadJsonSchema = z
  .unknown()
  .refine(
    (value): value is Record<string, unknown> =>
      value !== null && typeof value === "object" && !Array.isArray(value),
    "EMAIL_AUTOMATION_INVALID_PAYLOAD_JSON",
  );

export type DispatchEmailAutomationBatchResult = {
  leasedCount: number;
  sentCount: number;
  failedCount: number;
  deadLetterCount: number;
  heartbeatWorkerId: string;
};

function resolveFromAddress(): string {
  const configured = process.env.EMAIL_FROM?.trim();
  if (configured) {
    return configured;
  }

  if (isDeterministicEmailDeliveryMode()) {
    return "Book My Class Test <no-reply@test.local>";
  }

  throw new Error("Missing EMAIL_FROM.");
}

function renderSubjectTemplate(subjectTemplate: string, payloadJson: Record<string, unknown>): string {
  return subjectTemplate.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = payloadJson[key];
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return JSON.stringify(value);
  });
}

function applyTemplateTokensToJson(input: unknown, payloadJson: Record<string, unknown>): unknown {
  if (typeof input === "string") {
    return renderSubjectTemplate(input, payloadJson);
  }
  if (Array.isArray(input)) {
    return input.map((item) => applyTemplateTokensToJson(item, payloadJson));
  }
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, applyTemplateTokensToJson(value, payloadJson)]),
    );
  }
  return input;
}

function renderBodyHtml(bodyTemplateJson: unknown, payloadJson: Record<string, unknown>): string {
  const templatedContent = applyTemplateTokensToJson(bodyTemplateJson, payloadJson);
  const normalizedContent = normalizeMarketingContentJson(templatedContent);
  return renderMarketingPreviewHtml(normalizedContent);
}

function computeRetryBackoffMs(attemptsSoFar: number): number {
  const baseMs = 30_000;
  const computed = baseMs * 2 ** Math.max(0, attemptsSoFar);
  return Math.min(computed, 30 * 60 * 1_000);
}

function getRequiredPayloadFieldsForTemplate(templateKey: string): string[] {
  switch (templateKey) {
    case "booking.class-booked":
      return [
        "clientName",
        "booking.classTitle",
        "booking.startAt",
        "booking.manageUrl",
        "booking.cancelUrl",
      ];
    case "booking.class-cancelled":
      return [
        "clientName",
        "booking.classTitle",
        "booking.startAt",
      ];
    case "booking.class-reminder":
      return [
        "clientName",
        "booking.classTitle",
        "booking.startAt",
        "booking.manageUrl",
        "booking.cancelUrl",
      ];
    case "waitlist.on-list":
    case "waitlist.not-promoted":
      return [
        "clientName",
        "waitlist.classTitle",
        "dateTimeLabel",
        "waitlist.manageUrl",
        "waitlistEntryId",
      ];
    case "waitlist.promoted":
      return [
        "clientName",
        "waitlist.classTitle",
        "dateTimeLabel",
        "waitlist.manageUrl",
        "waitlistEntryId",
        "bookingId",
      ];
    default:
      return [];
  }
}

function isPresentPayloadValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  return value !== null && value !== undefined;
}

function assertRequiredPayloadFields(templateKey: string, payloadJson: Record<string, unknown>): void {
  const requiredFields = getRequiredPayloadFieldsForTemplate(templateKey);
  if (requiredFields.length < 1) {
    return;
  }

  const missingFields = requiredFields.filter((field) => !isPresentPayloadValue(payloadJson[field]));
  if (missingFields.length > 0) {
    throw new Error(`EMAIL_AUTOMATION_MISSING_REQUIRED_PAYLOAD_FIELDS:${missingFields.join(",")}`);
  }
}

async function preventResendAfterFinalizeConflict(input: {
  eventId: string;
  now: Date;
}): Promise<void> {
  await prisma.emailAutomationEvent.updateMany({
    where: {
      id: input.eventId,
      sentAt: null,
      status: {
        in: ["PENDING", "LEASED"],
      },
    },
    data: {
      status: "DEAD_LETTER",
      deadLetteredAt: input.now,
      lastError: "DISPATCH_FINALIZE_CONFLICT_AFTER_SEND",
      leaseOwner: null,
      leasedAt: null,
      leaseExpiresAt: null,
    },
  });
}

export async function dispatchEmailAutomationBatch(
  input: z.input<typeof dispatcherInputSchema>,
): Promise<DispatchEmailAutomationBatchResult> {
  const parsed = dispatcherInputSchema.parse(input);
  const now = parsed.now ?? new Date();

  const leased = await acquireEmailAutomationLease({
    leaseOwner: parsed.workerId,
    maxEvents: parsed.maxEvents,
    leaseMs: parsed.leaseMs,
    now,
  });

  let sentCount = 0;
  let failedCount = 0;
  let deadLetterCount = 0;

  for (const event of leased) {
    const template = await prisma.emailTemplate.findUnique({
      where: { id: event.templateId },
      select: {
        isActive: true,
        contentSchemaVersion: true,
        templateKey: true,
        subjectTemplate: true,
        bodyTemplateJson: true,
      },
    });

    if (!template) {
      await finalizeEmailAutomationLease({
        eventId: event.id,
        leaseOwner: parsed.workerId,
        sent: false,
        errorMessage: `Missing email template: ${event.templateId}`,
        retryBackoffMs: computeRetryBackoffMs(event.attempts),
        now,
      });
      failedCount += 1;
      continue;
    }

    try {
      if (!template.isActive) {
        await finalizeEmailAutomationLease({
          eventId: event.id,
          leaseOwner: parsed.workerId,
          sent: true,
          now,
        });
        continue;
      }

      if (template.contentSchemaVersion !== 1) {
        throw new Error(`Unsupported email template content schema version: ${template.contentSchemaVersion}`);
      }

      const payloadParsed = payloadJsonSchema.safeParse(event.payloadJson);
      if (!payloadParsed.success) {
        throw new Error("EMAIL_AUTOMATION_INVALID_PAYLOAD_JSON");
      }
      const payloadJson = payloadParsed.data;
      assertRequiredPayloadFields(template.templateKey, payloadJson);
      const deliveryContext =
        typeof payloadJson.deliveryContext === "string" && payloadJson.deliveryContext.trim().length > 0
          ? payloadJson.deliveryContext.trim()
          : `email-automation:${event.id}`;
      const deliveryResult = await sendEmailViaResend({
        to: event.recipientEmail,
        from: resolveFromAddress(),
        subject: renderSubjectTemplate(
          template.subjectTemplate,
          payloadJson,
        ),
        html: renderBodyHtml(template.bodyTemplateJson, payloadJson),
        context: deliveryContext,
      });

      const finalized = await finalizeEmailAutomationLease({
        eventId: event.id,
        leaseOwner: parsed.workerId,
        sent: true,
        now,
      });
      if (!finalized) {
        await preventResendAfterFinalizeConflict({ eventId: event.id, now });
        failedCount += 1;
        deadLetterCount += 1;
        continue;
      }
      console.info("[email-dispatcher] event delivered", {
        bypassed: deliveryResult.bypassed,
        eventId: event.id,
        messageId: deliveryResult.messageId,
        provider: deliveryResult.provider,
        recipientEmail: event.recipientEmail,
        templateId: event.templateId,
        workerId: parsed.workerId,
      });
      sentCount += 1;
    } catch (error) {
      const finalized = await finalizeEmailAutomationLease({
        eventId: event.id,
        leaseOwner: parsed.workerId,
        sent: false,
        errorMessage: error instanceof Error ? error.message : "Email delivery failed",
        retryBackoffMs: computeRetryBackoffMs(event.attempts),
        now,
      });
      console.error("[email-dispatcher] event delivery failed", {
        error: error instanceof Error ? error.message : String(error),
        eventId: event.id,
        finalizedStatus: finalized?.status ?? null,
        recipientEmail: event.recipientEmail,
        templateId: event.templateId,
        workerId: parsed.workerId,
      });
      failedCount += 1;
      if (finalized?.status === "DEAD_LETTER") {
        deadLetterCount += 1;
      }
    }
  }

  await recordEmailDispatcherHeartbeat({
    workerId: parsed.workerId,
    activeLeaseCount: 0,
    metadataJson: {
      leasedCount: leased.length,
      sentCount,
      failedCount,
      deadLetterCount,
      at: now.toISOString(),
    },
    now,
  });

  return {
    leasedCount: leased.length,
    sentCount,
    failedCount,
    deadLetterCount,
    heartbeatWorkerId: parsed.workerId,
  };
}
