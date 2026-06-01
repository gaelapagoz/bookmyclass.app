import { CouponRedemptionStatus, CouponStatus, Role } from "@prisma/client";
import { cleanupExpiredCouponReservations } from "../../src/lib/coupons/coupon-maintenance-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("coupon maintenance service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function seedCoupon() {
    const admin = await prisma.user.create({
      data: {
        name: "Coupon Admin",
        email: `coupon-admin-${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const client = await prisma.user.create({
      data: {
        name: "Coupon Client",
        email: `coupon-client-${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const coupon = await prisma.coupon.create({
      data: {
        code: `SPRING_${Date.now()}`,
        status: CouponStatus.ACTIVE,
        discountType: "PERCENTAGE",
        discountPercentBps: 1500,
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
        createdById: admin.id,
      },
    });

    return { client, coupon };
  }

  it("transitions expired RESERVED rows to EXPIRED in batch", async () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const { client, coupon } = await seedCoupon();

    const expired = await prisma.couponRedemption.create({
      data: {
        couponId: coupon.id,
        clientId: client.id,
        status: CouponRedemptionStatus.RESERVED,
        couponCodeSnapshot: coupon.code,
        subtotalBeforeMinor: 1000,
        discountAmountMinor: 100,
        totalAfterMinor: 900,
        currencyCode: "EUR",
        idempotencyKey: `idem-expired-${Date.now()}`,
        payloadHash: "hash-expired",
        expiresAt: new Date("2026-05-31T12:00:00.000Z"),
      },
    });

    const fresh = await prisma.couponRedemption.create({
      data: {
        couponId: coupon.id,
        clientId: client.id,
        status: CouponRedemptionStatus.RESERVED,
        couponCodeSnapshot: coupon.code,
        subtotalBeforeMinor: 1000,
        discountAmountMinor: 100,
        totalAfterMinor: 900,
        currencyCode: "EUR",
        idempotencyKey: `idem-fresh-${Date.now()}`,
        payloadHash: "hash-fresh",
        expiresAt: new Date("2026-06-02T12:00:00.000Z"),
      },
    });

    const result = await cleanupExpiredCouponReservations({ now, batchSize: 10 });
    expect(result.expiredCount).toBe(1);

    const [expiredRow, freshRow] = await Promise.all([
      prisma.couponRedemption.findUniqueOrThrow({ where: { id: expired.id } }),
      prisma.couponRedemption.findUniqueOrThrow({ where: { id: fresh.id } }),
    ]);

    expect(expiredRow.status).toBe(CouponRedemptionStatus.EXPIRED);
    expect(freshRow.status).toBe(CouponRedemptionStatus.RESERVED);
  });
});

