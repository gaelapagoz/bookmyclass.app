import { UserActivationStatus } from "@prisma/client";
import type { Role } from "@prisma/client";
import { z } from "zod";

import { isAdminRole } from "@/lib/auth/admin-access";
import { verifyPassword } from "@/lib/auth/password-service";
import { prisma } from "@/lib/db";

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export async function authorizeCredentials(rawCredentials: unknown): Promise<AuthUser | null> {
  const parsed = credentialsSchema.safeParse(rawCredentials);

  if (!parsed.success) {
    return null;
  }

  const email = parsed.data.email.toLowerCase();
  const password = parsed.data.password;

  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerified: true,
      activationStatus: true,
      passwordHash: true,
    },
  });

  if (!user || user.activationStatus !== UserActivationStatus.ACTIVE) {
    return null;
  }

  if (!user?.passwordHash) {
    return null;
  }

  if (!user.emailVerified && !isAdminRole(user.role)) {
    return null;
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);
  if (!isValidPassword) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
