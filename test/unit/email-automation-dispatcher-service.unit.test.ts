import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireEmailAutomationLease: vi.fn(),
  finalizeEmailAutomationLease: vi.fn(),
  recordEmailDispatcherHeartbeat: vi.fn(),
  sendEmailViaResend: vi.fn(),
  findTemplate: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/email/email-automation-outbox-service", () => ({
  acquireEmailAutomationLease: mocks.acquireEmailAutomationLease,
  finalizeEmailAutomationLease: mocks.finalizeEmailAutomationLease,
  recordEmailDispatcherHeartbeat: mocks.recordEmailDispatcherHeartbeat,
}));

vi.mock("@/lib/email/resend-delivery", () => ({
  sendEmailViaResend: mocks.sendEmailViaResend,
  isDeterministicEmailDeliveryMode: () => true,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    emailTemplate: {
      findUnique: mocks.findTemplate,
    },
    emailAutomationEvent: {
      updateMany: mocks.updateMany,
    },
  },
}));

import { dispatchEmailAutomationBatch } from "@/lib/email/email-automation-dispatcher-service";

describe("email automation dispatcher service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordEmailDispatcherHeartbeat.mockResolvedValue({});
    mocks.sendEmailViaResend.mockResolvedValue({ sent: true });
    mocks.findTemplate.mockResolvedValue({
      contentSchemaVersion: 1,
      subjectTemplate: "Welcome",
      bodyTemplateJson: { blocks: [{ type: "paragraph", text: "Hello" }] },
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("dead-letters event when send succeeds but finalize ownership is lost", async () => {
    mocks.acquireEmailAutomationLease.mockResolvedValue([
      {
        id: "evt_1",
        templateId: "tpl_1",
        recipientEmail: "client@example.test",
        payloadJson: {},
        attempts: 0,
      },
    ]);
    mocks.finalizeEmailAutomationLease.mockResolvedValue(null);

    const now = new Date("2026-05-17T14:00:00.000Z");
    const result = await dispatchEmailAutomationBatch({
      workerId: "worker-test",
      maxEvents: 1,
      leaseMs: 30_000,
      now,
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "evt_1",
        sentAt: null,
        status: { in: ["PENDING", "LEASED"] },
      },
      data: expect.objectContaining({
        status: "DEAD_LETTER",
        deadLetteredAt: now,
        lastError: "DISPATCH_FINALIZE_CONFLICT_AFTER_SEND",
      }),
    });
    expect(result).toMatchObject({
      leasedCount: 1,
      sentCount: 0,
      failedCount: 1,
      deadLetterCount: 1,
    });
  });

  it("finalizes failed with deterministic error when payloadJson is not an object", async () => {
    mocks.acquireEmailAutomationLease.mockResolvedValue([
      {
        id: "evt_invalid_payload",
        templateId: "tpl_1",
        recipientEmail: "client@example.test",
        payloadJson: "not-an-object",
        attempts: 0,
      },
    ]);
    mocks.finalizeEmailAutomationLease.mockResolvedValue({
      status: "PENDING",
    });

    const now = new Date("2026-05-17T14:10:00.000Z");
    const result = await dispatchEmailAutomationBatch({
      workerId: "worker-invalid-payload",
      maxEvents: 1,
      leaseMs: 30_000,
      now,
    });

    expect(mocks.sendEmailViaResend).not.toHaveBeenCalled();
    expect(mocks.finalizeEmailAutomationLease).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_invalid_payload",
        sent: false,
        errorMessage: "EMAIL_AUTOMATION_INVALID_PAYLOAD_JSON",
      }),
    );
    expect(result).toMatchObject({
      leasedCount: 1,
      sentCount: 0,
      failedCount: 1,
      deadLetterCount: 0,
    });
  });
});
