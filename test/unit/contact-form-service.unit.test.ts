import { afterEach, describe, expect, it, vi } from "vitest";

const sendEmailViaResendMock = vi.fn();

vi.mock("@/lib/email/resend-delivery", () => ({
  sendEmailViaResend: (...args: unknown[]) => sendEmailViaResendMock(...args),
}));

import { ContactFormServiceError, submitHomesiteContactForm } from "@/lib/contact-form/contact-form-service";

describe("contact-form-service", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    sendEmailViaResendMock.mockReset();
  });

  it("fails fast when CONTACT_FORM_TO_EMAIL is missing", async () => {
    vi.stubEnv("CONTACT_FORM_TO_EMAIL", "");
    vi.stubEnv("RESEND_API_KEY", "test-resend-key");
    vi.stubEnv("EMAIL_FROM", "BookMyClass <no-reply@bookmyclass.app>");

    await expect(
      submitHomesiteContactForm({
        name: "Studio Owner",
        email: "owner@example.test",
        message: "Please contact me about onboarding for a second studio location.",
        honeypot: "",
      }),
    ).rejects.toMatchObject<ContactFormServiceError>({ code: "MISSING_CONTACT_FORM_TO_EMAIL" });

    expect(sendEmailViaResendMock).not.toHaveBeenCalled();
  });

  it("returns a delivery error when resend fails", async () => {
    vi.stubEnv("CONTACT_FORM_TO_EMAIL", "gaelapagoz@gmail.com");
    vi.stubEnv("RESEND_API_KEY", "test-resend-key");
    vi.stubEnv("EMAIL_FROM", "BookMyClass <no-reply@bookmyclass.app>");
    sendEmailViaResendMock.mockRejectedValue(new Error("provider down"));

    await expect(
      submitHomesiteContactForm({
        name: "Studio Owner",
        email: "owner@example.test",
        message: "Please contact me about onboarding for a second studio location.",
        honeypot: "",
      }),
    ).rejects.toMatchObject<ContactFormServiceError>({ code: "DELIVERY_FAILED" });
  });
});
