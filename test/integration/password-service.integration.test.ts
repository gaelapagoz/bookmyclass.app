import "./helpers/setup-env";
import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCapturedTestEmails, getCapturedTestEmails } from "@/lib/email/resend-delivery";
import {
  changeAuthenticatedUserPassword,
  clearPasswordResetRateLimitForTests,
  hashPassword,
  PasswordServiceError,
  requestPasswordReset,
  resetPasswordWithToken,
  verifyPassword,
} from "../../src/lib/auth/password-service";
import { authorizeCredentials } from "../../src/lib/auth/credentials-authorize";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

async function createClientUser(email: string, password: string, verified: boolean = true) {
  const passwordHash = await hashPassword(password);
  return prisma.user.create({
    data: {
      name: "Client User",
      firstName: "Client",
      lastName: "User",
      email,
      role: Role.CLIENT,
      passwordHash,
      emailVerified: verified ? new Date() : null,
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
    },
  });
}

function getTokenFromCapturedResetEmail(recipientEmail: string): string {
  const message = [...getCapturedTestEmails()].reverse().find((item) => item.to.includes(recipientEmail.toLowerCase()));
  if (!message) {
    throw new Error("Expected password reset email in test outbox.");
  }

  const match = message.html.match(/token=([^"&]+)/);
  if (!match?.[1]) {
    throw new Error("token not found in captured payload.");
  }

  return decodeURIComponent(match[1]);
}

describe("password-service integration", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await resetDb();
    await clearPasswordResetRateLimitForTests();
    clearCapturedTestEmails();
  });

  it("credentials authorize rejects unverified users", async () => {
    const user = await createClientUser(`change.unverified.${Date.now()}@example.test`, "Password123!", false);

    await expect(
      authorizeCredentials({ email: user.email, password: "Password123!" }),
    ).resolves.toBeNull();
  });

  it("change password succeeds with correct current password", { timeout: 20000 }, async () => {
    const user = await createClientUser(`change.ok.${Date.now()}@example.test`, "OldPassword123!");

    await changeAuthenticatedUserPassword({
      userId: user.id,
      currentPassword: "OldPassword123!",
      newPassword: "NewPassword123!",
      confirmNewPassword: "NewPassword123!",
    });

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });

    expect(updated.passwordHash).toBeTruthy();
    expect(await verifyPassword("OldPassword123!", updated.passwordHash!)).toBe(false);
    expect(await verifyPassword("NewPassword123!", updated.passwordHash!)).toBe(true);
    await expect(
      authorizeCredentials({ email: user.email, password: "OldPassword123!" }),
    ).resolves.toBeNull();
    await expect(
      authorizeCredentials({ email: user.email, password: "NewPassword123!" }),
    ).resolves.toMatchObject({ id: user.id, email: user.email });
  });

  it("change password does not revoke current DB sessions in the same request", async () => {
    const user = await createClientUser(`change.session.${Date.now()}@example.test`, "OldPassword123!");
    const sessionToken = `session-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken,
        userId: user.id,
        expires: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await changeAuthenticatedUserPassword({
      userId: user.id,
      currentPassword: "OldPassword123!",
      newPassword: "NewPassword123!",
      confirmNewPassword: "NewPassword123!",
    });

    const stillExists = await prisma.session.findUnique({
      where: { sessionToken },
      select: { sessionToken: true },
    });
    expect(stillExists?.sessionToken).toBe(sessionToken);
  });

  it("change password rejects wrong current password", async () => {
    const user = await createClientUser(`change.bad.${Date.now()}@example.test`, "OldPassword123!");

    await expect(
      changeAuthenticatedUserPassword({
        userId: user.id,
        currentPassword: "WrongPassword123!",
        newPassword: "NewPassword123!",
        confirmNewPassword: "NewPassword123!",
      }),
    ).rejects.toMatchObject<Partial<PasswordServiceError>>({
      code: "INVALID_CURRENT_PASSWORD",
    });
  });


  it("change password rejects invalid new password", async () => {
    const user = await createClientUser(`change.short.${Date.now()}@example.test`, "OldPassword123!");

    await expect(
      changeAuthenticatedUserPassword({
        userId: user.id,
        currentPassword: "OldPassword123!",
        newPassword: "short",
        confirmNewPassword: "short",
      }),
    ).rejects.toMatchObject<Partial<PasswordServiceError>>({
      code: "INVALID_PASSWORD",
    });
  });

  it("change password rejects mismatched confirmation", async () => {
    const user = await createClientUser(`change.mismatch.${Date.now()}@example.test`, "OldPassword123!");

    await expect(
      changeAuthenticatedUserPassword({
        userId: user.id,
        currentPassword: "OldPassword123!",
        newPassword: "NewPassword123!",
        confirmNewPassword: "DifferentPassword123!",
      }),
    ).rejects.toMatchObject<Partial<PasswordServiceError>>({
      code: "PASSWORD_MISMATCH",
    });
  });

  it("forgot password with known email creates token and sends email", async () => {
    const user = await createClientUser(`forgot.known.${Date.now()}@example.test`, "Password123!");

    const result = await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
    });

    expect(result).toEqual({ outcome: "SENT" });
    expect(getCapturedTestEmails()).toHaveLength(1);

    const activeTokenCount = await prisma.passwordResetToken.count({
      where: {
        userId: user.id,
        usedAt: null,
      },
    });
    expect(activeTokenCount).toBe(1);
  });

  it("forgot password with unknown email returns same response", async () => {
    const result = await requestPasswordReset({
      email: `forgot.unknown.${Date.now()}@example.test`,
      appUrl: "http://localhost:3000",
    });

    expect(result).toEqual({ outcome: "SKIPPED" });
    expect(getCapturedTestEmails()).toHaveLength(0);
  });

  it("forgot password never creates user records", async () => {
    const email = `forgot.nocreate.${Date.now()}@example.test`;
    const before = await prisma.user.count({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
    });

    const result = await requestPasswordReset({
      email,
      appUrl: "http://localhost:3000",
    });

    const after = await prisma.user.count({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
    });

    expect(result).toEqual({ outcome: "SKIPPED" });
    expect(before).toBe(0);
    expect(after).toBe(0);
  });

  it("forgot password repeated requests are blocked within the limiter window", async () => {
    const user = await createClientUser(`forgot.limit.${Date.now()}@example.test`, "Password123!");
    const now = new Date();

    const first = await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
      now,
    });

    const second = await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
      now: new Date(now.getTime() + 10 * 1000),
    });

    expect(first).toEqual({ outcome: "SENT" });
    expect(second).toEqual({ outcome: "SKIPPED" });
    expect(getCapturedTestEmails()).toHaveLength(1);
  });

  it("forgot password limiter persists across service invocations", async () => {
    const user = await createClientUser(`forgot.persist.${Date.now()}@example.test`, "Password123!");
    const firstNow = new Date();

    await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
      now: firstNow,
    });

    const second = await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
      now: new Date(firstNow.getTime() + 10 * 1000),
    });

    const third = await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
      now: new Date(firstNow.getTime() + 70 * 1000),
    });

    expect(second).toEqual({ outcome: "SKIPPED" });
    expect(third).toEqual({ outcome: "SENT" });
    expect(getCapturedTestEmails()).toHaveLength(2);
  });

  it("forgot password queues an auth outbox event for fast-lane delivery", async () => {
    const user = await createClientUser(`forgot.fail.${Date.now()}@example.test`, "Password123!");
    const originalNodeEnv = process.env.NODE_ENV;
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalEmailFrom = process.env.EMAIL_FROM;
    process.env.NODE_ENV = "development";
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM = "Book My Class <no-reply@bookmyclass.app>";
    try {
      const result = await requestPasswordReset({
        email: user.email,
        appUrl: "http://localhost:3000",
      });
      expect(result).toEqual({ outcome: "SENT" });
      const events = await prisma.emailAutomationEvent.findMany({
        where: {
          recipientEmail: user.email.toLowerCase(),
        },
      });
      expect(events).toHaveLength(1);
      expect(["PENDING", "SENT", "LEASED"]).toContain(events[0]?.status);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = originalApiKey;
      }
      if (originalEmailFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = originalEmailFrom;
      }
    }
  });

  it("reset with valid token succeeds", async () => {
    const user = await createClientUser(`reset.valid.${Date.now()}@example.test`, "Password123!");

    await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
    });

    const resetToken = getTokenFromCapturedResetEmail(user.email);
    expect(resetToken).toBeTruthy();

    await resetPasswordWithToken({
      token: resetToken,
      newPassword: "UpdatedPassword123!",
      confirmNewPassword: "UpdatedPassword123!",
    });

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    expect(await verifyPassword("UpdatedPassword123!", updated.passwordHash!)).toBe(true);
  });

  it("expired token is rejected", async () => {
    const user = await createClientUser(`reset.expired.${Date.now()}@example.test`, "Password123!");

    await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
    });

    const resetToken = getTokenFromCapturedResetEmail(user.email);

    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      resetPasswordWithToken({
        token: resetToken,
        newPassword: "UpdatedPassword123!",
        confirmNewPassword: "UpdatedPassword123!",
      }),
    ).rejects.toMatchObject<Partial<PasswordServiceError>>({
      code: "TOKEN_INVALID_OR_EXPIRED",
    });
  });

  it("used token is rejected", async () => {
    const user = await createClientUser(`reset.used.${Date.now()}@example.test`, "Password123!");

    await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
    });

    const resetToken = getTokenFromCapturedResetEmail(user.email);

    await resetPasswordWithToken({
      token: resetToken,
      newPassword: "UpdatedPassword123!",
      confirmNewPassword: "UpdatedPassword123!",
    });

    await expect(
      resetPasswordWithToken({
        token: resetToken,
        newPassword: "AnotherPassword123!",
        confirmNewPassword: "AnotherPassword123!",
      }),
    ).rejects.toMatchObject<Partial<PasswordServiceError>>({
      code: "TOKEN_INVALID_OR_EXPIRED",
    });
  });

  it("older token is invalid after newer token is issued", async () => {
    const user = await createClientUser(`reset.rotate.${Date.now()}@example.test`, "Password123!");

    await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
    });
    const firstToken = getTokenFromCapturedResetEmail(user.email);

    await clearPasswordResetRateLimitForTests();

    await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
    });
    const secondToken = getTokenFromCapturedResetEmail(user.email);

    await expect(
      resetPasswordWithToken({
        token: firstToken,
        newPassword: "UpdatedPassword123!",
        confirmNewPassword: "UpdatedPassword123!",
      }),
    ).rejects.toMatchObject<Partial<PasswordServiceError>>({
      code: "TOKEN_INVALID_OR_EXPIRED",
    });

    await expect(
      resetPasswordWithToken({
        token: secondToken,
        newPassword: "UpdatedPassword123!",
        confirmNewPassword: "UpdatedPassword123!",
      }),
    ).resolves.toBeUndefined();
  });
});
