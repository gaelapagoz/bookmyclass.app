import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/lib/security/same-origin", () => ({
  assertSameOriginServerAction: vi.fn(async () => undefined),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: vi.fn(async () => {
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!session?.user?.id) throw new Error("UNAUTHENTICATED");
    return { ...session, user: { ...session.user, role: "ADMIN" } };
  }),
}));

const {
  bulkSetAutomationTemplateStatusMock,
  replayAutomationDeadLetterEventMock,
  setAutomationTemplateStatusMock,
  sendAutomationTemplateTestEmailMock,
  updateAutomationTemplateMock,
} = vi.hoisted(() => ({
  bulkSetAutomationTemplateStatusMock: vi.fn(async () => 0),
  replayAutomationDeadLetterEventMock: vi.fn(async () => ({ replayed: true })),
  setAutomationTemplateStatusMock: vi.fn(async () => undefined),
  sendAutomationTemplateTestEmailMock: vi.fn(async () => undefined),
  updateAutomationTemplateMock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/email/email-automation-admin-service", () => ({
  bulkSetAutomationTemplateStatus: bulkSetAutomationTemplateStatusMock,
  replayAutomationDeadLetterEvent: replayAutomationDeadLetterEventMock,
  setAutomationTemplateStatus: setAutomationTemplateStatusMock,
  sendAutomationTemplateTestEmail: sendAutomationTemplateTestEmailMock,
  updateAutomationTemplate: updateAutomationTemplateMock,
}));

import { auth } from "@/auth";
import {
  bulkSetAutomationTemplateStatusAction,
  replayAutomationDeadLetterAction,
  setAutomationTemplateStatusAction,
  sendAutomationTemplateTestEmailAction,
  updateAutomationTemplateAction,
} from "@/app/admin/(private)/automations/actions";

function makeFormData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    fd.append(key, value);
  }
  return fd;
}

function lastRedirectUrl(): string {
  const calls = vi.mocked(redirectMock).mock.calls;
  if (calls.length === 0) throw new Error("redirect was never called");
  return calls[calls.length - 1][0] as string;
}

