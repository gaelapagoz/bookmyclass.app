import "./helpers/setup-env";

import { randomUUID } from "node:crypto";
import { EmailAutomationEventStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  acquireEmailAutomationLease,
  enqueueEmailAutomationEvent,
  finalizeEmailAutomationLease,
  recordEmailDispatcherHeartbeat,
} from "@/lib/email/email-automation-outbox-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

async function createTemplate(templateKey: string) {
  return prisma.emailTemplate.upsert({
    where: { templateKey },
    update: {
      name: "Template",
      category: "AUTH",
      subjectTemplate: "Welcome {{name}}",
      bodyTemplateJson: { blocks: [{ type: "paragraph", text: "Hello" }] },
      contentSchemaVersion: 1,
      isActive: true,
    },
    create: {
      templateKey,
      name: "Template",
      category: "AUTH",
      subjectTemplate: "Welcome {{name}}",
      bodyTemplateJson: { blocks: [{ type: "paragraph", text: "Hello" }] },
      contentSchemaVersion: 1,
      isActive: true,
    },
  });
}

function uniqueKey(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

describe("email automation outbox contract", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("enqueues by idempotency key and avoids duplicate events", async () => {
    const templateKey = uniqueKey("auth.verify-email");
    const idemKey = uniqueKey("idem-e1-001");
    await createTemplate(templateKey);

    const first = await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "Client@Example.test",
      payloadJson: { token: "abc" },
      idempotencyKey: idemKey,
    });
    const second = await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "client@example.test",
      payloadJson: { token: "abc" },
      idempotencyKey: idemKey,
    });

    expect(second.id).toBe(first.id);
    expect(await prisma.emailAutomationEvent.count()).toBe(1);
  });

  it("handles concurrent idempotent enqueue calls without surfacing unique conflicts", async () => {
    const templateKey = uniqueKey("auth.verify-email");
    const idemKey = uniqueKey("idem-e1-concurrent");
    await createTemplate(templateKey);

    const [first, second] = await Promise.all([
      enqueueEmailAutomationEvent({
        templateKey,
        recipientEmail: "client@example.test",
        payloadJson: { token: "abc" },
        idempotencyKey: idemKey,
      }),
      enqueueEmailAutomationEvent({
        templateKey,
        recipientEmail: "client@example.test",
        payloadJson: { token: "abc" },
        idempotencyKey: idemKey,
      }),
    ]);

    expect(first.id).toBe(second.id);
    expect(await prisma.emailAutomationEvent.count()).toBe(1);
  });

  it("throws for unknown template key", async () => {
    await expect(
      enqueueEmailAutomationEvent({
        templateKey: "missing.template",
        recipientEmail: "client@example.test",
        payloadJson: { token: "abc" },
        idempotencyKey: "idem-e1-missing-template",
      }),
    ).rejects.toThrow("Unknown email template key: missing.template");
  });

  it("acquires a lease and marks events as LEASED", async () => {
    const templateKey = uniqueKey("auth.verify-email");
    await createTemplate(templateKey);

    await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "client1@example.test",
      payloadJson: { token: "one" },
      idempotencyKey: uniqueKey("idem-e1-lease-1"),
    });
    await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "client2@example.test",
      payloadJson: { token: "two" },
      idempotencyKey: uniqueKey("idem-e1-lease-2"),
    });

    const leased = await acquireEmailAutomationLease({
      leaseOwner: "worker-e1",
      maxEvents: 2,
      leaseMs: 30_000,
    });

    expect(leased).toHaveLength(2);
    expect(leased.every((item) => item.status === EmailAutomationEventStatus.LEASED)).toBe(true);
    expect(leased.every((item) => item.leaseOwner === "worker-e1")).toBe(true);
  });

  it("reacquires expired leased events", async () => {
    const templateKey = uniqueKey("auth.verify-email");
    const idemKey = uniqueKey("idem-e1-expired-lease");
    await createTemplate(templateKey);

    const event = await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "client@example.test",
      payloadJson: { token: "abc" },
      idempotencyKey: idemKey,
    });

    await prisma.emailAutomationEvent.update({
      where: { id: event.id },
      data: {
        status: EmailAutomationEventStatus.LEASED,
        leaseOwner: "stale-worker",
        availableAt: new Date("2026-05-17T10:00:00.000Z"),
        leasedAt: new Date("2026-05-17T10:00:00.000Z"),
        leaseExpiresAt: new Date("2026-05-17T10:00:05.000Z"),
      },
    });

    const leased = await acquireEmailAutomationLease({
      leaseOwner: "worker-reclaim",
      maxEvents: 1,
      leaseMs: 30_000,
      now: new Date("2026-05-17T10:01:00.000Z"),
    });

    expect(leased).toHaveLength(1);
    expect(leased[0]?.id).toBe(event.id);
    expect(leased[0]?.leaseOwner).toBe("worker-reclaim");
  });

  it("finalizes success to SENT and records attempt log", async () => {
    const templateKey = uniqueKey("auth.verify-email");
    await createTemplate(templateKey);
    const event = await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "client@example.test",
      payloadJson: { token: "ok" },
      idempotencyKey: uniqueKey("idem-e1-finalize-success"),
    });

    await acquireEmailAutomationLease({
      leaseOwner: "worker-success",
      maxEvents: 1,
      leaseMs: 30_000,
    });

    const updated = await finalizeEmailAutomationLease({
      eventId: event.id,
      leaseOwner: "worker-success",
      sent: true,
    });
    const attempts = await prisma.emailAutomationAttempt.findMany({ where: { eventId: event.id } });

    expect(updated?.status).toBe(EmailAutomationEventStatus.SENT);
    expect(updated?.attempts).toBe(1);
    expect(updated?.sentAt).toBeTruthy();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("SUCCEEDED");
  });

  it("retries failures and then dead-letters once max attempts is reached", async () => {
    const templateKey = uniqueKey("booking.confirmed");
    await createTemplate(templateKey);
    const event = await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "client@example.test",
      payloadJson: { bookingId: "bk_1" },
      idempotencyKey: uniqueKey("idem-e1-dead-letter"),
      maxAttempts: 2,
    });

    await acquireEmailAutomationLease({ leaseOwner: "worker-retry", maxEvents: 1, leaseMs: 10_000 });
    const firstFail = await finalizeEmailAutomationLease({
      eventId: event.id,
      leaseOwner: "worker-retry",
      sent: false,
      errorMessage: "SMTP timeout",
      retryBackoffMs: 0,
    });
    expect(firstFail?.status).toBe(EmailAutomationEventStatus.PENDING);
    expect(firstFail?.attempts).toBe(1);

    await acquireEmailAutomationLease({ leaseOwner: "worker-retry", maxEvents: 1, leaseMs: 10_000 });
    const secondFail = await finalizeEmailAutomationLease({
      eventId: event.id,
      leaseOwner: "worker-retry",
      sent: false,
      errorMessage: "SMTP timeout again",
    });
    expect(secondFail?.status).toBe(EmailAutomationEventStatus.DEAD_LETTER);
    expect(secondFail?.deadLetteredAt).toBeTruthy();
    expect(secondFail?.attempts).toBe(2);
  });

  it("returns null when finalize owner mismatches and does not write attempt rows", async () => {
    const templateKey = uniqueKey("auth.verify-email");
    await createTemplate(templateKey);
    const event = await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "client@example.test",
      payloadJson: { token: "abc" },
      idempotencyKey: uniqueKey("idem-e1-owner-guard"),
    });

    await acquireEmailAutomationLease({
      leaseOwner: "worker-right",
      maxEvents: 1,
      leaseMs: 10_000,
    });

    const result = await finalizeEmailAutomationLease({
      eventId: event.id,
      leaseOwner: "worker-wrong",
      sent: true,
    });

    expect(result).toBeNull();
    expect(await prisma.emailAutomationAttempt.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("applies retry backoff to availableAt on failed finalize", async () => {
    const templateKey = uniqueKey("auth.verify-email");
    const idemKey = uniqueKey("idem-e1-backoff");
    await createTemplate(templateKey);
    const event = await enqueueEmailAutomationEvent({
      templateKey,
      recipientEmail: "client@example.test",
      payloadJson: { token: "abc" },
      idempotencyKey: idemKey,
      availableAt: new Date("2026-05-17T11:00:00.000Z"),
    });

    const now = new Date("2026-05-17T11:00:00.000Z");
    await acquireEmailAutomationLease({
      leaseOwner: "worker-backoff",
      maxEvents: 1,
      leaseMs: 10_000,
      now,
    });

    const updated = await finalizeEmailAutomationLease({
      eventId: event.id,
      leaseOwner: "worker-backoff",
      sent: false,
      errorMessage: "temporary failure",
      retryBackoffMs: 15_000,
      now,
    });

    expect(updated?.status).toBe(EmailAutomationEventStatus.PENDING);
    expect(updated?.availableAt.toISOString()).toBe("2026-05-17T11:00:15.000Z");
  });

  it("persists dispatcher heartbeat by worker id", async () => {
    const first = await recordEmailDispatcherHeartbeat({
      workerId: "dispatcher-1",
      activeLeaseCount: 2,
      metadataJson: { region: "eu-west" },
    });
    const second = await recordEmailDispatcherHeartbeat({
      workerId: "dispatcher-1",
      activeLeaseCount: 0,
      metadataJson: { region: "eu-west", state: "idle" },
    });

    expect(second.id).toBe(first.id);
    expect(second.activeLeaseCount).toBe(0);
    expect(second.metadataJson).toMatchObject({ state: "idle" });
    expect(await prisma.emailDispatcherHeartbeat.count()).toBe(1);
  });
});
