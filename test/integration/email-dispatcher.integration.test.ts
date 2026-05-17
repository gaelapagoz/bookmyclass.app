import "./helpers/setup-env";

import { randomUUID } from "node:crypto";
import { EmailAutomationEventStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import {
  dispatchEmailAutomationBatch,
} from "@/lib/email/email-automation-dispatcher-service";
import { enqueueEmailAutomationEvent } from "@/lib/email/email-automation-outbox-service";
import { clearCapturedTestEmails, getCapturedTestEmails } from "@/lib/email/resend-delivery";
import { resetDb } from "./helpers/reset-db";

async function createTemplate(templateKey: string) {
  return prisma.emailTemplate.upsert({
    where: { templateKey },
    update: {
      name: "Template",
      category: "AUTH",
      subjectTemplate: "Welcome {{name}}",
      bodyTemplateJson: { blocks: [{ type: "paragraph", text: "Hello {{name}}" }] },
      contentSchemaVersion: 1,
      isActive: true,
    },
    create: {
      templateKey,
      name: "Template",
      category: "AUTH",
      subjectTemplate: "Welcome {{name}}",
      bodyTemplateJson: { blocks: [{ type: "paragraph", text: "Hello {{name}}" }] },
      contentSchemaVersion: 1,
      isActive: true,
    },
  });
}

function uniqueKey(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

describe("email automation dispatcher", () => {
  beforeEach(async () => {
    await resetDb();
    clearCapturedTestEmails();
    vi.unstubAllEnvs();
  });

  it("dispatches leased events, marks them SENT, and records heartbeat", async () => {
    const templateKey = uniqueKey("auth.verify-email");
    const idemKey = uniqueKey("idem-e2-dispatch-success");
    await createTemplate(templateKey);
    await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "client@example.test",
      payloadJson: { name: "Client" },
      idempotencyKey: idemKey,
      availableAt: new Date("2026-05-17T11:59:00.000Z"),
    });

    const now = new Date("2026-05-17T12:00:00.000Z");
    const result = await dispatchEmailAutomationBatch({
      workerId: "dispatcher-e2",
      maxEvents: 10,
      leaseMs: 30_000,
      now,
    });

    const event = await prisma.emailAutomationEvent.findUniqueOrThrow({
      where: { idempotencyKey: idemKey },
    });
    const heartbeat = await prisma.emailDispatcherHeartbeat.findUniqueOrThrow({
      where: { workerId: "dispatcher-e2" },
    });

    expect(result).toMatchObject({
      leasedCount: 1,
      sentCount: 1,
      failedCount: 0,
      deadLetterCount: 0,
      heartbeatWorkerId: "dispatcher-e2",
    });
    expect(event.status).toBe(EmailAutomationEventStatus.SENT);
    expect(event.sentAt?.toISOString()).toBe("2026-05-17T12:00:00.000Z");
    expect(heartbeat.activeLeaseCount).toBe(0);
    expect(getCapturedTestEmails()).toHaveLength(1);
    expect(getCapturedTestEmails()[0]?.html).toContain("Hello Client");
  });

  it("retries failed delivery with backoff and eventually dead-letters", async () => {
    const templateKey = uniqueKey("auth.verify-email");
    const idemKey = uniqueKey("idem-e2-dispatch-fail");
    await createTemplate(templateKey);
    await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "client@example.test",
      payloadJson: { name: "Client" },
      idempotencyKey: idemKey,
      maxAttempts: 2,
      availableAt: new Date("2026-05-17T12:59:00.000Z"),
    });

    const originalNodeEnv = process.env.NODE_ENV;
    const originalKey = process.env.RESEND_API_KEY;
    const originalFrom = process.env.EMAIL_FROM;
    process.env.NODE_ENV = "development";
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM = "Book My Class <no-reply@bookmyclass.app>";

    try {
      const firstNow = new Date("2026-05-17T13:00:00.000Z");
      const first = await dispatchEmailAutomationBatch({
        workerId: "dispatcher-e2-fail",
        maxEvents: 1,
        leaseMs: 30_000,
        now: firstNow,
      });
      const afterFirst = await prisma.emailAutomationEvent.findUniqueOrThrow({
        where: { idempotencyKey: idemKey },
      });

      expect(first).toMatchObject({ leasedCount: 1, sentCount: 0, failedCount: 1, deadLetterCount: 0 });
      expect(afterFirst.status).toBe(EmailAutomationEventStatus.PENDING);
      expect(afterFirst.attempts).toBe(1);
      expect(afterFirst.availableAt.toISOString()).toBe("2026-05-17T13:00:30.000Z");

      const secondNow = new Date("2026-05-17T13:02:00.000Z");
      const second = await dispatchEmailAutomationBatch({
        workerId: "dispatcher-e2-fail",
        maxEvents: 1,
        leaseMs: 30_000,
        now: secondNow,
      });
      const afterSecond = await prisma.emailAutomationEvent.findUniqueOrThrow({
        where: { idempotencyKey: idemKey },
      });

      expect(second).toMatchObject({ leasedCount: 1, sentCount: 0, failedCount: 1, deadLetterCount: 1 });
      expect(afterSecond.status).toBe(EmailAutomationEventStatus.DEAD_LETTER);
      expect(afterSecond.deadLetteredAt?.toISOString()).toBe("2026-05-17T13:02:00.000Z");
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = originalKey;
      }
      if (originalFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = originalFrom;
      }
    }
  });

  it("fails and dead-letters when template content schema version is unsupported without sending", async () => {
    const templateKey = uniqueKey("auth.schema-unsupported");
    const idemKey = uniqueKey("idem-e3-schema-version");
    const template = await createTemplate(templateKey);
    await prisma.emailTemplate.update({
      where: { id: template.id },
      data: { contentSchemaVersion: 2 },
    });
    await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "client@example.test",
      payloadJson: { name: "Client" },
      idempotencyKey: idemKey,
      maxAttempts: 1,
      availableAt: new Date("2026-05-17T14:59:00.000Z"),
    });

    const now = new Date("2026-05-17T15:00:00.000Z");
    const result = await dispatchEmailAutomationBatch({
      workerId: "dispatcher-e3-schema-version",
      maxEvents: 1,
      leaseMs: 30_000,
      now,
    });
    const event = await prisma.emailAutomationEvent.findUniqueOrThrow({
      where: { idempotencyKey: idemKey },
    });

    expect(result).toMatchObject({ leasedCount: 1, sentCount: 0, failedCount: 1, deadLetterCount: 1 });
    expect(event.status).toBe(EmailAutomationEventStatus.DEAD_LETTER);
    expect(event.lastError).toBe("Unsupported email template content schema version: 2");
    expect(getCapturedTestEmails()).toHaveLength(0);
  });

  it("fails invalid legacy body payload without JSON-pre fallback and skips send", async () => {
    const templateKey = uniqueKey("auth.legacy-invalid-body");
    const idemKey = uniqueKey("idem-e3-no-pre-fallback");
    await prisma.emailTemplate.upsert({
      where: { templateKey },
      update: {
        name: "Legacy Invalid Body",
        category: "AUTH",
        subjectTemplate: "Welcome {{name}}",
        bodyTemplateJson: { legacyText: "Hello {{name}}" },
        contentSchemaVersion: 1,
        isActive: true,
      },
      create: {
        templateKey,
        name: "Legacy Invalid Body",
        category: "AUTH",
        subjectTemplate: "Welcome {{name}}",
        bodyTemplateJson: { legacyText: "Hello {{name}}" },
        contentSchemaVersion: 1,
        isActive: true,
      },
    });
    await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "client@example.test",
      payloadJson: { name: "Client" },
      idempotencyKey: idemKey,
      maxAttempts: 1,
      availableAt: new Date("2026-05-17T15:09:00.000Z"),
    });

    const now = new Date("2026-05-17T15:10:00.000Z");
    const result = await dispatchEmailAutomationBatch({
      workerId: "dispatcher-e3-no-pre",
      maxEvents: 1,
      leaseMs: 30_000,
      now,
    });
    const event = await prisma.emailAutomationEvent.findUniqueOrThrow({
      where: { idempotencyKey: idemKey },
    });

    expect(result).toMatchObject({ leasedCount: 1, sentCount: 0, failedCount: 1, deadLetterCount: 1 });
    expect(event.status).toBe(EmailAutomationEventStatus.DEAD_LETTER);
    expect(event.lastError?.includes("blocks")).toBe(true);
    expect(getCapturedTestEmails()).toHaveLength(0);
  });
});
