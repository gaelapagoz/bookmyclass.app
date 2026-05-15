import "dotenv/config";

import prisma from "../src/lib/db";

async function main() {
  const rows = await prisma.price.findMany({
    where: {
      lookupKey: {
        startsWith: "store-",
      },
    },
    select: {
      id: true,
      lookupKey: true,
      stripePriceId: true,
      stripeSyncStatus: true,
      isActive: true,
      isArchived: true,
      unitAmountMinor: true,
      currencyCode: true,
      product: {
        select: {
          slug: true,
          name: true,
          isActive: true,
          isArchived: true,
        },
      },
    },
    orderBy: [{ lookupKey: "asc" }, { createdAt: "asc" }],
  });

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
