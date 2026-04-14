import "./helpers/setup-env";
import { beforeAll, describe, expect, it } from "vitest";
import { hash, compare } from "bcryptjs";
import { Role } from "@prisma/client";

import { changeAuthenticatedUserPassword } from "@/lib/auth/password-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("teacher password change integration", () => {
  let testUserId: string;
  const testPassword = "CurrentPassword123!";
  const newPassword = "NewPassword456!";

  beforeAll(async () => {
    await resetDb();

    // Create a test teacher user
    const user = await prisma.user.create({
      data: {
        email: "teacher-password-test@example.test",
        name: "Test Teacher",
        firstName: "Test",
        lastName: "Teacher",
        passwordHash: await hash(testPassword, 12),
        role: Role.TEACHER,
        isActive: true,
      },
    });
    testUserId = user.id;
  });

  it("allows teacher to change their own password with correct current password", async () => {
    await changeAuthenticatedUserPassword({
      userId: testUserId,
      currentPassword: testPassword,
      newPassword: newPassword,
      confirmNewPassword: newPassword,
    });

    const updatedUser = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { passwordHash: true },
    });

    // Verify new password works
    const matches = await compare(newPassword, updatedUser!.passwordHash!);
    expect(matches).toBe(true);

    // Verify old password no longer works
    const oldMatches = await compare(testPassword, updatedUser!.passwordHash!);
    expect(oldMatches).toBe(false);
  });

  it("rejects password change with incorrect current password", async () => {
    const wrongPassword = "WrongPassword789!";

    await expect(
      changeAuthenticatedUserPassword({
        userId: testUserId,
        currentPassword: wrongPassword,
        newPassword: "AnotherPassword000!",
        confirmNewPassword: "AnotherPassword000!",
      }),
    ).rejects.toThrow("Current password is incorrect.");
  });

  it("rejects password change when new password does not match confirm", async () => {
    const currentPassword = newPassword; // Use the new password from previous test

    await expect(
      changeAuthenticatedUserPassword({
        userId: testUserId,
        currentPassword: currentPassword,
        newPassword: "Password1!",
        confirmNewPassword: "Password2!",
      }),
    ).rejects.toThrow("Password confirmation does not match.");
  });

  it("rejects password change when new password is too short", async () => {
    const currentPassword = newPassword;

    await expect(
      changeAuthenticatedUserPassword({
        userId: testUserId,
        currentPassword: currentPassword,
        newPassword: "short",
        confirmNewPassword: "short",
      }),
    ).rejects.toThrow(/Password must be at least/);
  });
});
