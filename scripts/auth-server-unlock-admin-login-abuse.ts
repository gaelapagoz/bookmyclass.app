/**
 * Auth server unlock admin login abuse
 *
 * Purpose:
 * - Operational script for this repository's server/local workflows.
 *
 * Safety:
 * - Mutating operation. Review target variables before running.
 *
 * Variables:
 * - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
 *
 * Usage:
 *   tsx scripts/auth-server-unlock-admin-login-abuse.ts
 */
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
