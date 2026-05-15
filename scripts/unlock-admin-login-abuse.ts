import prisma from "../src/lib/db";

async function main() {
  const result = await prisma.adminLoginAbuseCounter.deleteMany({});
  console.info(`[auth] Cleared admin login abuse counters: ${result.count}`);
}

main()
  .catch((error) => {
    console.error("[auth] Failed to clear admin login abuse counters.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
