import "./helpers/setup-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "./helpers/reset-db";

const sendEmailViaResendMock = vi.fn();

vi.mock("@/lib/email/resend-delivery", () => ({
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
    NODE_ENV: process.env.NODE_ENV,
    TRUST_X_FORWARDED_FOR: process.env.TRUST_X_FORWARDED_FOR,
  };

  beforeEach(() => {
    return resetDb().then(() => {
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
  });

  afterEach(() => {
    process.env.CONTACT_FORM_TO_EMAIL = originalEnv.CONTACT_FORM_TO_EMAIL;
    process.env.RESEND_API_KEY = originalEnv.RESEND_API_KEY;
    process.env.EMAIL_FROM = originalEnv.EMAIL_FROM;
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.TRUST_X_FORWARDED_FOR = originalEnv.TRUST_X_FORWARDED_FOR;
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
        headers: {
          ...sameOriginJsonHeaders,
          "x-forwarded-for": "198.51.100.31",
        },
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

  it("rate-limits repeated submissions with neutral 200 response and no extra delivery", async () => {
    const headers = {
      ...sameOriginJsonHeaders,
      "x-forwarded-for": "198.51.100.44",
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await submitContactForm(
        new Request("http://localhost/api/contact-form", {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: "Studio Owner",
            email: "owner@example.test",
            message: `Valid message payload for attempt ${attempt + 1} that exceeds minimum length.`,
            honeypot: "",
          }),
        }),
      );
      expect(response.status).toBe(200);
    }

    const blocked = await submitContactForm(
      new Request("http://localhost/api/contact-form", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Studio Owner",
          email: "owner@example.test",
          message: "This should be throttled while keeping a neutral external response.",
          honeypot: "",
        }),
      }),
    );

    const blockedBody = (await blocked.json()) as { ok: boolean; message: string };
    expect(blocked.status).toBe(200);
    expect(blockedBody.ok).toBe(true);
    expect(sendEmailViaResendMock).toHaveBeenCalledTimes(5);
  });

  it("keeps concurrent same-IP submissions on neutral 200 responses without leaking 500s", async () => {
    const headers = {
      ...sameOriginJsonHeaders,
      "x-forwarded-for": "198.51.100.77",
    };

    const responses = await Promise.all(
      Array.from({ length: 8 }).map((_, index) =>
        submitContactForm(
          new Request("http://localhost/api/contact-form", {
            method: "POST",
            headers,
            body: JSON.stringify({
              name: "Studio Owner",
              email: "owner@example.test",
              message: `Concurrent valid message payload ${index + 1} with enough length for validation.`,
              honeypot: "",
            }),
          }),
        ),
      ),
    );

    expect(responses).toHaveLength(8);
    for (const response of responses) {
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    }

    expect(sendEmailViaResendMock.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("does not trust x-forwarded-for for throttle keys in production unless explicitly enabled", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.TRUST_X_FORWARDED_FOR;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await submitContactForm(
        new Request("http://localhost/api/contact-form", {
          method: "POST",
          headers: {
            ...sameOriginJsonHeaders,
            "x-forwarded-for": `198.51.100.${attempt + 10}`,
          },
          body: JSON.stringify({
            name: "Studio Owner",
            email: "owner@example.test",
            message: `Valid message payload for production trust test attempt ${attempt + 1}.`,
            honeypot: "",
          }),
        }),
      );
      expect(response.status).toBe(200);
    }

    const blocked = await submitContactForm(
      new Request("http://localhost/api/contact-form", {
        method: "POST",
        headers: {
          ...sameOriginJsonHeaders,
          "x-forwarded-for": "203.0.113.250",
        },
        body: JSON.stringify({
          name: "Studio Owner",
          email: "owner@example.test",
          message: "This request should be throttled when only spoofable forwarded IPs are present.",
          honeypot: "",
        }),
      }),
    );

    const blockedBody = (await blocked.json()) as { ok: boolean; message: string };
    expect(blocked.status).toBe(200);
    expect(blockedBody.ok).toBe(true);
    expect(sendEmailViaResendMock).toHaveBeenCalledTimes(5);
  });
});
