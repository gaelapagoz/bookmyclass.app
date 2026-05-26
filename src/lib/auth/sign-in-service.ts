import { prisma } from "@/lib/db";

export async function getSignInEligibilityUserByEmail(email: string) {
  return prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    select: {
      role: true,
      emailVerified: true,
      activationStatus: true,
    },
  });
}
