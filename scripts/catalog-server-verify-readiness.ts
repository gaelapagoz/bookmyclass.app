/**
 * Catalog server verify readiness
 *
 * Purpose:
 * - Operational script for this repository's server/local workflows.
 *
 * Safety:
 * - Read-only checks by default.
 *
 * Variables:
 * - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
 *
 * Usage:
 *   tsx scripts/catalog-server-verify-readiness.ts
 */
import "dotenv/config";

import { verifyProductionCatalogReadiness } from "../src/lib/catalog/production-catalog-readiness";
import prisma from "../src/lib/db";

function printSafeSummary(result: Awaited<ReturnType<typeof verifyProductionCatalogReadiness>>): void {
  console.log("[catalog-server-verify-readiness] Production catalog readiness summary");
  console.log(`Checked prices: ${result.checkedCount}`);
  console.log(`Blocked prices: ${result.blockedCount}`);

  for (const row of result.rows) {
    const reason = row.reasons.length > 0 ? row.reasons.join("; ") : "ready";
    console.log(
      `- ${row.status}: ${row.productSlug} (${row.productName}) / ${row.priceLookupKey} (${row.priceName}) - ${reason}`,
    );
  }
}

async function main(): Promise<void> {
  try {
    const result = await verifyProductionCatalogReadiness();
    printSafeSummary(result);

    if (!result.ok) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (error: unknown) => {
  console.error("[catalog-server-verify-readiness] Verification failed.");
  console.error(error instanceof Error ? error.message : String(error));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