describe("email-automation-admin-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin-user-id", email: "admin@example.com", role: "ADMIN" },
    } as Awaited<ReturnType<typeof auth>>);
  });

  describe("replayAutomationDeadLetterAction", () => {
    it("redirects to list when form is invalid (missing eventId)", async () => {
      const fd = makeFormData({ templateKey: "auth.verify-email", page: "1" });
      await expect(replayAutomationDeadLetterAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      expect(lastRedirectUrl()).toContain("/admin/automations");
    });

    it("calls service and redirects with replaySuccess=1 on valid input", async () => {
      const fd = makeFormData({ eventId: "evt-1", templateKey: "auth.verify-email", page: "1" });
      await expect(replayAutomationDeadLetterAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      expect(replayAutomationDeadLetterEventMock).toHaveBeenCalledWith({
        eventId: "evt-1",
        templateKey: "auth.verify-email",
      });
      const redirectUrl = lastRedirectUrl();
      expect(redirectUrl).toContain("replaySuccess=1");
    });

    it("redirects with replayError=1 when service returns replayed=false", async () => {
      replayAutomationDeadLetterEventMock.mockResolvedValueOnce({ replayed: false });
      const fd = makeFormData({ eventId: "evt-1", templateKey: "auth.verify-email", page: "1" });
      await expect(replayAutomationDeadLetterAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      const redirectUrl = lastRedirectUrl();
      expect(redirectUrl).toContain("replayError=1");
    });

    it("blocks unauthenticated requests", async () => {
      vi.mocked(auth).mockResolvedValueOnce(null);
      const fd = makeFormData({ eventId: "evt-1", templateKey: "auth.verify-email" });
      await expect(replayAutomationDeadLetterAction(fd)).rejects.toThrow("UNAUTHENTICATED");
    });
  });

  describe("updateAutomationTemplateAction", () => {
    const validContent = JSON.stringify({ blocks: [{ type: "paragraph", contentHtml: "<p>Hello</p>" }] });

    it("redirects to edit page with error=invalid_form when form is invalid", async () => {
      const fd = makeFormData({
        templateKey: "auth.verify-email",
        name: "",
        subjectTemplate: "Subject",
        contentJson: validContent,
      });
      await expect(updateAutomationTemplateAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      const redirectUrl = lastRedirectUrl();
      expect(redirectUrl).toContain("/admin/automations/auth.verify-email/edit");
      expect(redirectUrl).toContain("error=invalid_form");
    });

    it("redirects to list when templateKey is absent", async () => {
      const fd = makeFormData({ name: "", subjectTemplate: "Subject", contentJson: validContent });
      await expect(updateAutomationTemplateAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      const redirectUrl = lastRedirectUrl();
      expect(redirectUrl).toBe("/admin/automations");
    });

    it("calls service and redirects with success=1 on valid input", async () => {
      const fd = makeFormData({
        templateKey: "auth.verify-email",
        name: "Verify Email",
        subjectTemplate: "Verify your email",
        contentJson: validContent,
      });
      await expect(updateAutomationTemplateAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      expect(updateAutomationTemplateMock).toHaveBeenCalledWith(
        expect.objectContaining({ templateKey: "auth.verify-email", name: "Verify Email" }),
      );
      const redirectUrl = lastRedirectUrl();
      expect(redirectUrl).toContain("/admin/automations/auth.verify-email/edit");
      expect(redirectUrl).toContain("success=1");
    });

    it("redirects with error=save_failed when service throws", async () => {
      updateAutomationTemplateMock.mockRejectedValueOnce(new Error("AUTOMATION_TEMPLATE_NOT_FOUND"));
      const fd = makeFormData({
        templateKey: "auth.verify-email",
        name: "Verify Email",
        subjectTemplate: "Verify your email",
        contentJson: validContent,
      });
      await expect(updateAutomationTemplateAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      const redirectUrl = lastRedirectUrl();
      expect(redirectUrl).toContain("error=save_failed");
    });

    it("blocks unauthenticated requests", async () => {
      vi.mocked(auth).mockResolvedValueOnce(null);
      const fd = makeFormData({
        templateKey: "auth.verify-email",
        name: "Verify Email",
        subjectTemplate: "Subject",
        contentJson: validContent,
      });
      await expect(updateAutomationTemplateAction(fd)).rejects.toThrow("UNAUTHENTICATED");
    });

    it("rejects contentJson exceeding 200k characters", async () => {
      const bigContent = JSON.stringify({ blocks: [{ type: "paragraph", contentHtml: "<p>" + "x".repeat(210_000) + "</p>" }] });
      const fd = makeFormData({
        templateKey: "auth.verify-email",
        name: "Verify Email",
        subjectTemplate: "Subject",
        contentJson: bigContent,
      });
      await expect(updateAutomationTemplateAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      expect(updateAutomationTemplateMock).not.toHaveBeenCalled();
    });
  });

  describe("sendAutomationTemplateTestEmailAction", () => {
    it("redirects to list when form is invalid (bad email)", async () => {
      const fd = makeFormData({ templateKey: "auth.verify-email", toEmail: "not-an-email" });
      await expect(sendAutomationTemplateTestEmailAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      expect(sendAutomationTemplateTestEmailMock).not.toHaveBeenCalled();
    });

    it("calls service and redirects with testSuccess=1 on valid input", async () => {
      const fd = makeFormData({ templateKey: "auth.verify-email", toEmail: "admin@example.com" });
      await expect(sendAutomationTemplateTestEmailAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      expect(sendAutomationTemplateTestEmailMock).toHaveBeenCalledWith({
        templateKey: "auth.verify-email",
        toEmail: "admin@example.com",
      });
      const redirectUrl = lastRedirectUrl();
      expect(redirectUrl).toContain("testSuccess=1");
    });

    it("redirects with testError=1 when service throws", async () => {
      sendAutomationTemplateTestEmailMock.mockRejectedValueOnce(new Error("AUTOMATION_TEST_EMAIL_TEMPLATE_NOT_FOUND"));
      const fd = makeFormData({ templateKey: "auth.verify-email", toEmail: "admin@example.com" });
      await expect(sendAutomationTemplateTestEmailAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      const redirectUrl = lastRedirectUrl();
      expect(redirectUrl).toContain("testError=1");
    });

    it("blocks unauthenticated requests", async () => {
      vi.mocked(auth).mockResolvedValueOnce(null);
      const fd = makeFormData({ templateKey: "auth.verify-email", toEmail: "admin@example.com" });
      await expect(sendAutomationTemplateTestEmailAction(fd)).rejects.toThrow("UNAUTHENTICATED");
    });
  });

  describe("setAutomationTemplateStatusAction", () => {
    it("activates template on valid input", async () => {
      const fd = makeFormData({ templateKey: "booking.welcome", status: "active" });
      await expect(setAutomationTemplateStatusAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      expect(setAutomationTemplateStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({ templateKey: "booking.welcome", isActive: true }),
      );
    });
  });

  describe("bulkSetAutomationTemplateStatusAction", () => {
    it("updates selected template keys", async () => {
      const fd = new FormData();
      fd.append("status", "paused");
      fd.append("templateKey", "booking.welcome");
      fd.append("templateKey", "auth.verify-email");
      await expect(bulkSetAutomationTemplateStatusAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      expect(bulkSetAutomationTemplateStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false, templateKeys: ["booking.welcome", "auth.verify-email"] }),
      );
    });
  });
});
