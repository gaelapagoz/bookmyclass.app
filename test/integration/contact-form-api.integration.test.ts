import "./helpers/setup-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmailViaResendMock = vi.fn();

vi.mock("../../src/lib/email/resend-delivery", () => ({
  sendEmailViaResend: (...args: unknown[]) => sendEmailViaResendMock(...args),
}));

import { POST as submitContactForm } from "../../src/app/api/contact-form/route";

const sameOriginJsonHeaders = {
  "content-type": "application/json",
  origin: "http://localhost",
  referer: "http://localhost/test",
  "x-forwarded-host": "localhost",
  "x-forwarded-proto": "http",
};

describe("POST /api/contact-form", () => {
  const originalEnv = {
    CONTACT_FORM_TO_EMAIL: process.env.CONTACT_FORM_TO_EMAIL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };

  beforeEach(() => {
    sendEmailViaResendMock.mockReset();
    sendEmailViaResendMock.mockResolvedValue({
      sent: true,
      provider: "resend",
      messageId: "email_123",
      bypassed: false,
    });

    process.env.CONTACT_FORM_TO_EMAIL = "gaelapagoz@gmail.com";
    process.env.RESEND_API_KEY = "test-resend-key";
    process.env.EMAIL_FROM = "BookMyClass <no-reply@bookmyclass.app>";
  });

  afterEach(() => {
    process.env.CONTACT_FORM_TO_EMAIL = originalEnv.CONTACT_FORM_TO_EMAIL;
    process.env.RESEND_API_KEY = originalEnv.RESEND_API_KEY;
    process.env.EMAIL_FROM = originalEnv.EMAIL_FROM;
  });

  it("accepts a valid contact form payload", async () => {
    const response = await submitContactForm(
      new Request("http://localhost/api/contact-form", {
        method: "POST",
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({
          name: "Studio Owner",
          email: "owner@example.test",
          message: "I want to schedule a demo for my studio team this week.",
          honeypot: "",
        }),
      }),
    );
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(sendEmailViaResendMock).toHaveBeenCalledOnce();
  });

  it("returns a safe 400 response on validation failure", async () => {
    const response = await submitContactForm(
      new Request("http://localhost/api/contact-form", {
        method: "POST",
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({
          name: "",
          email: "not-an-email",
          message: "",
          honeypot: "",
        }),
      }),
    );
    const body = (await response.json()) as { ok: boolean; message: string };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.message).toContain("contact");
    expect(sendEmailViaResendMock).not.toHaveBeenCalled();
  });

  it("rejects honeypot payloads without sending email", async () => {
    const response = await submitContactForm(
      new Request("http://localhost/api/contact-form", {
        method: "POST",
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({
          name: "Bot User",
          email: "bot@example.test",
          message: "I want details about pricing for multiple studio locations.",
          honeypot: "https://spam.example",
        }),
      }),
    );
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(sendEmailViaResendMock).not.toHaveBeenCalled();
  });
});
