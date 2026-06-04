import { prisma } from "@/lib/db";
import { dispatchEmailAutomationBatch } from "@/lib/email/email-automation-dispatcher-service";
import { enqueueEmailAutomationEvent } from "@/lib/email/email-automation-outbox-service";
import { isE2ETestModeEnabled } from "@/lib/e2e/e2e-test-guard";

const AUTH_VERIFY_EMAIL_TEMPLATE_KEY = "auth.verify-email";
const AUTH_EMAIL_CHANGE_TEMPLATE_KEY = "auth.verify-email-change";
const AUTH_PASSWORD_RESET_TEMPLATE_KEY = "auth.password-reset";

function resolveAppUrl(inputAppUrl?: string): string {
  const resolved = inputAppUrl ?? process.env.APP_URL ?? "http://localhost:3000";
  const allowLoopbackForE2E = isE2ETestModeEnabled();
  if (process.env.NODE_ENV === "production" && !allowLoopbackForE2E) {
    const parsed = new URL(resolved);
    const host = parsed.hostname.toLowerCase();
    const isLoopback =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host === "0:0:0:0:0:0:0:1" ||
      host === "[0:0:0:0:0:0:0:1]" ||
      host === "::ffff:127.0.0.1";
    if (isLoopback) {
      throw new Error("APP_URL must be configured to a non-localhost URL in production.");
    }
  }
  return resolved;
}

async function ensureAuthTemplate(input: {
  templateKey: string;
  name: string;
  subjectTemplate: string;
  bodyTemplateJson: unknown;
}) {
  await prisma.emailTemplate.upsert({
    where: { templateKey: input.templateKey },
    update: {
      name: input.name,
      category: "AUTH",
      subjectTemplate: input.subjectTemplate,
      bodyTemplateJson: input.bodyTemplateJson as object,
      contentSchemaVersion: 1,
    },
    create: {
      templateKey: input.templateKey,
      name: input.name,
      category: "AUTH",
      subjectTemplate: input.subjectTemplate,
      bodyTemplateJson: input.bodyTemplateJson as object,
      contentSchemaVersion: 1,
      isActive: true,
    },
  });
}

async function attemptImmediateAuthDispatch(now: Date): Promise<void> {
  try {
    await dispatchEmailAutomationBatch({
      workerId: `auth-fast-lane:${process.pid}`,
      maxEvents: 10,
      leaseMs: 30_000,
      now,
    });
  } catch (error) {
    console.error("[auth-email-fast-lane] immediate-dispatch-failed", {
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function enqueueVerificationEmailFastLane(input: {
  to: string;
  name: string;
  verificationUrl: string;
  kind?: "VERIFY_EMAIL" | "EMAIL_CHANGE";
  idempotencyKey: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const isEmailChange = input.kind === "EMAIL_CHANGE";
  await ensureAuthTemplate({
    templateKey: isEmailChange ? AUTH_EMAIL_CHANGE_TEMPLATE_KEY : AUTH_VERIFY_EMAIL_TEMPLATE_KEY,
    name: "Auth Verification Email",
    subjectTemplate: isEmailChange ? "Confirm your new email" : "Verify your email",
    bodyTemplateJson: {
      blocks: [
        { type: "paragraph", text: "Hello {{name}}," },
        { type: "paragraph", text: "Please verify your email to continue." },
        { type: "paragraph", text: "<a href=\"{{verificationUrl}}\">Verify email</a>" },
        { type: "paragraph", text: "This link expires in 24 hours." },
      ],
    },
  });

  await enqueueEmailAutomationEvent({
    templateKey: isEmailChange ? AUTH_EMAIL_CHANGE_TEMPLATE_KEY : AUTH_VERIFY_EMAIL_TEMPLATE_KEY,
    recipientEmail: input.to,
    payloadJson: {
      deliveryContext: "user-identity-verification",
      name: input.name,
      verificationUrl: input.verificationUrl,
    },
    idempotencyKey: input.idempotencyKey,
    availableAt: now,
  });

  await attemptImmediateAuthDispatch(now);
}

export async function enqueuePasswordResetEmailFastLane(input: {
  to: string;
  userName: string;
  resetUrl: string;
  expiresInMinutes: number;
  idempotencyKey: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  await ensureAuthTemplate({
    templateKey: AUTH_PASSWORD_RESET_TEMPLATE_KEY,
    name: "Auth Password Reset Email",
    subjectTemplate: "Reset your password",
    bodyTemplateJson: {
      blocks: [
        { type: "paragraph", text: "Hello {{userName}}," },
        { type: "paragraph", text: "We received a request to reset your password." },
        { type: "paragraph", text: "<a href=\"{{resetUrl}}\">Reset your password</a>" },
        { type: "paragraph", text: "This link expires in {{expiresInMinutes}} minutes and can only be used once." },
      ],
    },
  });

  await enqueueEmailAutomationEvent({
    templateKey: AUTH_PASSWORD_RESET_TEMPLATE_KEY,
    recipientEmail: input.to,
    payloadJson: {
      deliveryContext: "password-reset",
      userName: input.userName,
      resetUrl: input.resetUrl,
      expiresInMinutes: input.expiresInMinutes,
    },
    idempotencyKey: input.idempotencyKey,
    availableAt: now,
  });

  await attemptImmediateAuthDispatch(now);
}

export { resolveAppUrl };
