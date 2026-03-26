import "./helpers/setup-env";
import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

async function createClientUser(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  return prisma.user.create({
    data: {
      name: "Client User",
      firstName: "Client",
      lastName: "User",
      email,
      role: Role.CLIENT,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
    },
  });
}

describe("password-service integration", () => {
  beforeEach(async () => {
    await resetDb();
    clearPasswordResetRateLimitForTests();
  });

  it("change password succeeds with correct current password", async () => {
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
    const sendResetEmail = vi.fn(async () => undefined);

    const result = await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
      sendResetEmail,
    });

    expect(result).toEqual({ accepted: true });
    expect(sendResetEmail).toHaveBeenCalledTimes(1);

    const activeTokenCount = await prisma.passwordResetToken.count({
      where: {
        userId: user.id,
        usedAt: null,
      },
    });
    expect(activeTokenCount).toBe(1);
  });

  it("forgot password with unknown email returns same response", async () => {
    const sendResetEmail = vi.fn(async () => undefined);

    const result = await requestPasswordReset({
      email: `forgot.unknown.${Date.now()}@example.test`,
      appUrl: "http://localhost:3000",
      sendResetEmail,
    });

    expect(result).toEqual({ accepted: true });
    expect(sendResetEmail).not.toHaveBeenCalled();
  });

  it("reset with valid token succeeds", async () => {
    const user = await createClientUser(`reset.valid.${Date.now()}@example.test`, "Password123!");
    let resetToken: string | null = null;

    await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
      sendResetEmail: async (payload) => {
        const tokenParam = new URL(payload.resetUrl).searchParams.get("token");
        resetToken = tokenParam;
      },
    });

    expect(resetToken).toBeTruthy();

    await resetPasswordWithToken({
      token: resetToken!,
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
    let resetToken: string | null = null;

    await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
      sendResetEmail: async (payload) => {
        resetToken = new URL(payload.resetUrl).searchParams.get("token");
      },
    });

    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      resetPasswordWithToken({
        token: resetToken!,
        newPassword: "UpdatedPassword123!",
        confirmNewPassword: "UpdatedPassword123!",
      }),
    ).rejects.toMatchObject<Partial<PasswordServiceError>>({
      code: "TOKEN_INVALID_OR_EXPIRED",
    });
  });

  it("used token is rejected", async () => {
    const user = await createClientUser(`reset.used.${Date.now()}@example.test`, "Password123!");
    let resetToken: string | null = null;

    await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
      sendResetEmail: async (payload) => {
        resetToken = new URL(payload.resetUrl).searchParams.get("token");
      },
    });

    await resetPasswordWithToken({
      token: resetToken!,
      newPassword: "UpdatedPassword123!",
      confirmNewPassword: "UpdatedPassword123!",
    });

    await expect(
      resetPasswordWithToken({
        token: resetToken!,
        newPassword: "AnotherPassword123!",
        confirmNewPassword: "AnotherPassword123!",
      }),
    ).rejects.toMatchObject<Partial<PasswordServiceError>>({
      code: "TOKEN_INVALID_OR_EXPIRED",
    });
  });

  it("older token is invalid after newer token is issued", async () => {
    const user = await createClientUser(`reset.rotate.${Date.now()}@example.test`, "Password123!");
    let firstToken: string | null = null;
    let secondToken: string | null = null;

    await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
      sendResetEmail: async (payload) => {
        firstToken = new URL(payload.resetUrl).searchParams.get("token");
      },
    });

    clearPasswordResetRateLimitForTests();

    await requestPasswordReset({
      email: user.email,
      appUrl: "http://localhost:3000",
      sendResetEmail: async (payload) => {
        secondToken = new URL(payload.resetUrl).searchParams.get("token");
      },
    });

    await expect(
      resetPasswordWithToken({
        token: firstToken!,
        newPassword: "UpdatedPassword123!",
        confirmNewPassword: "UpdatedPassword123!",
      }),
    ).rejects.toMatchObject<Partial<PasswordServiceError>>({
      code: "TOKEN_INVALID_OR_EXPIRED",
    });

    await expect(
      resetPasswordWithToken({
        token: secondToken!,
        newPassword: "UpdatedPassword123!",
        confirmNewPassword: "UpdatedPassword123!",
      }),
    ).resolves.toBeUndefined();
  });
});


