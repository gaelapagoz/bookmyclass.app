import { EmailAutomationEventStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildAutomationScaffoldRows } from "@/lib/email/email-automation-admin-service";

describe("email-automation-admin-service scaffold rows", () => {
  it("returns all expected trigger rows even when templates are empty", () => {
    const rows = buildAutomationScaffoldRows({ templates: [], eventCounts: [], sentLast30: [] });
    expect(rows.length).toBe(16);
    expect(rows.some((row) => row.triggerLabel === "Welcome")).toBe(true);
    expect(rows.some((row) => row.triggerLabel === "Auth Verification Email")).toBe(true);
    expect(rows.some((row) => row.triggerLabel === "Gift Card Issuance")).toBe(true);
    expect(rows.every((row) => row.status === "Draft")).toBe(true);
  });

  it("merges real template rows with expected trigger rows", () => {
    const rows = buildAutomationScaffoldRows({
      templates: [
        {
          id: "tpl-1",
          templateKey: "auth.verify-email",
          subjectTemplate: "Verify your email",
          bodyTemplateJson: { blocks: [{ type: "paragraph", contentHtml: "<p>Hello</p>" }] },
          isActive: true,
        },
      ],
      eventCounts: [{ templateId: "tpl-1", status: EmailAutomationEventStatus.PENDING, count: 3 }],
      sentLast30: [{ templateId: "tpl-1", count: 7 }],
    });
    const authRow = rows.find((row) => row.templateKey === "auth.verify-email");
    expect(authRow).toBeDefined();
    expect(authRow?.exists).toBe(true);
    expect(authRow?.sentLast30Days).toBe(7);
    expect(authRow?.pendingCount).toBe(3);
    const missingRow = rows.find((row) => row.templateKey === "gift-card.issuance");
    expect(missingRow?.exists).toBe(false);
    expect(missingRow?.status).toBe("Draft");
  });
});

