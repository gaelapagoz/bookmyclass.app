import prisma from "../src/lib/db";

async function main() {
  const shouldDeactivate = process.argv.includes("--deactivate");
  const olderThanDaysArg = process.argv.find((arg) => arg.startsWith("--older-than-days="));
  const olderThanDays = olderThanDaysArg ? Number.parseInt(olderThanDaysArg.split("=")[1] ?? "14", 10) : 14;
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const suspicious = await prisma.user.findMany({
    where: {
      OR: [
        {
          activationStatus: "PENDING",
          createdAt: { lt: cutoff },
        },
        {
          createdVia: "PUBLIC_SIGNUP",
          emailVerified: null,
          createdAt: { lt: cutoff },
        },
        {
          createdVia: "PUBLIC_SIGNUP",
          activationStatus: "ACTIVE",
          emailVerified: null,
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      role: true,
      createdVia: true,
      activationStatus: true,
      emailVerified: true,
      createdAt: true,
    },
    take: 500,
  });

  if (suspicious.length === 0) {
    console.info("[suspicious-users] none found");
    return;
  }

  console.info(`[suspicious-users] found ${suspicious.length} users (olderThanDays=${olderThanDays})`);
  for (const user of suspicious) {
    console.info(
      `- ${user.id} ${user.email} role=${user.role} via=${user.createdVia} activation=${user.activationStatus} verified=${user.emailVerified ? "yes" : "no"} createdAt=${user.createdAt.toISOString()}`,
    );
  }

  if (shouldDeactivate) {
    const ids = suspicious.map((user) => user.id);
    const result = await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: {
        activationStatus: "DISABLED",
        isActive: false,
        isInactive: true,
      },
    });
    console.info(`[suspicious-users] deactivated ${result.count} users`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("[suspicious-users] failed", error);
    await prisma.$disconnect();
    process.exit(1);
  });
