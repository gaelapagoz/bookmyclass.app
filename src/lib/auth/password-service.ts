import { createHash, randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { prisma } from "@/lib/db";

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PASSWORD_RESET_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export type PasswordServiceErrorCode =
  | "INVALID_PASSWORD"
  | "PASSWORD_MISMATCH"
  | "INVALID_CURRENT_PASSWORD"
  | "PASSWORD_NOT_SET"
  | "TOKEN_INVALID_OR_EXPIRED"
  | "PASSWORD_RESET_DELIVERY_FAILED";

export class PasswordServiceError extends Error {
  constructor(
    public readonly code: PasswordServiceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type PasswordResetEmailPayload = {
  to: string;
  resetUrl: string;
  userName: string;
  expiresInMinutes: number;
};

type PasswordResetDebugMeta = Record<string, unknown>;

type ResendSendResult = {
  id: string | null;
  from: string;
};

type ResendSendFailure = {
  status: number;
  statusText: string;
  details: unknown;
};

function shouldLogPasswordResetDebug(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_DEBUG_PASSWORD_RESET === "1";
}

function logPasswordResetDebug(checkpoint: string, meta: PasswordResetDebugMeta = {}): void {
  if (!shouldLogPasswordResetDebug()) {
    return;
  }
  console.info(`[password-reset] ${checkpoint}`, meta);
}

function getResendFallbackFrom(from: string): string {
  if (from.includes("<") && from.includes(">")) {
    return from.replace(/<[^>]+>/, "<onboarding@resend.dev>");
  }
  return "Book My Class <onboarding@resend.dev>";
}

function isDomainNotVerifiedFailure(input: unknown): boolean {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const message = "message" in input ? String((input as { message?: unknown }).message ?? "") : "";
  const name = "name" in input ? String((input as { name?: unknown }).name ?? "") : "";
  return (
    message.toLowerCase().includes("domain is not verified") ||
    name.toLowerCase().includes("validation_error")
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateNewPasswordOrThrow(newPassword: string, confirmPassword: string) {
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordServiceError(
      "INVALID_PASSWORD",
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  }
  if (newPassword !== confirmPassword) {
    throw new PasswordServiceError("PASSWORD_MISMATCH", "Password confirmation does not match.");
  }
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashPasswordResetRateLimitKey(email: string): string {
  return createHash("sha256")
    .update(`password-reset-rate-limit:${email}`)
    .digest("hex");
}

function getPasswordResetTokenDelegateOrThrow() {
  const delegate = (prisma as unknown as { passwordResetToken?: unknown }).passwordResetToken;
  if (!delegate) {
    throw new Error(
      "PasswordResetToken Prisma delegate is unavailable. Run `npx prisma generate`, apply migrations, and restart the Next.js server.",
    );
  }
  return delegate as {
    updateMany: typeof prisma.passwordResetToken.updateMany;
    create: typeof prisma.passwordResetToken.create;
    findUnique: typeof prisma.passwordResetToken.findUnique;
  };
}

function getPasswordResetRateLimitDelegateOrThrow() {
  const delegate = (prisma as unknown as { passwordResetRateLimit?: unknown }).passwordResetRateLimit;
  if (!delegate) {
    throw new Error(
      "PasswordResetRateLimit Prisma delegate is unavailable. Run `npx prisma generate`, apply migrations, and restart the Next.js server.",
    );
  }
  return delegate as {
    findUnique: typeof prisma.passwordResetRateLimit.findUnique;
    upsert: typeof prisma.passwordResetRateLimit.upsert;
    deleteMany: typeof prisma.passwordResetRateLimit.deleteMany;
  };
}

async function sendPasswordResetEmailViaResend(
  payload: PasswordResetEmailPayload,
): Promise<ResendSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  logPasswordResetDebug("env-check", {
    hasResendApiKey: Boolean(apiKey),
    hasEmailFrom: Boolean(from),
    hasAppUrl: Boolean(process.env.APP_URL?.trim()),
  });
  if (!apiKey || !from) {
    throw new Error("Missing RESEND_API_KEY or EMAIL_FROM.");
  }

  const body = {
    to: [payload.to],
    subject: "Reset your password",
    html: `
      <p>Hello ${payload.userName},</p>
      <p>We received a request to reset your password.</p>
      <p><a href="${payload.resetUrl}">Reset your password</a></p>
      <p>This link expires in ${payload.expiresInMinutes} minutes and can only be used once.</p>
    `,
  };

  async function sendWithFrom(fromAddress: string): Promise<ResendSendResult> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        ...body,
      }),
      cache: "no-store",
    });

    const responseBody = await response.json().catch(async () => ({ raw: await response.text() }));
    if (!response.ok) {
      const failure: ResendSendFailure = {
        status: response.status,
        statusText: response.statusText,
        details: responseBody,
      };
      throw failure;
    }

    const id =
      typeof responseBody === "object" &&
      responseBody !== null &&
      "id" in responseBody &&
      typeof (responseBody as { id?: unknown }).id === "string"
        ? (responseBody as { id: string }).id
        : null;

    return {
      id,
      from: fromAddress,
    };
  }

  try {
    return await sendWithFrom(from);
  } catch (primaryFailure) {
    const canFallback =
      process.env.NODE_ENV !== "production" &&
      typeof primaryFailure === "object" &&
      primaryFailure !== null &&
      "status" in primaryFailure &&
      (primaryFailure as { status?: unknown }).status === 403 &&
      "details" in primaryFailure &&
      isDomainNotVerifiedFailure((primaryFailure as { details?: unknown }).details);

    if (!canFallback) {
      throw primaryFailure;
    }

    const fallbackFrom = getResendFallbackFrom(from);
    logPasswordResetDebug("resend-fallback-from-onboarding", {
      originalFrom: from,
      fallbackFrom,
    });
    return sendWithFrom(fallbackFrom);
  }
}

