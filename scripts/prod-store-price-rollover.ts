import "dotenv/config";

import prisma from "../src/lib/db";

function nextLookupKey(current: string): string {
  if (current.endsWith("-v1")) {
    return `${current.slice(0, -3)}-v2`;
  }
  return `${current}-v2`;
}

async function main() {
  const staleRows = await prisma.price.findMany({
    where: {
      lookupKey: { startsWith: "store-" },
      isArchived: false,
      stripePriceId: { startsWith: "price_E2e" },
    },
    orderBy: { createdAt: "asc" },
  });

  if (staleRows.length === 0) {
    console.log("[prod-store-price-rollover] No stale rows found.");
    return;
  }

  for (const row of staleRows) {
    const newLookupKey = nextLookupKey(row.lookupKey);

    const existing = await prisma.price.findUnique({
      where: { lookupKey: newLookupKey },
      select: { id: true },
    });

    if (!existing) {
      await prisma.price.create({
        data: {
          productId: row.productId,
          lookupKey: newLookupKey,
          stripePriceId: null,
          stripeSyncStatus: "PENDING",
          stripeSyncError: null,
          stripeSyncErrorCode: null,
          stripeSyncCorrelation: null,
          stripeSyncLastAttempt: null,
          stripeSyncLastSuccess: null,
          name: row.name,
          priceType: row.priceType,
          currencyCode: row.currencyCode,
          unitAmountMinor: row.unitAmountMinor,
          billingInterval: row.billingInterval,
          billingIntervalCount: row.billingIntervalCount,
          isActive: true,
          isArchived: false,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
        },
      });
    }

    await prisma.price.update({
      where: { id: row.id },
      data: {
        isActive: false,
        isArchived: true,
        stripeSyncStatus: "FAILED",
        stripeSyncErrorCode: "STALE_E2E_PRICE_ID",
        stripeSyncError: "Archived stale production E2E Stripe ID; replaced by v2 lookup key.",
      },
    });

    console.log(
      `[prod-store-price-rollover] archived ${row.lookupKey} and ensured ${newLookupKey}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
