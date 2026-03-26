import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ productId: string; count: number }>>(
    'SELECT "productId", COUNT(*)::int AS count FROM "EntitlementRule" WHERE "isActive" = true GROUP BY "productId" HAVING COUNT(*) > 1',
  );

  console.log("products_with_multiple_active_rules", rows.length);

  for (const row of rows) {
    const rules = await prisma.entitlementRule.findMany({
      where: { productId: row.productId, isActive: true },
      select: {
        entitlementType: true,
        entitlementScope: true,
        quantity: true,
        validForDays: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    console.log(JSON.stringify({ productId: row.productId, rules }, null, 2));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
