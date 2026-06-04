import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmailViaResendMock = vi.fn();
const contactRateLimitState = new Map<string, { id: string; requestCount: number; windowStartedAt: Date }>();
const contactRateLimitFindFirstMock = vi.fn();
const contactRateLimitCreateMock = vi.fn();
const contactRateLimitUpdateManyMock = vi.fn();

vi.mock("@/lib/email/resend-delivery", () => ({
  isRealEmailDeliveryEnabled: vi.fn(() => true),
  sendEmailViaResend: (...args: unknown[]) => sendEmailViaResendMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        contactMessageRateLimit: {
          updateMany: contactRateLimitUpdateManyMock,
        },
      }),
    contactMessageRateLimit: {
      findFirst: (...args: unknown[]) => contactRateLimitFindFirstMock(...args),
      create: (...args: unknown[]) => contactRateLimitCreateMock(...args),
    },
  },
}));

import { ContactFormServiceError, submitHomesiteContactForm } from "@/lib/contact-form/contact-form-service";
import { isRealEmailDeliveryEnabled } from "@/lib/email/resend-delivery";

describe("contact-form-service", () => {
  beforeEach(() => {
    contactRateLimitState.clear();
    contactRateLimitFindFirstMock.mockReset();
    contactRateLimitCreateMock.mockReset();
    contactRateLimitUpdateManyMock.mockReset();

    contactRateLimitFindFirstMock.mockImplementation(async ({ where }: { where: { ipHash: string } }) => {
      return contactRateLimitState.get(where.ipHash) ?? null;
    });

    contactRateLimitCreateMock.mockImplementation(async ({ data }: { data: { ipHash: string; windowStartedAt: Date; requestCount: number } }) => {
      const record = { id: `rate-${data.ipHash}`, requestCount: data.requestCount, windowStartedAt: data.windowStartedAt };
      contactRateLimitState.set(data.ipHash, record);
      return record;
    });

    contactRateLimitUpdateManyMock.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: {
          ipHash: string;
          windowStartedAt?: { lt?: Date; gte?: Date };
          requestCount?: { lt?: number };
        };
        data: { windowStartedAt?: Date; requestCount?: number | { increment: number } };
      }) => {
        const row = contactRateLimitState.get(where.ipHash);
        if (!row) {
          return { count: 0 };
        }

        if (where.windowStartedAt?.lt && !(row.windowStartedAt < where.windowStartedAt.lt)) {
          return { count: 0 };
        }
        if (where.windowStartedAt?.gte && !(row.windowStartedAt >= where.windowStartedAt.gte)) {
          return { count: 0 };
        }
        if (where.requestCount?.lt !== undefined && !(row.requestCount < where.requestCount.lt)) {
          return { count: 0 };
        }

        if (data.windowStartedAt) {
          row.windowStartedAt = data.windowStartedAt;
        }
        if (typeof data.requestCount === "number") {
          row.requestCount = data.requestCount;
        } else if (data.requestCount && "increment" in data.requestCount) {
          row.requestCount += data.requestCount.increment;
        }

        return { count: 1 };
      }
    );

    vi.mocked(isRealEmailDeliveryEnabled).mockReturnValue(true);
  });

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
    expect(contactRateLimitFindFirstMock).not.toHaveBeenCalled();
    expect(contactRateLimitUpdateManyMock).not.toHaveBeenCalled();
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

  it("returns RATE_LIMITED after the configured homesite threshold is consumed", async () => {
    vi.stubEnv("CONTACT_FORM_TO_EMAIL", "gaelapagoz@gmail.com");
    vi.stubEnv("RESEND_API_KEY", "test-resend-key");
    vi.stubEnv("EMAIL_FROM", "BookMyClass <no-reply@bookmyclass.app>");
    sendEmailViaResendMock.mockResolvedValue({ sent: true, provider: "resend", messageId: "email_123" });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        submitHomesiteContactForm(
          {
            name: "Studio Owner",
            email: "owner@example.test",
            message: `Contact request payload ${attempt + 1} with enough text to pass validation.`,
            honeypot: "",
          },
          { ipAddress: "198.51.100.90" },
        ),
      ).resolves.toBeUndefined();
    }

    await expect(
      submitHomesiteContactForm(
        {
          name: "Studio Owner",
          email: "owner@example.test",
          message: "This request should be blocked by the homesite rate limiter.",
          honeypot: "",
        },
        { ipAddress: "198.51.100.90" },
      ),
    ).rejects.toMatchObject<ContactFormServiceError>({ code: "RATE_LIMITED" });

    expect(sendEmailViaResendMock).toHaveBeenCalledTimes(5);
  });

  it("does not require RESEND_API_KEY when non-production delivery is suppressed", async () => {
    vi.stubEnv("CONTACT_FORM_TO_EMAIL", "gaelapagoz@gmail.com");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "BookMyClass <no-reply@bookmyclass.app>");
    vi.mocked(isRealEmailDeliveryEnabled).mockReturnValue(false);
    sendEmailViaResendMock.mockResolvedValue({ sent: true, provider: "suppressed", messageId: null, bypassed: true });

    await expect(
      submitHomesiteContactForm({
        name: "Studio Owner",
        email: "owner@example.test",
        message: "Please contact me about onboarding for a second studio location.",
        honeypot: "",
      }),
    ).resolves.toBeUndefined();

    expect(sendEmailViaResendMock).toHaveBeenCalledOnce();
  });
});
