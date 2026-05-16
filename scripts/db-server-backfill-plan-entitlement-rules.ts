/**
 * Db server backfill plan entitlement rules
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
 *   tsx scripts/db-server-backfill-plan-entitlement-rules.ts
 */
import { config } from "dotenv";

config({ path: ".env" });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { backfillMissingPlanEntitlementRules } = await import("../src/lib/admin/plan-entitlement-rules");

  const updatedCount = await backfillMissingPlanEntitlementRules(prisma);
  console.log(`[backfill-plan-entitlement-rules] Updated ${updatedCount} product(s).`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[backfill-plan-entitlement-rules] Failed:", error);
  process.exit(1);
});
