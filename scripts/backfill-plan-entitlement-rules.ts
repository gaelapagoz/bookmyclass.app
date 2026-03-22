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
