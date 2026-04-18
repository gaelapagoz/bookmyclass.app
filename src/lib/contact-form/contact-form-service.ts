import { z } from "zod";
import { sendEmailViaResend } from "@/lib/email/resend-delivery";

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

export function parseContactFormPayload(input: unknown): ContactFormPayload {
  const parsed = contactFormPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContactFormServiceError("INVALID_PAYLOAD", "Invalid contact form payload.");
  }
  return parsed.data;
}

export async function submitHomesiteContactForm(input: unknown): Promise<void> {
  const payload = parseContactFormPayload(input);
  if (payload.honeypot) {
    throw new ContactFormServiceError("HONEYPOT_REJECTED", "Honeypot field is filled.");
  }

  const config = getRequiredConfig();

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
