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
