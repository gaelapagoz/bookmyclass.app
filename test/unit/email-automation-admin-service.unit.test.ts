import { EmailAutomationEventStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildAutomationScaffoldRows } from "@/lib/email/email-automation-admin-service";

describe("email-automation-admin-service scaffold rows", () => {
  it("returns all expected trigger rows even when templates are empty", () => {
    const rows = buildAutomationScaffoldRows({ templates: [], eventCounts: [], sentLast30: [] });
    expect(rows.length).toBe(15);
    expect(rows.some((row) => row.triggerLabel === "Welcome")).toBe(false);
    expect(rows.some((row) => row.triggerLabel === "Loyalty Points Expiring")).toBe(true);
    expect(rows.some((row) => row.triggerLabel === "Auth Verification Email")).toBe(true);
    expect(rows.some((row) => row.triggerLabel === "Gift Card Issuance")).toBe(true);
    expect(rows.some((row) => row.templateKey === "purchase.product.confirmation")).toBe(false);
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

  it("shows a legacy-only payment template row under the canonical payment key", () => {
    const rows = buildAutomationScaffoldRows({
      templates: [
        {
          id: "tpl-payment-legacy",
          templateKey: "purchase.product.confirmation",
          subjectTemplate: "Legacy payment subject",
          bodyTemplateJson: { previewText: "Legacy preview", blocks: [{ type: "paragraph", contentHtml: "<p>Legacy body</p>" }] },
          isActive: true,
        },
      ],
      eventCounts: [],
      sentLast30: [],
    });

    const paymentRow = rows.find((row) => row.templateKey === "payment.purchase.confirmation");
    expect(paymentRow).toBeDefined();
    expect(paymentRow?.exists).toBe(true);
    expect(paymentRow?.subject).toBe("Legacy payment subject");
    expect(paymentRow?.previewText).toBe("Legacy preview");
  });
});
