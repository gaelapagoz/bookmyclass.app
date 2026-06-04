import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCapturedTestEmails,
  getCapturedTestEmails,
  isRealEmailDeliveryEnabled,
  sendEmailViaResend,
} from "@/lib/email/resend-delivery";

describe("resend-delivery", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearCapturedTestEmails();
  });

  it("bypasses provider and captures payload in deterministic test mode", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");

    const result = await sendEmailViaResend({
      context: "unit-test",
      from: "Book My Class <no-reply@bookmyclass.app>",
      to: "client@example.test",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(result.sent).toBe(true);
    expect(result.bypassed).toBe(true);
    expect(result.provider).toBe("test-bypass");

    const outbox = getCapturedTestEmails();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.to).toEqual(["client@example.test"]);
    expect(outbox[0]?.context).toBe("unit-test");
  });

  it("enforces @bookmyclass.app sender policy in production delivery mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "test-key");

    await expect(
      sendEmailViaResend({
        context: "unit-test",
        from: "Book My Class <no-reply@example.test>",
        to: "client@example.test",
        subject: "Test",
        html: "<p>Hello</p>",
      }),
    ).rejects.toThrow("@bookmyclass.app");
  });

  it("suppresses provider delivery by default outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_REAL_EMAILS_IN_NON_PRODUCTION", "");

    const fetchMock = vi.fn();
    const consoleInfoMock = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendEmailViaResend({
      context: "unit-test",
      from: "Book My Class <no-reply@example.test>",
      to: "client@example.test",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(isRealEmailDeliveryEnabled()).toBe(false);
    expect(result.sent).toBe(true);
    expect(result.bypassed).toBe(true);
    expect(result.provider).toBe("suppressed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleInfoMock).toHaveBeenCalledWith(
      "[email] suppressed non-production provider delivery",
      expect.objectContaining({
        context: "unit-test",
        subject: "Test",
        to: ["client@example.test"],
      }),
    );
  });

  it("calls resend provider when explicitly opted in outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_REAL_EMAILS_IN_NON_PRODUCTION", "1");
    vi.stubEnv("RESEND_API_KEY", "test-key");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "email_123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendEmailViaResend({
      context: "unit-test",
      from: "Book My Class <no-reply@example.test>",
      to: "client@example.test",
      subject: "Test",
      html: "<p>Hello</p>",
      replyTo: "support@example.test",
    });

    expect(result.sent).toBe(true);
    expect(result.bypassed).toBe(false);
    expect(result.provider).toBe("resend");
    expect(result.messageId).toBe("email_123");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
