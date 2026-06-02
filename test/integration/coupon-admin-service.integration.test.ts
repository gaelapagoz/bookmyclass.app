import "./helpers/setup-env";

import {
  CheckoutSource,
  CouponDiscountType,
  CouponRedemptionStatus,
  CouponStatus,
  GiftCardRedemptionStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Role,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createAdminCoupon,
  listAdminCouponUsageHistory,
  listAdminCoupons,
  setAdminCouponStatus,
  updateAdminCoupon,
} from "../../src/lib/coupons/coupon-admin-service";
import { getAdminGiftCardWalletLookup } from "../../src/lib/gift-cards/gift-card-admin-service";
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

  it("lists coupon sales usage and keeps gift-card wallet history separate", async () => {
    const coupon = await prisma.coupon.create({
      data: {
        code: "SALEHIST",
        status: CouponStatus.ACTIVE,
        discountType: CouponDiscountType.PERCENTAGE,
        discountPercentBps: 1000,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        createdById: adminId,
      },
    });
    const order = await prisma.order.create({
      data: {
        clientId,
        subtotalAmountMinor: 5_000,
        discountAmountMinor: 500,
        totalAmountMinor: 4_500,
        currencyCode: "EUR",
        status: OrderStatus.PAID,
        couponId: coupon.id,
        couponCodeSnapshot: coupon.code,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.SUCCEEDED,
        method: PaymentMethod.CARD,
        provider: PaymentProvider.STRIPE,
        providerReference: "cs_coupon_usage_history",
        stripeCheckoutSessionId: "cs_coupon_usage_history",
        checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
        amountMinor: 4_500,
        currencyCode: "EUR",
        capturedAt: new Date("2026-01-01T10:05:00.000Z"),
      },
    });
    await prisma.couponRedemption.create({
      data: {
        couponId: coupon.id,
        clientId,
        orderId: order.id,
        paymentId: payment.id,
        stripeCheckoutSessionId: "cs_coupon_usage_history",
        status: CouponRedemptionStatus.APPLIED,
        couponCodeSnapshot: coupon.code,
        subtotalBeforeMinor: 5_000,
        discountAmountMinor: 500,
        totalAfterMinor: 4_500,
        currencyCode: "EUR",
        idempotencyKey: "coupon-usage-history",
        payloadHash: "payload-hash",
        reservedAt: new Date("2026-01-01T10:00:00.000Z"),
        appliedAt: new Date("2026-01-01T10:05:00.000Z"),
        expiresAt: new Date("2026-01-01T10:30:00.000Z"),
      },
    });
    const wallet = await prisma.giftCardWallet.create({
      data: { clientId, currencyCode: "EUR", balanceMinor: 2_000 },
    });
    const giftCardOrder = await prisma.order.create({
      data: {
        clientId,
        subtotalAmountMinor: 2_000,
        discountAmountMinor: 0,
        totalAmountMinor: 2_000,
        currencyCode: "EUR",
        status: OrderStatus.PLACED,
      },
    });
    const giftCardRedemption = await prisma.giftCardRedemption.create({
      data: {
        walletId: wallet.id,
        clientId,
        orderId: giftCardOrder.id,
        status: GiftCardRedemptionStatus.RESERVED,
        reservedAmountMinor: 1_000,
        currencyCode: "EUR",
        idempotencyKey: "gift-card-history-separate",
        payloadHash: "gift-card-payload",
        expiresAt: new Date("2026-01-01T10:30:00.000Z"),
      },
    });

    const [couponHistory, walletHistory] = await Promise.all([
      listAdminCouponUsageHistory({
        actor: { userId: adminId, role: Role.ADMIN },
        status: CouponRedemptionStatus.APPLIED,
        query: "salehist",
      }),
      getAdminGiftCardWalletLookup({
        actor: { userId: adminId, role: Role.ADMIN },
        clientId,
      }),
    ]);

    expect(couponHistory.items).toHaveLength(1);
    expect(couponHistory.items[0]).toMatchObject({
      couponCode: "SALEHIST",
      clientEmail: expect.stringContaining("coupon-client-"),
      discountAmountMinor: 500,
      stripeCheckoutSessionId: "cs_coupon_usage_history",
    });
    expect(walletHistory.redemptions.map((row) => row.id)).toContain(giftCardRedemption.id);
    expect(walletHistory.redemptions).toHaveLength(1);
  });

  it("lists zero-value internal manual coupon payments without Stripe session", async () => {
    const coupon = await prisma.coupon.create({
      data: {
        code: "ZERO100",
        status: CouponStatus.ACTIVE,
        discountType: CouponDiscountType.FIXED_AMOUNT,
        discountAmountMinor: 2_000,
        currencyCode: "EUR",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        createdById: adminId,
      },
    });
    const order = await prisma.order.create({
      data: {
        clientId,
        subtotalAmountMinor: 2_000,
        discountAmountMinor: 2_000,
        totalAmountMinor: 0,
        currencyCode: "EUR",
        status: OrderStatus.PAID,
        couponId: coupon.id,
        couponCodeSnapshot: coupon.code,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.SUCCEEDED,
        method: PaymentMethod.MANUAL,
        provider: PaymentProvider.INTERNAL,
        checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
        amountMinor: 0,
        currencyCode: "EUR",
        capturedAt: new Date("2026-01-01T10:05:00.000Z"),
      },
    });
    await prisma.couponRedemption.create({
      data: {
        couponId: coupon.id,
        clientId,
        orderId: order.id,
        paymentId: payment.id,
        status: CouponRedemptionStatus.APPLIED,
        couponCodeSnapshot: coupon.code,
        subtotalBeforeMinor: 2_000,
        discountAmountMinor: 2_000,
        totalAfterMinor: 0,
        currencyCode: "EUR",
        idempotencyKey: "coupon-zero-history",
        payloadHash: "payload-hash-zero",
        reservedAt: new Date("2026-01-01T10:00:00.000Z"),
        appliedAt: new Date("2026-01-01T10:05:00.000Z"),
        expiresAt: new Date("2026-01-01T10:30:00.000Z"),
      },
    });

    const history = await listAdminCouponUsageHistory({
      actor: { userId: adminId, role: Role.ADMIN },
      query: "zero100",
    });

    expect(history.items[0]).toMatchObject({
      couponCode: "ZERO100",
      paymentProvider: PaymentProvider.INTERNAL,
      paymentMethod: PaymentMethod.MANUAL,
      paymentAmountMinor: 0,
      stripeCheckoutSessionId: null,
    });
  });

  it("rejects non-admin coupon usage history access", async () => {
    await expect(
      listAdminCouponUsageHistory({
        actor: { userId: clientId, role: Role.CLIENT },
      }),
    ).rejects.toThrow("ADMIN_ROLE_REQUIRED");
  });

  it("uses DB-backed admin authorization instead of trusting the caller role", async () => {
    await expect(
      listAdminCouponUsageHistory({
        actor: { userId: clientId, role: Role.ADMIN },
      }),
    ).rejects.toThrow("ADMIN_ROLE_REQUIRED");
  });

  it("paginates coupon usage rows in descending created order across pages", async () => {
    const coupon = await prisma.coupon.create({
      data: {
        code: "PAGING",
        status: CouponStatus.ACTIVE,
        discountType: CouponDiscountType.PERCENTAGE,
        discountPercentBps: 1000,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        createdById: adminId,
      },
    });

    for (let index = 0; index < 25; index += 1) {
      const timestamp = new Date(`2026-01-01T10:${String(index).padStart(2, "0")}:00.000Z`);
      await prisma.couponRedemption.create({
        data: {
          couponId: coupon.id,
          clientId,
          status: CouponRedemptionStatus.APPLIED,
          couponCodeSnapshot: coupon.code,
          subtotalBeforeMinor: 1_000 + index,
          discountAmountMinor: 100,
          totalAfterMinor: 900 + index,
          currencyCode: "EUR",
          idempotencyKey: `coupon-paging-${index}`,
          payloadHash: `coupon-paging-hash-${index}`,
          appliedAt: timestamp,
          expiresAt: new Date("2026-01-01T11:00:00.000Z"),
          createdAt: timestamp,
        },
      });
    }

    const [firstPage, secondPage] = await Promise.all([
      listAdminCouponUsageHistory({
        actor: { userId: adminId, role: Role.ADMIN },
        page: 1,
        pageSize: 20,
      }),
      listAdminCouponUsageHistory({
        actor: { userId: adminId, role: Role.ADMIN },
        page: 2,
        pageSize: 20,
      }),
    ]);

    expect(firstPage.items).toHaveLength(20);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.items[0]?.subtotalBeforeMinor).toBe(1_024);
    expect(firstPage.items[19]?.subtotalBeforeMinor).toBe(1_005);
    expect(secondPage.items).toHaveLength(5);
    expect(secondPage.items[0]?.subtotalBeforeMinor).toBe(1_004);
    expect(secondPage.items[4]?.subtotalBeforeMinor).toBe(1_000);
  });

  it("caps overlong search queries before filtering results", async () => {
    const cappedPrefix = "Q".repeat(120);
    const ignoredTail = "TAIL";
    const coupon = await prisma.coupon.create({
      data: {
        code: `${cappedPrefix}MATCH`,
        status: CouponStatus.ACTIVE,
        discountType: CouponDiscountType.PERCENTAGE,
        discountPercentBps: 1000,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        createdById: adminId,
      },
    });
    await prisma.couponRedemption.create({
      data: {
        couponId: coupon.id,
        clientId,
        status: CouponRedemptionStatus.APPLIED,
        couponCodeSnapshot: coupon.code,
        subtotalBeforeMinor: 1_000,
        discountAmountMinor: 100,
        totalAfterMinor: 900,
        currencyCode: "EUR",
        idempotencyKey: "coupon-long-query",
        payloadHash: "coupon-long-query-hash",
        appliedAt: new Date("2026-01-01T10:00:00.000Z"),
        expiresAt: new Date("2026-01-01T11:00:00.000Z"),
      },
    });

    const result = await listAdminCouponUsageHistory({
      actor: { userId: adminId, role: Role.ADMIN },
      query: `${cappedPrefix}${ignoredTail}`,
    });

    expect(result.query).toBe(cappedPrefix);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.couponCode).toContain(cappedPrefix);
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
