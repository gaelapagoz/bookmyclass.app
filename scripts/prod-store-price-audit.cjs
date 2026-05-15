require("dotenv").config({ path: ".env" });
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.price.findMany({
    where: { lookupKey: { startsWith: "store-" } },
    select: {
      id: true,
      lookupKey: true,
      stripePriceId: true,
      stripeSyncStatus: true,
      isActive: true,
      isArchived: true,
      amount: true,
      currency: true,
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
