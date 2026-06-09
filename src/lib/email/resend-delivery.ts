type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  from: string;
  replyTo?: string | null;
  context: string;
};

export type EmailDeliveryResult = {
  sent: boolean;
  provider: "resend" | "test-bypass" | "suppressed";
  messageId: string | null;
  bypassed: boolean;
};

type CapturedTestEmail = {
  to: string[];
  subject: string;
  html: string;
  from: string;
  replyTo: string | null;
  context: string;
  createdAt: string;
};

type GlobalWithTestOutbox = typeof globalThis & {
  __bookMyClassTestEmailOutbox?: CapturedTestEmail[];
};

function normalizeRecipients(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : [input];
  return raw.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function parseSenderEmail(from: string): string {
  const trimmed = from.trim();
  const bracketMatch = trimmed.match(/<([^>]+)>/);
  const email = (bracketMatch?.[1] ?? trimmed).trim().toLowerCase();
  return email;
}

export function isDeterministicEmailDeliveryMode(): boolean {
  return process.env.NODE_ENV === "test" || isE2ETestModeEnabled();
}

export function isRealEmailDeliveryEnabled(): boolean {
  if (isDeterministicEmailDeliveryMode()) {
    return false;
  }

  if (process.env.NODE_ENV === "production") {
    return true;
  }

  return process.env.ALLOW_REAL_EMAILS_IN_NON_PRODUCTION === "1";
}

function assertProductionSenderPolicy(from: string): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const senderEmail = parseSenderEmail(from);
  if (!senderEmail.endsWith("@bookmyclass.app")) {
    throw new Error("EMAIL_FROM must use the verified @bookmyclass.app sender domain in production.");
  }
}

function getTestOutbox(): CapturedTestEmail[] {
  const globalRef = globalThis as GlobalWithTestOutbox;
  if (!globalRef.__bookMyClassTestEmailOutbox) {
    globalRef.__bookMyClassTestEmailOutbox = [];
  }
  return globalRef.__bookMyClassTestEmailOutbox;
}

export function clearCapturedTestEmails(): void {
  getTestOutbox().length = 0;
}

export function getCapturedTestEmails(): CapturedTestEmail[] {
  return [...getTestOutbox()];
}

export async function sendEmailViaResend(input: SendEmailInput): Promise<EmailDeliveryResult> {
  const to = normalizeRecipients(input.to);
  if (to.length < 1) {
    throw new Error("At least one recipient is required.");
  }

  const isDeterministicMode = isDeterministicEmailDeliveryMode();
  if (!isRealEmailDeliveryEnabled()) {
    getTestOutbox().push({
      to,
      subject: input.subject,
      html: input.html,
      from: input.from,
      replyTo: input.replyTo?.trim() || null,
      context: input.context,
      createdAt: new Date().toISOString(),
    });

    if (!isDeterministicMode) {
      console.info("[email] suppressed non-production provider delivery", {
        context: input.context,
        to,
        subject: input.subject,
      });
    }

    return {
      sent: true,
      provider: isDeterministicMode ? "test-bypass" : "suppressed",
      messageId: null,
      bypassed: true,
    };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY.");
  }

  assertProductionSenderPolicy(input.from);

  console.info("[email] sending via resend", {
    context: input.context,
    from: input.from,
    subject: input.subject,
    to,
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to,
      subject: input.subject,
      html: input.html,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
    cache: "no-store",
  });

  const responseBody = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    console.error("[email] resend delivery failed", {
      context: input.context,
      status: response.status,
      statusText: response.statusText,
      to,
    });
    const error = new Error("Resend delivery failed.");
    (error as Error & { details?: unknown }).details = {
      status: response.status,
      statusText: response.statusText,
      body: responseBody,
      context: input.context,
      to,
    };
    throw error;
  }

  const messageId =
    typeof responseBody === "object" &&
    responseBody !== null &&
    "id" in responseBody &&
    typeof (responseBody as { id?: unknown }).id === "string"
      ? (responseBody as { id: string }).id
      : null;

  console.info("[email] delivered via resend", {
    context: input.context,
    messageId,
    to,
  });

  return {
    sent: true,
    provider: "resend",
    messageId,
    bypassed: false,
  };
}
import { isE2ETestModeEnabled } from "@/lib/e2e/e2e-test-guard";
