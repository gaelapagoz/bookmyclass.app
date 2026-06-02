import "./helpers/setup-env";

import { CouponDiscountType, CouponStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createAdminCoupon,
  listAdminCoupons,
  setAdminCouponStatus,
  updateAdminCoupon,
} from "../../src/lib/coupons/coupon-admin-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("coupon admin service", () => {
  let adminId = "";
  let clientId = "";

  beforeEach(async () => {
    await resetDb();
    const [admin, client] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Coupon Admin",
          email: `coupon-admin-${Date.now()}@example.test`,
          role: Role.ADMIN,
          emailVerified: new Date(),
        },
        select: { id: true },
      }),
      prisma.user.create({
        data: {
          name: "Coupon Client",
          email: `coupon-client-${Date.now()}@example.test`,
          role: Role.CLIENT,
          emailVerified: new Date(),
        },
        select: { id: true },
      }),
    ]);
    adminId = admin.id;
    clientId = client.id;
  });

  it("creates coupon and writes create audit log", async () => {
    const created = await createAdminCoupon({
      actorUserId: adminId,
      coupon: {
        code: " spring_10 ",
        status: CouponStatus.ACTIVE,
        discountType: CouponDiscountType.PERCENTAGE,
        discountPercentBps: 1000,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    });

    const [coupon, audit] = await Promise.all([
      prisma.coupon.findUniqueOrThrow({ where: { id: created.id } }),
      prisma.auditLog.findFirst({
        where: { actionType: "COUPON_CREATE", entityId: created.id, actorId: adminId },
      }),
    ]);

    expect(coupon.code).toBe("SPRING_10");
    expect(audit).not.toBeNull();
  });

  it("rejects forged non-admin actor", async () => {
    await expect(
      createAdminCoupon({
        actorUserId: clientId,
        coupon: {
          code: "CLIENTFAIL",
          status: CouponStatus.ACTIVE,
          discountType: CouponDiscountType.PERCENTAGE,
          discountPercentBps: 1000,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("ADMIN_ROLE_REQUIRED");
  });

  it("rejects duplicate normalized coupon code", async () => {
    await createAdminCoupon({
      actorUserId: adminId,
      coupon: {
        code: "save10",
        status: CouponStatus.ACTIVE,
        discountType: CouponDiscountType.PERCENTAGE,
        discountPercentBps: 1000,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    });

    await expect(
      createAdminCoupon({
        actorUserId: adminId,
        coupon: {
          code: "  SAVE10 ",
          status: CouponStatus.ACTIVE,
          discountType: CouponDiscountType.PERCENTAGE,
          discountPercentBps: 500,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow();
  });

  it("updates coupon and supports deactivate/archive transitions with audit rows", async () => {
    const created = await createAdminCoupon({
      actorUserId: adminId,
      coupon: {
        code: "EDIT25",
        status: CouponStatus.ACTIVE,
        discountType: CouponDiscountType.PERCENTAGE,
        discountPercentBps: 2500,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    });

    await updateAdminCoupon({
      actorUserId: adminId,
      couponId: created.id,
      coupon: {
        code: "EDIT25FIX",
        status: CouponStatus.ACTIVE,
        discountType: CouponDiscountType.FIXED_AMOUNT,
        discountAmountMinor: 700,
        currencyCode: "eur",
        expiresAt: new Date("2099-01-02T00:00:00.000Z"),
      },
    });
    await setAdminCouponStatus({
      actorUserId: adminId,
      couponId: created.id,
      status: CouponStatus.INACTIVE,
    });
    await setAdminCouponStatus({
      actorUserId: adminId,
      couponId: created.id,
      status: CouponStatus.ARCHIVED,
    });

    const [coupon, logs] = await Promise.all([
      prisma.coupon.findUniqueOrThrow({ where: { id: created.id } }),
      prisma.auditLog.findMany({
        where: { entityId: created.id, actorId: adminId },
        select: { actionType: true },
      }),
    ]);

    expect(coupon.code).toBe("EDIT25FIX");
    expect(coupon.status).toBe(CouponStatus.ARCHIVED);
    expect(coupon.currencyCode).toBe("EUR");
    expect(logs.map((row) => row.actionType)).toEqual(
      expect.arrayContaining(["COUPON_CREATE", "COUPON_UPDATE", "COUPON_DEACTIVATE", "COUPON_ARCHIVE"]),
    );
  });

  it("lists coupons for admin catalog page", async () => {
    await createAdminCoupon({
      actorUserId: adminId,
      coupon: {
        code: "LIST50",
        status: CouponStatus.ACTIVE,
        discountType: CouponDiscountType.PERCENTAGE,
        discountPercentBps: 5000,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    });

    const rows = await listAdminCoupons();
    expect(rows.length).toBe(1);
    expect(rows[0]?.code).toBe("LIST50");
  });

  it("rejects invalid validation combinations before mutate", async () => {
    await expect(
      createAdminCoupon({
        actorUserId: adminId,
        coupon: {
          code: "PASTDATE",
          status: CouponStatus.ACTIVE,
          discountType: CouponDiscountType.PERCENTAGE,
          discountPercentBps: 1000,
          expiresAt: new Date("2000-01-01T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("COUPON_EXPIRES_AT_INVALID");

    await expect(
      createAdminCoupon({
        actorUserId: adminId,
        coupon: {
          code: "BADWINDOW",
          status: CouponStatus.ACTIVE,
          discountType: CouponDiscountType.PERCENTAGE,
          discountPercentBps: 1000,
          startsAt: new Date("2099-01-03T00:00:00.000Z"),
          expiresAt: new Date("2099-01-02T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("COUPON_STARTS_AT_INVALID");

    await expect(
      createAdminCoupon({
        actorUserId: adminId,
        coupon: {
          code: "BADPERCENT",
          status: CouponStatus.ACTIVE,
          discountType: CouponDiscountType.PERCENTAGE,
          discountPercentBps: 0,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("COUPON_PERCENT_INVALID");

    await expect(
      createAdminCoupon({
        actorUserId: adminId,
        coupon: {
          code: "BADFIXED",
          status: CouponStatus.ACTIVE,
          discountType: CouponDiscountType.FIXED_AMOUNT,
          discountAmountMinor: 0,
          currencyCode: "EUR",
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("COUPON_FIXED_AMOUNT_INVALID");

    await expect(
      createAdminCoupon({
        actorUserId: adminId,
        coupon: {
          code: "BADLIMIT",
          status: CouponStatus.ACTIVE,
          discountType: CouponDiscountType.PERCENTAGE,
          discountPercentBps: 1000,
          minOrderAmountMinor: -1,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow("COUPON_MIN_ORDER_INVALID");
  });
});
