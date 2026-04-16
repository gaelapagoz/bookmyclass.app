import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password-service";
import {
  getAdminLoginAbuseState,
  recordAdminLoginFailure,
  resetAdminLoginFailureCounters,
} from "@/lib/auth/admin-login-abuse-service";

export type KioskExitValidationResult =
  | { success: true }
  | { success: false; reason: "locked" | "invalid" };

export async function validateKioskExitPassword(input: {
  userId: string;
  password: string;
  ipAddress: string;
}): Promise<KioskExitValidationResult> {
  const normalizedEmail = await getUserEmailForKioskExit(input.userId);
  if (!normalizedEmail) {
    return { success: false, reason: "invalid" };
  }

  const abuseState = await getAdminLoginAbuseState({
    ip: input.ipAddress,
    normalizedEmail,
  });

  if (abuseState.isLocked) {
    return { success: false, reason: "locked" };
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { passwordHash: true },
  });

  const userPasswordHash = user?.passwordHash;
  if (!userPasswordHash) {
    await recordAdminLoginFailure({
      ip: input.ipAddress,
      normalizedEmail,
      reason: "missing_password_hash",
    });
    return { success: false, reason: "invalid" };
  }

  const isValidPassword = await verifyPassword(input.password, userPasswordHash);
  if (!isValidPassword) {
    await recordAdminLoginFailure({
      ip: input.ipAddress,
      normalizedEmail,
      reason: "invalid_password",
    });
    return { success: false, reason: "invalid" };
  }

  await resetAdminLoginFailureCounters({
    ip: input.ipAddress,
    normalizedEmail,
  });

  return { success: true };
}

async function getUserEmailForKioskExit(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  return user?.email?.trim().toLowerCase() ?? null;
}
