/**
 * Db server backfill classtype service scope
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
 *   tsx scripts/db-server-backfill-classtype-service-scope.ts
 */
import { config } from "dotenv";

config({ path: ".env" });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { backfillClassTypeServiceScope } = await import("../src/lib/admin/admin-service");

  const { updatedCount } = await backfillClassTypeServiceScope();
  console.log(`[backfill-classtype-service-scope] Updated ${updatedCount} ClassType record(s).`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[backfill-classtype-service-scope] Failed:", error);
  process.exit(1);
});
