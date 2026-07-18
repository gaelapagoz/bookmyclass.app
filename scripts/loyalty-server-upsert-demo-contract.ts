/**
 * Loyalty server upsert demo contract
 *
 * Purpose:
 * - Operator-run repair for the demo loyalty wallet configuration.
 *
 * Safety:
 * - Upsert-only. Does not reset, purge, or mutate users, bookings, orders, media, or catalog records.
 *
 * Variables:
 * - DATABASE_URL from the server environment.
 *
 * Usage:
 *   tsx scripts/loyalty-server-upsert-demo-contract.ts
 */
import "dotenv/config";

import prisma from "../src/lib/db";
import {
  seedProductionLoyaltyProgram,
  verifyDemoLoyaltyContract,
} from "../prisma/seed/modes/demo";

async function main(): Promise<void> {
  try {
    const seeded = await seedProductionLoyaltyProgram();
    const verified = await verifyDemoLoyaltyContract();

    console.log("[loyalty-server-upsert-demo-contract] Loyalty demo contract upserted.");
    console.log(`eligibleProductCount=${seeded.eligibleProductCount}`);
    console.log(`rewardDefinitionId=${seeded.rewardDefinitionId}`);
    console.log(`verifiedPrograms=${verified.programCount}`);
    console.log(`verifiedEligibleProducts=${verified.eligibleProductCount}`);
    console.log(`verifiedRewards=${verified.rewardCount}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (error: unknown) => {
  console.error("[loyalty-server-upsert-demo-contract] Upsert failed.");
  console.error(error instanceof Error ? error.message : String(error));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