async function shouldRateLimitForgotPasswordRequest(email: string, now: Date): Promise<boolean> {
  getPasswordResetRateLimitDelegateOrThrow();
  const emailHash = hashPasswordResetRateLimitKey(email);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.passwordResetRateLimit.findUnique({
      where: { emailHash },
      select: { lastRequestedAt: true },
    });

    if (
      existing &&
      now.getTime() - existing.lastRequestedAt.getTime() < PASSWORD_RESET_RATE_LIMIT_WINDOW_MS
    ) {
      return true;
    }

    await tx.passwordResetRateLimit.upsert({
      where: { emailHash },
      update: { lastRequestedAt: now },
      create: {
        emailHash,
        lastRequestedAt: now,
      },
    });

    return false;
  });
}

export async function clearPasswordResetRateLimitForTests(): Promise<void> {
  const passwordResetRateLimit = getPasswordResetRateLimitDelegateOrThrow();
  await passwordResetRateLimit.deleteMany();
}

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return hash(plainTextPassword, 12);
}

export async function verifyPassword(
  plainTextPassword: string,
  passwordHash: string,
): Promise<boolean> {
  return compare(plainTextPassword, passwordHash);
}

export async function changeAuthenticatedUserPassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}): Promise<void> {
  const currentPassword = input.currentPassword;
  const newPassword = input.newPassword;
  const confirmNewPassword = input.confirmNewPassword;
  if (process.env.NODE_ENV !== "production") {
    console.info("[password-service] change password start", {
      hasUserId: Boolean(input.userId),
      hasCurrentPassword: currentPassword.length > 0,
      hasNewPassword: newPassword.length > 0,
      hasConfirmPassword: confirmNewPassword.length > 0,
    });
  }
  validateNewPasswordOrThrow(newPassword, confirmNewPassword);
  if (process.env.NODE_ENV !== "production") {
    console.info("[password-service] validation checkpoint passed");
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true },
  });
  if (process.env.NODE_ENV !== "production") {
    console.info("[password-service] user lookup result", {
      userFound: Boolean(user),
      hasPasswordHash: Boolean(user?.passwordHash),
    });
  }

  if (!user?.passwordHash) {
    throw new PasswordServiceError("PASSWORD_NOT_SET", "Password login is not enabled for this account.");
  }

  const isCurrentPasswordValid = await verifyPassword(currentPassword, user.passwordHash);
  if (process.env.NODE_ENV !== "production") {
    console.info("[password-service] verify password result", {
      isCurrentPasswordValid,
    });
  }
  if (!isCurrentPasswordValid) {
    throw new PasswordServiceError("INVALID_CURRENT_PASSWORD", "Current password is incorrect.");
  }

  const newPasswordHash = await hashPassword(newPassword);
  if (process.env.NODE_ENV !== "production") {
    console.info("[password-service] before prisma password update");
  }

  try {
    await prisma.user.update({
      where: { id: input.userId },
      data: { passwordHash: newPasswordHash },
    });
    if (process.env.NODE_ENV !== "production") {
      console.info("[password-service] after prisma password update");
    }
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[password-service] prisma update failed", {
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorObject:
          typeof error === "object" && error !== null
            ? JSON.stringify(error, Object.getOwnPropertyNames(error))
            : String(error),
      });
    }
    throw error;
  }
}

