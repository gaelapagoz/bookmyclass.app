import { CouponStatus, PriceType, ProductType, Role } from "@prisma/client";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("coupon db constraints", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function seedBase() {
    const admin = await prisma.user.create({
      data: {
        name: "Coupon Admin",
        email: `coupon-constraints-admin-${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: `Constraint Product ${Date.now()}`,
        slug: `constraint-product-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
      },
    });

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `constraint-price-${Date.now()}`,
        name: "Constraint Price",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 1000,
      },
    });

    return { admin, product, price };
  }

  it("rejects invalid coupon field combinations by discount type", async () => {
    const { admin } = await seedBase();

    await expect(
      prisma.coupon.create({
        data: {
          code: `BADPCT_${Date.now()}`,
          status: CouponStatus.ACTIVE,
          discountType: "PERCENTAGE",
          discountPercentBps: 1500,
          discountAmountMinor: 10,
          expiresAt: new Date("2026-12-31T00:00:00.000Z"),
          createdById: admin.id,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.coupon.create({
        data: {
          code: `BADFIX_${Date.now()}`,
          status: CouponStatus.ACTIVE,
          discountType: "FIXED_AMOUNT",
          discountAmountMinor: 100,
          currencyCode: "",
          expiresAt: new Date("2026-12-31T00:00:00.000Z"),
          createdById: admin.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces exactly-one-target and uniqueness on eligibilities", async () => {
    const { admin, product, price } = await seedBase();
    const coupon = await prisma.coupon.create({
      data: {
        code: `VALID_${Date.now()}`,
        status: CouponStatus.ACTIVE,
        discountType: "PERCENTAGE",
        discountPercentBps: 1500,
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
        createdById: admin.id,
      },
    });

    await expect(
      prisma.couponEligibility.create({
        data: {
          couponId: coupon.id,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.couponEligibility.create({
        data: {
          couponId: coupon.id,
          productId: product.id,
          priceId: price.id,
        },
      }),
    ).rejects.toThrow();

    await prisma.couponEligibility.create({
      data: {
        couponId: coupon.id,
        productId: product.id,
      },
    });

    await expect(
      prisma.couponEligibility.create({
        data: {
          couponId: coupon.id,
          productId: product.id,
        },
      }),
    ).rejects.toThrow();
  });
});

