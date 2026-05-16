/**
 * Catalog server reset store price sync
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
 *   tsx scripts/catalog-server-reset-store-price-sync.ts
 */
import "dotenv/config";

import prisma from "../src/lib/db";

async function main() {
  const stale = await prisma.price.findMany({
    where: {
      lookupKey: { startsWith: "store-" },
      isArchived: false,
      isActive: true,
      stripePriceId: { startsWith: "price_E2e" },
    },
    select: { id: true, lookupKey: true, stripePriceId: true },
  });

  if (stale.length === 0) {
    console.log("[catalog-server-reset-store-price-sync] No stale store prices found.");
    return;
  }

  for (const row of stale) {
    await prisma.price.update({
      where: { id: row.id },
      data: {
        stripePriceId: null,
        stripeSyncStatus: "PENDING",
        stripeSyncError: "Cleared stale E2E Stripe price ID on production.",
        stripeSyncErrorCode: "STALE_E2E_PRICE_ID",
      },
    });
  }

  console.log(
    `[catalog-server-reset-store-price-sync] Cleared ${stale.length} stale store Stripe price IDs.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
