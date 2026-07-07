import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";

const AUTH_VERIFY_EMAIL_TEMPLATE_KEY = "auth.verify-email";
const AUTH_EMAIL_CHANGE_TEMPLATE_KEY = "auth.verify-email-change";
const AUTH_PASSWORD_RESET_TEMPLATE_KEY = "auth.password-reset";
const SUPERSEDED_AUTH_EMAIL_ERROR = "AUTH_SECURITY_EMAIL_SUPERSEDED";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getVerificationTokenFromUrl(verificationUrl: string): {
  tokenKind: "registration" | "verification" | "email-change" | "password-reset" | "unknown";
  token: string | null;
  email: string | null;
} {
  const parsed = new URL(verificationUrl);
  const registrationToken = parsed.searchParams.get("registrationToken");
  if (registrationToken) {
    return {
      tokenKind: "registration",
      token: registrationToken,
      email: parsed.searchParams.get("email"),
    };
  }

  const emailChangeToken = parsed.searchParams.get("emailChangeToken");
  if (emailChangeToken) {
    return {
      tokenKind: "email-change",
      token: emailChangeToken,
      email: parsed.searchParams.get("email"),
    };
  }

  const resetToken = parsed.searchParams.get("token");
  if (parsed.pathname === "/reset-password" && resetToken) {
    return {
      tokenKind: "password-reset",
      token: resetToken,
      email: null,
    };
  }

  if (resetToken) {
    return {
      tokenKind: "verification",
      token: resetToken,
      email: parsed.searchParams.get("email"),
    };
  }

  return {
    tokenKind: "unknown",
    token: null,
    email: parsed.searchParams.get("email"),
  };
}

async function isCurrentRegistrationVerification(input: {
  recipientEmail: string;
  token: string;
  now: Date;
}): Promise<boolean> {
  const pending = await prisma.pendingUserRegistration.findUnique({
    where: { email: normalizeEmail(input.recipientEmail) },
    select: {
      tokenHash: true,
      tokenExpiresAt: true,
      consumedAt: true,
    },
  });

  if (!pending || pending.consumedAt || pending.tokenExpiresAt <= input.now) {
    return false;
  }

  return pending.tokenHash === hashToken(input.token);
}

async function isCurrentUserVerification(input: {
  recipientEmail: string;
  token: string;
  now: Date;
}): Promise<boolean> {
  const email = normalizeEmail(input.recipientEmail);
  const existing = await prisma.verificationToken.findUnique({
    where: {
      identifier_token: {
        identifier: email,
        token: hashToken(input.token),
      },
    },
    select: {
      expires: true,
    },
  });

  return Boolean(existing && existing.expires > input.now);
}

async function isCurrentEmailChangeVerification(input: {
  recipientEmail: string;
  token: string;
  now: Date;
}): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: {
      pendingEmail: {
        equals: normalizeEmail(input.recipientEmail),
        mode: "insensitive",
      },
    },
    select: {
      pendingEmailTokenHash: true,
      pendingEmailTokenExpiresAt: true,
    },
  });

  if (!user?.pendingEmailTokenHash || !user.pendingEmailTokenExpiresAt || user.pendingEmailTokenExpiresAt <= input.now) {
    return false;
  }

  return user.pendingEmailTokenHash === hashToken(input.token);
}

async function isCurrentPasswordReset(input: {
  token: string;
  now: Date;
}): Promise<boolean> {
  const existing = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    select: {
      expiresAt: true,
      usedAt: true,
    },
  });

  return Boolean(existing && !existing.usedAt && existing.expiresAt > input.now);
}

export async function shouldDeliverCurrentAuthSecurityEmail(input: {
  recipientEmail: string;
  verificationUrl: string;
  now: Date;
}): Promise<boolean> {
  const tokenInfo = getVerificationTokenFromUrl(input.verificationUrl);
  if (!tokenInfo.token) {
    return false;
  }

  switch (tokenInfo.tokenKind) {
    case "registration":
      return isCurrentRegistrationVerification({
        recipientEmail: input.recipientEmail,
        token: tokenInfo.token,
        now: input.now,
      });
    case "verification":
      return isCurrentUserVerification({
        recipientEmail: tokenInfo.email ?? input.recipientEmail,
        token: tokenInfo.token,
        now: input.now,
      });
    case "email-change":
      return isCurrentEmailChangeVerification({
        recipientEmail: tokenInfo.email ?? input.recipientEmail,
        token: tokenInfo.token,
        now: input.now,
      });
    case "password-reset":
      return isCurrentPasswordReset({
        token: tokenInfo.token,
        now: input.now,
      });
    default:
      return false;
  }
}

export async function deadLetterSupersededAuthSecurityEmails(input: {
  recipientEmail: string;
  templateKeys: string[];
  now: Date;
}): Promise<number> {
  const templates = await prisma.emailTemplate.findMany({
    where: {
      templateKey: {
        in: input.templateKeys,
      },
    },
    select: {
      id: true,
    },
  });

  if (templates.length < 1) {
    return 0;
  }

  const result = await prisma.emailAutomationEvent.updateMany({
    where: {
      templateId: {
        in: templates.map((template) => template.id),
      },
      recipientEmail: normalizeEmail(input.recipientEmail),
      sentAt: null,
      status: {
        in: ["PENDING", "LEASED"],
      },
    },
    data: {
      status: "DEAD_LETTER",
      deadLetteredAt: input.now,
      lastError: SUPERSEDED_AUTH_EMAIL_ERROR,
      leaseOwner: null,
      leasedAt: null,
      leaseExpiresAt: null,
    },
  });

  return result.count;
}

export const AUTH_SECURITY_EMAIL_TEMPLATE_KEYS = [
  AUTH_VERIFY_EMAIL_TEMPLATE_KEY,
  AUTH_EMAIL_CHANGE_TEMPLATE_KEY,
  AUTH_PASSWORD_RESET_TEMPLATE_KEY,
] as const;

export { SUPERSEDED_AUTH_EMAIL_ERROR };
