import { UserActivationStatus } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { getRequiredAuthSecret } from "@/lib/auth/auth-secret";
import { enqueuePasswordResetEmailFastLane } from "@/lib/auth/auth-email-fast-lane-service";
import { AUTH_SECURITY_EMAIL_TEMPLATE_KEYS, deadLetterSupersededAuthSecurityEmails } from "@/lib/auth/auth-security-email-guard";
import { createInMemoryTtlCache } from "@/lib/cache/in-memory-ttl-cache";
import { buildAppUrl } from "@/lib/config/app-url";
import { prisma } from "@/lib/db";

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PASSWORD_RESET_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PASSWORD_VERIFY_CACHE_TTL_MS = 30_000;
const PASSWORD_VERIFY_CACHE_SECRET = getRequiredAuthSecret();
const passwordVerifyCache = createInMemoryTtlCache<boolean>({
  defaultTtlMs: PASSWORD_VERIFY_CACHE_TTL_MS,
});

export type PasswordServiceErrorCode =
  | "INVALID_PASSWORD"
  | "PASSWORD_MISMATCH"
  | "INVALID_CURRENT_PASSWORD"
  | "PASSWORD_NOT_SET"
  | "TOKEN_INVALID_OR_EXPIRED";

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

function shouldLogPasswordResetDebug(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_DEBUG_PASSWORD_RESET === "1";
}

function shouldLogPasswordChangeDebug(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_DEBUG_PASSWORD_CHANGE === "1";
}

function logPasswordResetDebug(checkpoint: string, meta: PasswordResetDebugMeta = {}): void {
  if (!shouldLogPasswordResetDebug()) {
    return;
  }
  console.info(`[password-reset] ${checkpoint}`, meta);
}

function logPasswordChangeDebug(checkpoint: string, meta: PasswordResetDebugMeta = {}): void {
  if (!shouldLogPasswordChangeDebug()) {
    return;
  }
  console.info(`[password-change] ${checkpoint}`, meta);
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

function buildPasswordVerifyCacheKey(plainTextPassword: string, passwordHash: string): string {
  return createHash("sha256")
    .update(`${PASSWORD_VERIFY_CACHE_SECRET}:${passwordHash}:${plainTextPassword}`)
    .digest("hex");
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
  const cacheKey = buildPasswordVerifyCacheKey(plainTextPassword, passwordHash);
  return passwordVerifyCache.getOrLoad(cacheKey, () => compare(plainTextPassword, passwordHash));
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
  logPasswordChangeDebug("start", {
    hasUserId: Boolean(input.userId),
    hasCurrentPassword: currentPassword.length > 0,
    hasNewPassword: newPassword.length > 0,
    hasConfirmPassword: confirmNewPassword.length > 0,
  });
  validateNewPasswordOrThrow(newPassword, confirmNewPassword);
  logPasswordChangeDebug("validation-passed");

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true },
  });
  logPasswordChangeDebug("user-lookup", {
    userFound: Boolean(user),
    hasPasswordHash: Boolean(user?.passwordHash),
  });

  if (!user?.passwordHash) {
    throw new PasswordServiceError("PASSWORD_NOT_SET", "Password login is not enabled for this account.");
  }

  const isCurrentPasswordValid = await verifyPassword(currentPassword, user.passwordHash);
  logPasswordChangeDebug("verify-current-password", {
    isCurrentPasswordValid,
  });
  if (!isCurrentPasswordValid) {
    throw new PasswordServiceError("INVALID_CURRENT_PASSWORD", "Current password is incorrect.");
  }

  const newPasswordHash = await hashPassword(newPassword);
  logPasswordChangeDebug("before-user-update");

  try {
    await prisma.user.update({
      where: { id: input.userId },
      data: { passwordHash: newPasswordHash },
    });
    logPasswordChangeDebug("after-user-update");
  } catch (error) {
    logPasswordChangeDebug("user-update-failed", {
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorObject:
        typeof error === "object" && error !== null
          ? JSON.stringify(error, Object.getOwnPropertyNames(error))
          : String(error),
    });
    throw error;
  }
}

export async function requestPasswordReset(input: {
  email: string;
  appUrl?: string;
  now?: Date;
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
      activationStatus: true,
    },
  });
  logPasswordResetDebug("user-lookup", { userFound: Boolean(user) });

  if (!user || user.activationStatus !== UserActivationStatus.ACTIVE) {
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

  await deadLetterSupersededAuthSecurityEmails({
    recipientEmail: user.email,
    templateKeys: [AUTH_SECURITY_EMAIL_TEMPLATE_KEYS[2]],
    now,
  });

  const resetUrl = buildAppUrl({
    appUrl: input.appUrl,
    path: "/reset-password",
    query: {
      token: resetToken,
    },
  });
  logPasswordResetDebug("reset-url-built", {
    appUrl: input.appUrl,
    hasTokenInUrl: resetUrl.includes("token="),
  });

  try {
    logPasswordResetDebug("fast-lane-enqueue-started", {
      recipientDomain: user.email.split("@")[1] ?? "unknown",
    });
    await enqueuePasswordResetEmailFastLane({
      to: user.email,
      userName: user.name,
      resetUrl,
      expiresInMinutes: Math.floor(PASSWORD_RESET_TTL_MS / (60 * 1000)),
      idempotencyKey: `auth.password-reset:${user.id}:${resetTokenHash}`,
      now,
    });
    logPasswordResetDebug("fast-lane-enqueue-succeeded", {
      userId: user.id,
    });
  } catch (error) {
    console.error("[password-reset] auth-fast-lane-failed", {
      userId: user.id,
      emailDomain: user.email.split("@")[1] ?? "unknown",
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorObject:
        typeof error === "object" && error !== null
          ? JSON.stringify(error, Object.getOwnPropertyNames(error))
          : String(error),
    });
    throw error;
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

