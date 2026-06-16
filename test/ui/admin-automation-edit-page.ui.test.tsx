/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    redirect: redirectMock,
  };
});

vi.mock("@/app/admin/(private)/automations/actions", () => ({
  updateAutomationTemplateAction: vi.fn(),
}));

vi.mock("@/components/admin/automations/AutomationTemplateEditor", () => ({
  default: ({
    templateKey,
    defaultName,
    defaultSubjectTemplate,
  }: {
    templateKey: string;
    defaultName: string;
    defaultSubjectTemplate: string;
  }) => (
    <div>
      <div>{templateKey}</div>
      <div>{defaultName}</div>
      <div>{defaultSubjectTemplate}</div>
    </div>
  ),
}));

vi.mock("@/lib/email/email-automation-admin-service", () => ({
  getAutomationTemplateDetail: vi.fn(),
  ensureExpectedAutomationTemplateExists: vi.fn(async () => undefined),
}));

import {
  ensureExpectedAutomationTemplateExists,
  getAutomationTemplateDetail,
} from "@/lib/email/email-automation-admin-service";
import AdminAutomationTemplateEditPage from "../../src/app/admin/(private)/automations/[templateKey]/edit/page";

describe("admin automation edit page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the edit page without calling the mutating ensure helper", async () => {
    vi.mocked(getAutomationTemplateDetail).mockResolvedValue({
      id: "tpl-1",
      templateKey: "payment.purchase.confirmation",
      name: "Payment Purchase Confirmation",
      category: "Payment",
      isActive: true,
      subjectTemplate: "Legacy payment subject",
      bodyTemplateJson: { previewText: "Legacy preview", blocks: [{ type: "paragraph", contentHtml: "<p>Legacy body</p>" }] },
      contentSchemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      totalEvents: 0,
      pendingCount: 0,
      sentCount: 0,
      deadLetterCount: 0,
      lastHeartbeatAt: null,
    });

    render(
      await AdminAutomationTemplateEditPage({
        params: Promise.resolve({ templateKey: "purchase.product.confirmation" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(vi.mocked(getAutomationTemplateDetail)).toHaveBeenCalledWith("purchase.product.confirmation");
    expect(vi.mocked(ensureExpectedAutomationTemplateExists)).not.toHaveBeenCalled();
    expect(screen.getByText("Payment Purchase Confirmation")).toBeInTheDocument();
    expect(screen.getByText("Legacy payment subject")).toBeInTheDocument();
  });
});
