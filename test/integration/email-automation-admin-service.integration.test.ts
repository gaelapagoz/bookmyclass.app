import "./helpers/setup-env";

import { randomUUID } from "node:crypto";
import { EmailAutomationEventStatus, EmailTemplateAuditAction } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AUTOMATION_TEMPLATE_RECONCILIATION_CONFLICT,
  bulkSetAutomationTemplateStatus,
  ensureExpectedAutomationTemplateExists,
  getAutomationScaffoldRows,
  getAutomationAuditLogPage,
  getAutomationTemplateList,
  getAutomationTemplateDetail,
  getAutomationDeadLetterPage,
  replayAutomationDeadLetterEvent,
  setAutomationTemplateStatus,
  sendAutomationTemplateTestEmail,
  updateAutomationTemplate,
} from "@/lib/email/email-automation-admin-service";
import { getCapturedTestEmails, clearCapturedTestEmails } from "@/lib/email/resend-delivery";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

function uniqueKey(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function createTemplate(overrides: {
  templateKey?: string;
  name?: string;
  category?: string;
  isActive?: boolean;
  subjectTemplate?: string;
}) {
  const templateKey = overrides.templateKey ?? uniqueKey("automation.test");
  return prisma.emailTemplate.create({
    data: {
      templateKey,
      name: overrides.name ?? "Test Template",
      category: overrides.category ?? "AUTH",
      subjectTemplate: overrides.subjectTemplate ?? "Hello {{name}}",
      bodyTemplateJson: { blocks: [{ type: "paragraph", text: "Body content." }] },
      contentSchemaVersion: 1,
      isActive: overrides.isActive ?? true,
    },
  });
}

async function createEvent(
  templateId: string,
  status: EmailAutomationEventStatus,
  overrides?: { attempts?: number; maxAttempts?: number; lastError?: string },
) {
  const now = new Date();
  return prisma.emailAutomationEvent.create({
    data: {
      templateId,
      recipientEmail: "test@example.test",
      payloadJson: { token: "abc" },
      idempotencyKey: uniqueKey("idem"),
      status,
      availableAt: now,
      attempts: overrides?.attempts ?? 0,
      maxAttempts: overrides?.maxAttempts ?? 5,
      lastError: overrides?.lastError ?? null,
      deadLetteredAt: status === EmailAutomationEventStatus.DEAD_LETTER ? now : null,
      sentAt: status === EmailAutomationEventStatus.SENT ? now : null,
    },
  });
}

describe("email-automation-admin-service", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.emailTemplate.deleteMany();
    clearCapturedTestEmails();
  });

  describe("getAutomationTemplateList", () => {
    it("returns empty list when no templates exist", async () => {
      const result = await getAutomationTemplateList();
      expect(result).toEqual([]);
    });

    it("returns templates ordered by category then name", async () => {
      await createTemplate({ category: "STORE", name: "Order Confirm" });
      await createTemplate({ category: "AUTH", name: "Welcome" });
      await createTemplate({ category: "AUTH", name: "Password Reset" });

      const result = await getAutomationTemplateList();
      expect(result).toHaveLength(3);
      expect(result[0].category).toBe("AUTH");
      expect(result[0].name).toBe("Password Reset");
      expect(result[1].name).toBe("Welcome");
      expect(result[2].category).toBe("STORE");
    });

    it("returns correct event counts per template", async () => {
      const t1 = await createTemplate({ category: "AUTH" });
      const t2 = await createTemplate({ category: "AUTH" });

      await createEvent(t1.id, EmailAutomationEventStatus.PENDING);
      await createEvent(t1.id, EmailAutomationEventStatus.PENDING);
      await createEvent(t1.id, EmailAutomationEventStatus.SENT);
      await createEvent(t1.id, EmailAutomationEventStatus.DEAD_LETTER);
      await createEvent(t2.id, EmailAutomationEventStatus.SENT);

      const result = await getAutomationTemplateList();
      const r1 = result.find((r) => r.templateKey === t1.templateKey)!;
      const r2 = result.find((r) => r.templateKey === t2.templateKey)!;

      expect(r1.pendingCount).toBe(2);
      expect(r1.sentCount).toBe(1);
      expect(r1.deadLetterCount).toBe(1);
      expect(r2.pendingCount).toBe(0);
      expect(r2.sentCount).toBe(1);
      expect(r2.deadLetterCount).toBe(0);
    });

    it("counts LEASED events in pending bucket", async () => {
      const t = await createTemplate({});
      await createEvent(t.id, EmailAutomationEventStatus.LEASED);

      const [item] = await getAutomationTemplateList();
      expect(item.pendingCount).toBe(1);
    });

    it("migrates the legacy payment template key onto the canonical key", async () => {
      await createTemplate({
        templateKey: "purchase.product.confirmation",
        name: "Buy Product",
        category: "Payment",
        subjectTemplate: "Legacy payment subject",
      });

      await ensureExpectedAutomationTemplateExists("payment.purchase.confirmation");

      const canonical = await prisma.emailTemplate.findUnique({
        where: { templateKey: "payment.purchase.confirmation" },
      });
      const legacy = await prisma.emailTemplate.findUnique({
        where: { templateKey: "purchase.product.confirmation" },
      });

      expect(canonical).not.toBeNull();
      expect(canonical?.name).toBe("Payment Purchase Confirmation");
      expect(canonical?.subjectTemplate).toBe("Legacy payment subject");
      expect(legacy).toBeNull();
    });

    it("promotes legacy content into the canonical payment template during an explicit legacy-key mutation", async () => {
      const canonical = await createTemplate({
        templateKey: "payment.purchase.confirmation",
        name: "Payment Purchase Confirmation",
        category: "Payment",
        subjectTemplate: "Your Studio Purchase Confirmation",
      });
      await prisma.emailTemplate.update({
        where: { id: canonical.id },
        data: {
          bodyTemplateJson: {
            previewText: "",
            blocks: [
              { type: "paragraph", contentHtml: "<p>Purchase Confirmed</p>" },
              { type: "paragraph", contentHtml: "<p>Hi {{contact.fullName}},</p>" },
              { type: "paragraph", contentHtml: "<p>Your purchase is confirmed. Your credits and entitlements are now active in your account.</p>" },
              { type: "paragraph", contentHtml: "<p>Order: {{order.number}}</p>" },
              { type: "paragraph", contentHtml: "<p>Total: {{order.total}}</p>" },
              { type: "paragraph", contentHtml: "<p>View your credits and active plans in Dashboard &gt; Membership &amp; Credits.</p>" },
            ],
          },
        },
      });
      const legacy = await createTemplate({
        templateKey: "purchase.product.confirmation",
        name: "Buy Product",
        category: "Payment",
        subjectTemplate: "Custom legacy payment subject",
      });
      await prisma.emailTemplate.update({
        where: { id: legacy.id },
        data: {
          bodyTemplateJson: {
            previewText: "Custom legacy preview",
            blocks: [{ type: "paragraph", contentHtml: "<p>Legacy custom payment copy.</p>" }],
          },
          isActive: false,
        },
      });
      await createEvent(legacy.id, EmailAutomationEventStatus.DEAD_LETTER, { lastError: "legacy-template-error" });

      await setAutomationTemplateStatus({
        templateKey: "purchase.product.confirmation",
        isActive: false,
      });

      const rows = await getAutomationScaffoldRows();
      const paymentRow = rows.find((row) => row.templateKey === "payment.purchase.confirmation");
      const detail = await getAutomationTemplateDetail("payment.purchase.confirmation");
      const deadLetters = await getAutomationDeadLetterPage("payment.purchase.confirmation", 1, 20);

      expect(rows.some((row) => row.templateKey === "purchase.product.confirmation")).toBe(false);
      expect(paymentRow?.previewText).toBe("Custom legacy preview");
      expect(detail?.subjectTemplate).toBe("Custom legacy payment subject");
      expect(detail?.isActive).toBe(false);
      expect(deadLetters.items).toHaveLength(1);
      expect(deadLetters.items[0].lastError).toBe("legacy-template-error");
    });

    it("does not reconcile or throw on read when both legacy and canonical payment templates are customized", async () => {
      await createTemplate({
        templateKey: "payment.purchase.confirmation",
        name: "Payment Purchase Confirmation",
        category: "Payment",
        subjectTemplate: "Canonical custom subject",
      });
      await createTemplate({
        templateKey: "purchase.product.confirmation",
        name: "Buy Product",
        category: "Payment",
        subjectTemplate: "Legacy custom subject",
      });

      const rows = await getAutomationScaffoldRows();
      const paymentRow = rows.find((row) => row.templateKey === "payment.purchase.confirmation");

      const canonical = await prisma.emailTemplate.findUnique({
        where: { templateKey: "payment.purchase.confirmation" },
      });
      const legacy = await prisma.emailTemplate.findUnique({
        where: { templateKey: "purchase.product.confirmation" },
      });
      expect(canonical).not.toBeNull();
      expect(legacy).not.toBeNull();
      expect(paymentRow?.subject).toBe("Canonical custom subject");
    });

    it("fails closed on legacy-key mutation when both legacy and canonical payment templates are customized", async () => {
      await createTemplate({
        templateKey: "payment.purchase.confirmation",
        name: "Payment Purchase Confirmation",
        category: "Payment",
        subjectTemplate: "Canonical custom subject",
      });
      await createTemplate({
        templateKey: "purchase.product.confirmation",
        name: "Buy Product",
        category: "Payment",
        subjectTemplate: "Legacy custom subject",
      });

      await expect(
        setAutomationTemplateStatus({
          templateKey: "purchase.product.confirmation",
          isActive: false,
        }),
      ).rejects.toThrow(AUTOMATION_TEMPLATE_RECONCILIATION_CONFLICT);
    });

    it("writes an audit log entry for automatic reconciliation", async () => {
      await createTemplate({
        templateKey: "purchase.product.confirmation",
        name: "Buy Product",
        category: "Payment",
        subjectTemplate: "Legacy payment subject",
      });

      await ensureExpectedAutomationTemplateExists("payment.purchase.confirmation");

      const canonical = await prisma.emailTemplate.findUniqueOrThrow({
        where: { templateKey: "payment.purchase.confirmation" },
      });
      const logs = await prisma.emailTemplateAuditLog.findMany({
        where: { templateId: canonical.id },
        orderBy: { createdAt: "asc" },
      });

      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe(EmailTemplateAuditAction.UPDATED);
      expect(logs[0].beforeJson).toMatchObject({
        reconciliation: {
          legacyTemplateKey: "purchase.product.confirmation",
          canonicalTemplateKey: "payment.purchase.confirmation",
          strategy: "rename-legacy-to-canonical",
        },
      });
    });
  });

  describe("getAutomationTemplateDetail", () => {
    it("returns null for unknown templateKey", async () => {
      const result = await getAutomationTemplateDetail("does-not-exist");
      expect(result).toBeNull();
    });

    it("returns correct counts and metadata", async () => {
      const t = await createTemplate({ name: "Verify Email", category: "AUTH" });
      await createEvent(t.id, EmailAutomationEventStatus.PENDING);
      await createEvent(t.id, EmailAutomationEventStatus.SENT);
      await createEvent(t.id, EmailAutomationEventStatus.DEAD_LETTER);

      const result = await getAutomationTemplateDetail(t.templateKey);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Verify Email");
      expect(result!.totalEvents).toBe(3);
      expect(result!.pendingCount).toBe(1);
      expect(result!.sentCount).toBe(1);
      expect(result!.deadLetterCount).toBe(1);
    });

    it("returns lastHeartbeatAt from most recent heartbeat", async () => {
      const t = await createTemplate({});
      const heartbeatTime = new Date("2026-01-15T10:00:00Z");
      await prisma.emailDispatcherHeartbeat.create({
        data: {
          workerId: uniqueKey("worker"),
          lastHeartbeatAt: heartbeatTime,
          activeLeaseCount: 0,
        },
      });

      const result = await getAutomationTemplateDetail(t.templateKey);
      expect(result!.lastHeartbeatAt?.toISOString()).toBe(heartbeatTime.toISOString());
    });

    it("returns null lastHeartbeatAt when no heartbeat exists", async () => {
      const t = await createTemplate({});
      const result = await getAutomationTemplateDetail(t.templateKey);
      expect(result!.lastHeartbeatAt).toBeNull();
    });

    it("returns bodyTemplateJson and it is non-null", async () => {
      const t = await createTemplate({});
      const result = await getAutomationTemplateDetail(t.templateKey);
      expect(result!.bodyTemplateJson).not.toBeNull();
      expect(result!.bodyTemplateJson).toMatchObject({ blocks: expect.any(Array) });
    });
  });

  describe("getAutomationDeadLetterPage", () => {
    it("returns empty page for unknown templateKey", async () => {
      const result = await getAutomationDeadLetterPage("does-not-exist", 1, 20);
      expect(result.items).toEqual([]);
      expect(result.totalItems).toBe(0);
    });

    it("returns only DEAD_LETTER events", async () => {
      const t = await createTemplate({});
      await createEvent(t.id, EmailAutomationEventStatus.PENDING);
      await createEvent(t.id, EmailAutomationEventStatus.SENT);
      const dl = await createEvent(t.id, EmailAutomationEventStatus.DEAD_LETTER, { lastError: "timeout" });

      const result = await getAutomationDeadLetterPage(t.templateKey, 1, 20);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(dl.id);
      expect(result.items[0].lastError).toBe("timeout");
      expect(result.totalItems).toBe(1);
    });

    it("paginates correctly", async () => {
      const t = await createTemplate({});
      for (let i = 0; i < 5; i++) {
        await createEvent(t.id, EmailAutomationEventStatus.DEAD_LETTER);
      }

      const page1 = await getAutomationDeadLetterPage(t.templateKey, 1, 3);
      const page2 = await getAutomationDeadLetterPage(t.templateKey, 2, 3);
      expect(page1.items).toHaveLength(3);
      expect(page2.items).toHaveLength(2);
      expect(page1.totalItems).toBe(5);
      expect(page1.totalPages).toBe(2);
    });
  });

  describe("getAutomationAuditLogPage", () => {
    it("returns empty page for unknown templateKey", async () => {
      const result = await getAutomationAuditLogPage("does-not-exist", 1, 20);
      expect(result.items).toEqual([]);
      expect(result.totalItems).toBe(0);
    });

    it("returns audit log entries for template", async () => {
      const t = await createTemplate({});
      await prisma.emailTemplateAuditLog.create({
        data: {
          templateId: t.id,
          action: EmailTemplateAuditAction.CREATED,
        },
      });
      await prisma.emailTemplateAuditLog.create({
        data: {
          templateId: t.id,
          action: EmailTemplateAuditAction.UPDATED,
        },
      });

      const result = await getAutomationAuditLogPage(t.templateKey, 1, 20);
      expect(result.totalItems).toBe(2);
      expect(result.items.map((i) => i.action)).toContain(EmailTemplateAuditAction.CREATED);
      expect(result.items.map((i) => i.action)).toContain(EmailTemplateAuditAction.UPDATED);
    });

    it("does not return audit logs from a different template", async () => {
      const t1 = await createTemplate({});
      const t2 = await createTemplate({});
      await prisma.emailTemplateAuditLog.create({
        data: { templateId: t2.id, action: EmailTemplateAuditAction.CREATED },
      });

      const result = await getAutomationAuditLogPage(t1.templateKey, 1, 20);
      expect(result.totalItems).toBe(0);
    });

    it("returns canonical audit logs when queried with the legacy payment template key", async () => {
      await createTemplate({
        templateKey: "purchase.product.confirmation",
        name: "Buy Product",
        category: "Payment",
        subjectTemplate: "Legacy payment subject",
      });

      await ensureExpectedAutomationTemplateExists("payment.purchase.confirmation");

      const result = await getAutomationAuditLogPage("purchase.product.confirmation", 1, 20);
      expect(result.totalItems).toBe(1);
      expect(result.items[0].action).toBe(EmailTemplateAuditAction.UPDATED);
    });
  });

  describe("legacy payment alias admin mutations", () => {
    it("updates template status through the legacy payment key", async () => {
      await createTemplate({
        templateKey: "purchase.product.confirmation",
        name: "Buy Product",
        category: "Payment",
        isActive: true,
      });

      await setAutomationTemplateStatus({
        templateKey: "purchase.product.confirmation",
        isActive: false,
      });

      const canonical = await prisma.emailTemplate.findUniqueOrThrow({
        where: { templateKey: "payment.purchase.confirmation" },
      });
      expect(canonical.isActive).toBe(false);
    });

    it("bulk-updates template status through the legacy payment key", async () => {
      await createTemplate({
        templateKey: "purchase.product.confirmation",
        name: "Buy Product",
        category: "Payment",
        isActive: false,
      });

      const updatedCount = await bulkSetAutomationTemplateStatus({
        templateKeys: ["purchase.product.confirmation"],
        isActive: true,
      });

      const canonical = await prisma.emailTemplate.findUniqueOrThrow({
        where: { templateKey: "payment.purchase.confirmation" },
      });
      expect(updatedCount).toBe(1);
      expect(canonical.isActive).toBe(true);
    });

    it("updates template content through the legacy payment key", async () => {
      await createTemplate({
        templateKey: "purchase.product.confirmation",
        name: "Buy Product",
        category: "Payment",
      });

      await updateAutomationTemplate({
        templateKey: "purchase.product.confirmation",
        name: "Payment Purchase Confirmation",
        subjectTemplate: "Updated subject {{name}}",
        bodyTemplateJson: {
          blocks: [{ type: "paragraph", text: "Updated payment body." }],
        },
      });

      const canonical = await prisma.emailTemplate.findUniqueOrThrow({
        where: { templateKey: "payment.purchase.confirmation" },
      });
      expect(canonical.subjectTemplate).toBe("Updated subject {{name}}");
    });

    it("replays dead-letter events through the legacy payment key", async () => {
      const legacy = await createTemplate({
        templateKey: "purchase.product.confirmation",
        name: "Buy Product",
        category: "Payment",
      });
      const event = await createEvent(legacy.id, EmailAutomationEventStatus.DEAD_LETTER, {
        attempts: 3,
        lastError: "legacy dead letter",
      });

      const result = await replayAutomationDeadLetterEvent({
        eventId: event.id,
        templateKey: "purchase.product.confirmation",
      });

      const updated = await prisma.emailAutomationEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(result.replayed).toBe(true);
      expect(updated.status).toBe(EmailAutomationEventStatus.PENDING);
    });
  });

  describe("draft automation activation", () => {
    it("creates missing expected automations as active without reactivating existing paused templates", async () => {
      await ensureExpectedAutomationTemplateExists("booking.class-booked");
      const created = await prisma.emailTemplate.findUnique({
        where: { templateKey: "booking.class-booked" },
      });

      const paused = await createTemplate({
        templateKey: "booking.class-reminder",
        isActive: false,
      });
      await ensureExpectedAutomationTemplateExists("booking.class-reminder");
      const preserved = await prisma.emailTemplate.findUnique({
        where: { id: paused.id },
      });

      expect(created?.isActive).toBe(true);
      expect(preserved?.isActive).toBe(false);
    });

    it("creates and activates an expected draft automation on first activation", async () => {
      await setAutomationTemplateStatus({
        templateKey: "booking.welcome",
        isActive: true,
      });

      const created = await prisma.emailTemplate.findUnique({
        where: { templateKey: "booking.welcome" },
      });

      expect(created).not.toBeNull();
      expect(created?.isActive).toBe(true);
      expect(created?.name).toBe("Welcome");
    });

    it("bulk-creates and activates expected draft automations", async () => {
      const updatedCount = await bulkSetAutomationTemplateStatus({
        templateKeys: ["booking.class-cancelled", "booking.class-reminder"],
        isActive: true,
      });

      const templates = await prisma.emailTemplate.findMany({
        where: {
          templateKey: { in: ["booking.class-cancelled", "booking.class-reminder"] },
        },
        orderBy: { templateKey: "asc" },
      });

      expect(updatedCount).toBe(0);
      expect(templates).toHaveLength(2);
      expect(templates.every((template) => template.isActive)).toBe(true);
    });
  });

  describe("replayAutomationDeadLetterEvent", () => {
    it("transitions a DEAD_LETTER event back to PENDING with reset state", async () => {
      const t = await createTemplate({});
      const event = await createEvent(t.id, EmailAutomationEventStatus.DEAD_LETTER, {
        attempts: 5,
        lastError: "connection refused",
      });

      const result = await replayAutomationDeadLetterEvent({ eventId: event.id, templateKey: t.templateKey });
      expect(result.replayed).toBe(true);

      const updated = await prisma.emailAutomationEvent.findUnique({ where: { id: event.id } });
      expect(updated!.status).toBe(EmailAutomationEventStatus.PENDING);
      expect(updated!.attempts).toBe(0);
      expect(updated!.deadLetteredAt).toBeNull();
      expect(updated!.lastError).toBeNull();
      expect(updated!.leaseOwner).toBeNull();
      expect(updated!.leasedAt).toBeNull();
      expect(updated!.leaseExpiresAt).toBeNull();
    });

    it("returns replayed=false for a non-dead-letter event", async () => {
      const t = await createTemplate({});
      const event = await createEvent(t.id, EmailAutomationEventStatus.SENT);

      const result = await replayAutomationDeadLetterEvent({ eventId: event.id, templateKey: t.templateKey });
      expect(result.replayed).toBe(false);

      const unchanged = await prisma.emailAutomationEvent.findUnique({ where: { id: event.id } });
      expect(unchanged!.status).toBe(EmailAutomationEventStatus.SENT);
    });

    it("returns replayed=false for a non-existent event", async () => {
      const t = await createTemplate({});
      const result = await replayAutomationDeadLetterEvent({ eventId: "nonexistent-id", templateKey: t.templateKey });
      expect(result.replayed).toBe(false);
    });

    it("returns replayed=false for unknown templateKey", async () => {
      const t = await createTemplate({});
      const event = await createEvent(t.id, EmailAutomationEventStatus.DEAD_LETTER);

      const result = await replayAutomationDeadLetterEvent({ eventId: event.id, templateKey: "unknown.template" });
      expect(result.replayed).toBe(false);
    });

    it("returns replayed=false when event belongs to a different template (ownership gate)", async () => {
      const t1 = await createTemplate({});
      const t2 = await createTemplate({});
      const event = await createEvent(t1.id, EmailAutomationEventStatus.DEAD_LETTER);

      const result = await replayAutomationDeadLetterEvent({ eventId: event.id, templateKey: t2.templateKey });
      expect(result.replayed).toBe(false);

      const unchanged = await prisma.emailAutomationEvent.findUnique({ where: { id: event.id } });
      expect(unchanged!.status).toBe(EmailAutomationEventStatus.DEAD_LETTER);
    });

    it("throws on invalid input", async () => {
      await expect(replayAutomationDeadLetterEvent({ eventId: "", templateKey: "some.key" })).rejects.toThrow();
    });
  });

  describe("updateAutomationTemplate", () => {
    it("updates name, subject, and body and writes an audit log entry", async () => {
      const t = await createTemplate({ name: "Old Name", subjectTemplate: "Old subject" });

      await updateAutomationTemplate({
        templateKey: t.templateKey,
        name: "New Name",
        subjectTemplate: "New subject {{name}}",
        bodyTemplateJson: {
          blocks: [{ type: "paragraph", text: "Updated body." }],
        },
      });

      const updated = await prisma.emailTemplate.findUnique({ where: { templateKey: t.templateKey } });
      expect(updated!.name).toBe("New Name");
      expect(updated!.subjectTemplate).toBe("New subject {{name}}");

      const auditLogs = await prisma.emailTemplateAuditLog.findMany({ where: { templateId: t.id } });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe(EmailTemplateAuditAction.UPDATED);
    });

    it("throws for unknown templateKey", async () => {
      await expect(
        updateAutomationTemplate({
          templateKey: "unknown.key",
          name: "Name",
          subjectTemplate: "Subject",
          bodyTemplateJson: { blocks: [{ type: "paragraph", text: "Body." }] },
        }),
      ).rejects.toThrow("AUTOMATION_TEMPLATE_NOT_FOUND");
    });

    it("throws for invalid body JSON (fails schema validation)", async () => {
      const t = await createTemplate({});
      await expect(
        updateAutomationTemplate({
          templateKey: t.templateKey,
          name: "Name",
          subjectTemplate: "Subject",
          bodyTemplateJson: { blocks: [] },
        }),
      ).rejects.toThrow();
    });

    it("records the actorId in the audit log when provided", async () => {
      const t = await createTemplate({});
      const user = await prisma.user.create({
        data: {
          name: "Admin",
          email: `admin-${randomUUID()}@example.test`,
          role: "ADMIN",
          activationStatus: "ACTIVE",
        },
      });

      await updateAutomationTemplate({
        templateKey: t.templateKey,
        name: "Updated",
        subjectTemplate: "Subject",
        bodyTemplateJson: { blocks: [{ type: "paragraph", text: "Body." }] },
        actorId: user.id,
      });

      const [log] = await prisma.emailTemplateAuditLog.findMany({ where: { templateId: t.id } });
      expect(log.actorId).toBe(user.id);
    });
  });

  describe("sendAutomationTemplateTestEmail", () => {
    it("sends a test email for an active template", async () => {
      const t = await createTemplate({ subjectTemplate: "Hello {{name}}" });

      await sendAutomationTemplateTestEmail({ templateKey: t.templateKey, toEmail: "admin@example.test" });

      const captured = getCapturedTestEmails();
      expect(captured).toHaveLength(1);
      expect(captured[0].to).toContain("admin@example.test");
      expect(captured[0].subject).toMatch(/^\[TEST\]/);
      expect(captured[0].context).toContain("automation-test:");
    });

    it("strips payload tokens from subject in test sends", async () => {
      const t = await createTemplate({ subjectTemplate: "Hello {{firstName}} {{lastName}}" });

      await sendAutomationTemplateTestEmail({ templateKey: t.templateKey, toEmail: "admin@example.test" });

      const [email] = getCapturedTestEmails();
      expect(email.subject).not.toContain("{{");
    });

    it("throws for unknown template key", async () => {
      await expect(
        sendAutomationTemplateTestEmail({ templateKey: "unknown.template", toEmail: "admin@example.test" }),
      ).rejects.toThrow("AUTOMATION_TEST_EMAIL_TEMPLATE_NOT_FOUND");
    });

    it("throws for inactive template", async () => {
      const t = await createTemplate({ isActive: false });

      await expect(
        sendAutomationTemplateTestEmail({ templateKey: t.templateKey, toEmail: "admin@example.test" }),
      ).rejects.toThrow("AUTOMATION_TEST_EMAIL_TEMPLATE_NOT_FOUND");
    });

    it("throws on invalid email", async () => {
      const t = await createTemplate({});
      await expect(
        sendAutomationTemplateTestEmail({ templateKey: t.templateKey, toEmail: "not-an-email" }),
      ).rejects.toThrow();
    });
  });
});
