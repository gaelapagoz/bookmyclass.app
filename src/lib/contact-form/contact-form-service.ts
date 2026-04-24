import { createHash } from "node:crypto";
import { z } from "zod";
import { sendEmailViaResend } from "@/lib/email/resend-delivery";
import { prisma } from "@/lib/db";

const DEFAULT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 5;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

const HOMESITE_CONTACT_RATE_LIMIT_WINDOW_MS = parsePositiveIntEnv(
  "HOMESITE_CONTACT_RATE_LIMIT_WINDOW_MS",
  DEFAULT_RATE_LIMIT_WINDOW_MS,
);
const HOMESITE_CONTACT_RATE_LIMIT_MAX_REQUESTS = parsePositiveIntEnv(
  "HOMESITE_CONTACT_RATE_LIMIT_MAX_REQUESTS",
  DEFAULT_RATE_LIMIT_MAX_REQUESTS,
);

const contactFormPayloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  message: z.string().trim().min(10).max(4000),
  honeypot: z.string().trim().max(200).optional().default(""),
});

type ContactFormPayload = z.infer<typeof contactFormPayloadSchema>;

export class ContactFormServiceError extends Error {
  constructor(
    public readonly code:
      | "INVALID_PAYLOAD"
      | "HONEYPOT_REJECTED"
      | "RATE_LIMITED"
      | "MISSING_CONTACT_FORM_TO_EMAIL"
      | "MISSING_RESEND_API_KEY"
      | "MISSING_EMAIL_FROM"
      | "DELIVERY_FAILED",
    message: string,
  ) {
    super(message);
  }
}

function getRequiredConfig() {
  const toEmail = process.env.CONTACT_FORM_TO_EMAIL?.trim();
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();

  if (!toEmail) {
    throw new ContactFormServiceError("MISSING_CONTACT_FORM_TO_EMAIL", "Missing CONTACT_FORM_TO_EMAIL.");
  }
  if (!resendApiKey) {
    throw new ContactFormServiceError("MISSING_RESEND_API_KEY", "Missing RESEND_API_KEY.");
  }
  if (!from) {
    throw new ContactFormServiceError("MISSING_EMAIL_FROM", "Missing EMAIL_FROM.");
  }

  const parsedTo = z.string().email().safeParse(toEmail);
  if (!parsedTo.success) {
    throw new ContactFormServiceError("MISSING_CONTACT_FORM_TO_EMAIL", "Invalid CONTACT_FORM_TO_EMAIL.");
  }

  return {
    toEmail: parsedTo.data,
    from,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getNormalizedIpAddress(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "unknown";
}

function hashHomesiteContactRateLimitIp(ipAddress: string): string {
  return createHash("sha256")
    .update(`homesite-contact-rate-limit:${ipAddress}`)
    .digest("hex");
}

async function assertHomesiteContactRateLimit(ipAddress: string, now: Date): Promise<void> {
  const ipHash = hashHomesiteContactRateLimitIp(ipAddress);
  const activeWindowThreshold = new Date(now.getTime() - HOMESITE_CONTACT_RATE_LIMIT_WINDOW_MS);

  const isRateLimited = await prisma.$transaction(async (tx) => {
    await tx.contactMessageRateLimit.upsert({
      where: { ipHash },
      update: {},
      create: {
        ipHash,
        windowStartedAt: now,
        requestCount: 0,
      },
    });

    const resetWindowResult = await tx.contactMessageRateLimit.updateMany({
      where: {
        ipHash,
        windowStartedAt: {
          lt: activeWindowThreshold,
        },
      },
      data: {
        windowStartedAt: now,
        requestCount: 1,
      },
    });
    if (resetWindowResult.count > 0) {
      return false;
    }

    const consumeSlotResult = await tx.contactMessageRateLimit.updateMany({
      where: {
        ipHash,
        windowStartedAt: {
          gte: activeWindowThreshold,
        },
        requestCount: {
          lt: HOMESITE_CONTACT_RATE_LIMIT_MAX_REQUESTS,
        },
      },
      data: {
        requestCount: {
          increment: 1,
        },
      },
    });
    return consumeSlotResult.count === 0;
  });

  if (isRateLimited) {
    throw new ContactFormServiceError("RATE_LIMITED", "Too many homesite contact submissions from this IP.");
  }
}

export function parseContactFormPayload(input: unknown): ContactFormPayload {
  const parsed = contactFormPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContactFormServiceError("INVALID_PAYLOAD", "Invalid contact form payload.");
  }
  return parsed.data;
}

export async function submitHomesiteContactForm(
  input: unknown,
  options?: { ipAddress?: string | null },
): Promise<void> {
  const payload = parseContactFormPayload(input);
  if (payload.honeypot) {
    throw new ContactFormServiceError("HONEYPOT_REJECTED", "Honeypot field is filled.");
  }

  const config = getRequiredConfig();
  const now = new Date();
  await assertHomesiteContactRateLimit(getNormalizedIpAddress(options?.ipAddress), now);

  try {
    await sendEmailViaResend({
      context: "homesite-contact-form",
      from: config.from,
      to: config.toEmail,
      replyTo: payload.email,
      subject: "New homesite contact form submission",
      html: `
        <h2>Homesite Contact Form</h2>
        <p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(payload.email)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(payload.message).replaceAll("\n", "<br>")}</p>
      `,
    });
  } catch (error) {
    const details =
      typeof error === "object" && error !== null && "details" in error
        ? (error as { details?: unknown }).details
        : error instanceof Error
          ? error.message
          : String(error);

    console.error("[homesite-contact-form] resend-send-failed", { details });
    throw new ContactFormServiceError("DELIVERY_FAILED", "Contact form delivery failed.");
  }
}