export async function requestPasswordReset(input: {
  email: string;
  appUrl?: string;
  now?: Date;
  sendResetEmail?: (payload: PasswordResetEmailPayload) => Promise<ResendSendResult | void>;
}): Promise<{ outcome: "SKIPPED" | "SENT" }> {
  const passwordResetToken = getPasswordResetTokenDelegateOrThrow();
  logPasswordResetDebug("request-entered");
  const now = input.now ?? new Date();
  const normalizedEmail = normalizeEmail(input.email);
  logPasswordResetDebug("email-normalized", {
    hasEmail: Boolean(normalizedEmail),
  });
  if (!normalizedEmail) {
    return { outcome: "SKIPPED" };
  }

  const isRateLimited = await shouldRateLimitForgotPasswordRequest(normalizedEmail, now);
  logPasswordResetDebug("rate-limit-check", { blocked: isRateLimited });
  if (isRateLimited) {
    return { outcome: "SKIPPED" };
  }

  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });
  logPasswordResetDebug("user-lookup", { userFound: Boolean(user) });

  if (!user) {
    return { outcome: "SKIPPED" };
  }

  const resetToken = randomBytes(32).toString("hex");
  const resetTokenHash = hashResetToken(resetToken);
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);

  await prisma.$transaction([
    passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    }),
    passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: resetTokenHash,
        expiresAt,
      },
    }),
  ]);
  logPasswordResetDebug("reset-token-created", {
    userIdPresent: Boolean(user.id),
    expiresAtIso: expiresAt.toISOString(),
  });

  const appUrl = input.appUrl ?? process.env.APP_URL ?? "http://localhost:3000";
  const resetUrl = `${appUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(resetToken)}`;
  logPasswordResetDebug("reset-url-built", {
    appUrl,
    hasTokenInUrl: resetUrl.includes("token="),
  });
  const sendEmail = input.sendResetEmail ?? sendPasswordResetEmailViaResend;

  try {
    logPasswordResetDebug("resend-send-started", {
      recipientDomain: user.email.split("@")[1] ?? "unknown",
    });
    const result = await sendEmail({
      to: user.email,
      userName: user.name,
      resetUrl,
      expiresInMinutes: Math.floor(PASSWORD_RESET_TTL_MS / (60 * 1000)),
    });
    logPasswordResetDebug("resend-send-succeeded", {
      resendId:
        typeof result === "object" &&
        result !== null &&
        "id" in result &&
        typeof (result as { id?: unknown }).id === "string"
          ? (result as { id: string }).id
          : null,
    });
  } catch (error) {
    console.error("[password-reset] resend-send-failed", {
      userId: user.id,
      emailDomain: user.email.split("@")[1] ?? "unknown",
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorObject:
        typeof error === "object" && error !== null
          ? JSON.stringify(error, Object.getOwnPropertyNames(error))
          : String(error),
    });
    throw new PasswordServiceError(
      "PASSWORD_RESET_DELIVERY_FAILED",
      "Password reset email delivery failed.",
    );
  }

  return { outcome: "SENT" };
}

export async function resetPasswordWithToken(input: {
  token: string;
  newPassword: string;
  confirmNewPassword: string;
  now?: Date;
}): Promise<void> {
  const passwordResetToken = getPasswordResetTokenDelegateOrThrow();
  const now = input.now ?? new Date();
  validateNewPasswordOrThrow(input.newPassword, input.confirmNewPassword);

  if (!input.token.trim()) {
    throw new PasswordServiceError("TOKEN_INVALID_OR_EXPIRED", "Reset token is invalid or expired.");
  }

  const tokenHash = hashResetToken(input.token.trim());
  const tokenRecord = await passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!tokenRecord || tokenRecord.usedAt || tokenRecord.expiresAt <= now) {
    throw new PasswordServiceError("TOKEN_INVALID_OR_EXPIRED", "Reset token is invalid or expired.");
  }

  const newPasswordHash = await hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    const claim = await tx.passwordResetToken.updateMany({
      where: {
        id: tokenRecord.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    if (claim.count !== 1) {
      throw new PasswordServiceError("TOKEN_INVALID_OR_EXPIRED", "Reset token is invalid or expired.");
    }

    await tx.user.update({
      where: { id: tokenRecord.userId },
      data: { passwordHash: newPasswordHash },
    });

    await tx.passwordResetToken.updateMany({
      where: {
        userId: tokenRecord.userId,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    await tx.session.deleteMany({
      where: { userId: tokenRecord.userId },
    });
  });
}
