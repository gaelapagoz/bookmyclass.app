import { prisma } from "@/lib/db";

export type CleanupExpiredCouponReservationsResult = {
  expiredCount: number;
};

export async function cleanupExpiredCouponReservations(input: {
  now?: Date;
  batchSize?: number;
} = {}): Promise<CleanupExpiredCouponReservationsResult> {
  const now = input.now ?? new Date();
  const batchSize = input.batchSize ?? 200;

  const stale = await prisma.couponRedemption.findMany({
    where: {
      status: "RESERVED",
      expiresAt: { lte: now },
    },
    select: { id: true },
    take: batchSize,
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
  });

  if (stale.length === 0) {
    return { expiredCount: 0 };
  }

  const ids = stale.map((row) => row.id);
  const result = await prisma.couponRedemption.updateMany({
    where: {
      id: { in: ids },
      status: "RESERVED",
    },
    data: {
      status: "EXPIRED",
      updatedAt: now,
    },
  });

  return { expiredCount: result.count };
}
