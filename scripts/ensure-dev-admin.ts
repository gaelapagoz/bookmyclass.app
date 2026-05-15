import { Role, UserActivationStatus } from "@prisma/client";
import { hash } from "bcryptjs";

import prisma from "../src/lib/db";

const DEV_ADMIN_EMAIL = "admin@yogapilatesfitness.local";
const DEV_MASTER_ADMIN_EMAIL = "masteradmin@yogapilatesfitness.local";
const DEV_PASSWORD = "qwerty123456";

async function upsertStaffUser(input: { email: string; role: Role; firstName: string; lastName: string }) {
  const passwordHash = await hash(DEV_PASSWORD, 12);
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      role: input.role,
      firstName: input.firstName,
      lastName: input.lastName,
      name: `${input.firstName} ${input.lastName}`,
      passwordHash,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      emailVerifiedAt: new Date(),
    },
    create: {
      email: input.email,
      role: input.role,
      firstName: input.firstName,
      lastName: input.lastName,
      name: `${input.firstName} ${input.lastName}`,
      passwordHash,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      emailVerifiedAt: new Date(),
    },
  });
}

async function main() {
  await prisma.adminLoginAbuseCounter.deleteMany({});
  const admin = await upsertStaffUser({
    email: DEV_ADMIN_EMAIL,
    role: Role.ADMIN,
    firstName: "Admin",
    lastName: "User",
  });
  const masterAdmin = await upsertStaffUser({
    email: DEV_MASTER_ADMIN_EMAIL,
    role: Role.MASTER_ADMIN,
    firstName: "Master",
    lastName: "Admin",
  });

  console.info("[auth] Ensured dev admin users and cleared admin login abuse counters.", {
    adminEmail: admin.email,
    masterAdminEmail: masterAdmin.email,
  });
}

main()
  .catch((error) => {
    console.error("[auth] Failed to ensure dev admin users.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
