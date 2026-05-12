import "./helpers/setup-env";

import {
  GiftCardCodeStatus,
  GiftCardWalletStatus,
  OrderStatus,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
  UserActivationStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  issueGiftCardCode,
  lookupGiftCardCodeForRedemption,
  redeemGiftCardCode,
  GiftCardCodeRedemptionError,
} from "../../src/lib/gift-cards/gift-card-code-service";
import { hashRateLimitKey } from "../../src/lib/security/db-rate-limit";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

async function seedClientAndOrder(amountMinor: number) {
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const user = await prisma.user.create({
    data: {
      name: "GC Code Test Client",
      email: `gc.code.${ts}@example.test`,
      role: Role.CLIENT,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      isActive: true,
    },
    select: { id: true, email: true },
  });

  const product = await prisma.product.create({
    data: {
      name: `GC Code Test ${ts}`,
      slug: `gc-code-${ts}`,
      productType: ProductType.GIFT_CARD,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
    select: { id: true },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `gc-code-price-${ts}`,
      stripePriceId: `price_gc_code_${ts}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      name: "GC Code Test Price",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: amountMinor,
      isActive: true,
      isArchived: false,
    },
    select: { id: true },
  });

  const order = await prisma.order.create({
    data: {
      clientId: user.id,
      subtotalAmountMinor: amountMinor,
      totalAmountMinor: amountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PAID,
      items: {
        create: {
          productId: product.id,
          priceId: price.id,
          productNameSnapshot: `GC Code Test ${ts}`,
          priceNameSnapshot: "GC Code Test Price",
          unitAmountMinor: amountMinor,
          lineSubtotalAmountMinor: amountMinor,
          lineTotalAmountMinor: amountMinor,
          currencyCode: "EUR",
        },
      },
    },
    include: { items: true },
  });

  return { user, order, product, price };
}

async function seedWallet(clientId: string, balanceMinor: number) {
  return prisma.giftCardWallet.create({
    data: {
      clientId,
      currencyCode: "EUR",
      balanceMinor,
      status: GiftCardWalletStatus.ACTIVE,
    },
    select: { id: true },
  });
}

describe("issueGiftCardCode", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("issues a new code for an order item and returns plaintext code once", async () => {
    const { user, order } = await seedClientAndOrder(2500);
    const orderItemId = order.items[0]!.id;

    const result = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 2500,
    });

    expect(result.alreadyIssued).toBe(false);
    if (result.alreadyIssued) return;

    expect(result.plaintextCode).toMatch(/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}$/);
    expect(result.maskedCode).toMatch(/^XXXXXXXX-XXXXXXXX-XXXXXXXX-[0-9A-F]{8}$/);

    const stored = await prisma.giftCardCode.findUnique({ where: { orderItemId } });
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe(GiftCardCodeStatus.ISSUED);
    expect(stored?.amountMinor).toBe(2500);
    expect(stored?.codeHash).toBeTruthy();
  });

  it("returns alreadyIssued on duplicate call for same orderItemId", async () => {
    const { user, order } = await seedClientAndOrder(2500);
    const orderItemId = order.items[0]!.id;

    const first = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 2500,
    });
    expect(first.alreadyIssued).toBe(false);

    const second = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 2500,
    });
    expect(second.alreadyIssued).toBe(true);
    expect(second.maskedCode).toBe((first as { maskedCode: string }).maskedCode);
  });
});

describe("lookupGiftCardCodeForRedemption", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("finds a code by exact plaintext code", async () => {
    const { user, order } = await seedClientAndOrder(5000);
    const orderItemId = order.items[0]!.id;

    const issued = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 5000,
    });
    if (issued.alreadyIssued) throw new Error("should not be already issued");

    const found = await lookupGiftCardCodeForRedemption(issued.plaintextCode);
    expect(found).not.toBeNull();
    expect(found?.status).toBe(GiftCardCodeStatus.ISSUED);
    expect(found?.amountMinor).toBe(5000);
  });

  it("normalizes whitespace and hyphens in the lookup", async () => {
    const { user, order } = await seedClientAndOrder(2500);
    const orderItemId = order.items[0]!.id;

    const issued = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 2500,
    });
    if (issued.alreadyIssued) throw new Error("unexpected");

    const raw = issued.plaintextCode.replace(/-/g, " ");
    const found = await lookupGiftCardCodeForRedemption(raw);
    expect(found).not.toBeNull();
  });

  it("returns null for an unknown code", async () => {
    const found = await lookupGiftCardCodeForRedemption("AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD");
    expect(found).toBeNull();
  });
});

describe("redeemGiftCardCode", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("redeems a valid code and credits the redeemer's wallet", async () => {
    const { user, order } = await seedClientAndOrder(3000);
    const orderItemId = order.items[0]!.id;

    const issued = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 3000,
    });
    if (issued.alreadyIssued) throw new Error("unexpected");

    const redeemer = await prisma.user.create({
      data: {
        name: "GC Redeemer",
        email: `gc.redeemer.${Date.now()}@example.test`,
        role: Role.CLIENT,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    const result = await redeemGiftCardCode({
      redeemerUserId: redeemer.id,
      redeemerClientId: redeemer.id,
      plaintextCode: issued.plaintextCode,
    });

    expect(result.amountRedeemedMinor).toBe(3000);
    expect(result.currencyCode).toBe("EUR");
    expect(result.newBalanceMinor).toBe(3000);

    const code = await prisma.giftCardCode.findUnique({ where: { orderItemId } });
    expect(code?.status).toBe(GiftCardCodeStatus.REDEEMED);
    expect(code?.redeemedById).toBe(redeemer.id);
  });

  it("throws INVALID_OR_USED for an unknown code", async () => {
    const user = await prisma.user.create({
      data: {
        name: "GC Test",
        email: `gc.test.${Date.now()}@example.test`,
        role: Role.CLIENT,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    await expect(
      redeemGiftCardCode({
        redeemerUserId: user.id,
        redeemerClientId: user.id,
        plaintextCode: "AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD",
      }),
    ).rejects.toThrow(GiftCardCodeRedemptionError);
  });

  it("throws INVALID_OR_USED for an already-redeemed code", async () => {
    const { user, order } = await seedClientAndOrder(2000);
    const orderItemId = order.items[0]!.id;

    const issued = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 2000,
    });
    if (issued.alreadyIssued) throw new Error("unexpected");

    await seedWallet(user.id, 0);

    await redeemGiftCardCode({
      redeemerUserId: user.id,
      redeemerClientId: user.id,
      plaintextCode: issued.plaintextCode,
    });

    await expect(
      redeemGiftCardCode({
        redeemerUserId: user.id,
        redeemerClientId: user.id,
        plaintextCode: issued.plaintextCode,
      }),
    ).rejects.toMatchObject({ errorCode: "INVALID_OR_USED" });
  });

  it("throws INVALID_OR_USED for an expired code (expiresAt in the past)", async () => {
    const { user, order } = await seedClientAndOrder(1500);
    const orderItemId = order.items[0]!.id;

    const issued = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 1500,
    });
    if (issued.alreadyIssued) throw new Error("unexpected");

    await prisma.giftCardCode.update({
      where: { orderItemId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      redeemGiftCardCode({
        redeemerUserId: user.id,
        redeemerClientId: user.id,
        plaintextCode: issued.plaintextCode,
      }),
    ).rejects.toMatchObject({ errorCode: "INVALID_OR_USED" });
  });

  it("throws INVALID_OR_USED for a voided code", async () => {
    const { user, order } = await seedClientAndOrder(1500);
    const orderItemId = order.items[0]!.id;

    const issued = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 1500,
    });
    if (issued.alreadyIssued) throw new Error("unexpected");

    await prisma.giftCardCode.update({
      where: { orderItemId },
      data: { status: GiftCardCodeStatus.VOIDED },
    });

    await expect(
      redeemGiftCardCode({
        redeemerUserId: user.id,
        redeemerClientId: user.id,
        plaintextCode: issued.plaintextCode,
      }),
    ).rejects.toMatchObject({ errorCode: "INVALID_OR_USED" });
  });

  it("concurrent redemption — exactly one succeeds and the other gets INVALID_OR_USED", async () => {
    const { user, order } = await seedClientAndOrder(2500);
    const orderItemId = order.items[0]!.id;

    const issued = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 2500,
    });
    if (issued.alreadyIssued) throw new Error("unexpected");

    const makeRedeemer = async (label: string) =>
      prisma.user.create({
        data: {
          name: `Concurrent Redeemer ${label}`,
          email: `gc.concurrent.${label}.${Date.now()}@example.test`,
          role: Role.CLIENT,
          activationStatus: UserActivationStatus.ACTIVE,
          emailVerified: new Date(),
          isActive: true,
        },
        select: { id: true },
      });

    // Two different users racing to redeem the same code — different payloadHash
    // ensures the second request cannot succeed via the idempotency replay path.
    const [redeemerA, redeemerB] = await Promise.all([makeRedeemer("a"), makeRedeemer("b")]);

    const results = await Promise.allSettled([
      redeemGiftCardCode({
        redeemerUserId: redeemerA.id,
        redeemerClientId: redeemerA.id,
        plaintextCode: issued.plaintextCode,
      }),
      redeemGiftCardCode({
        redeemerUserId: redeemerB.id,
        redeemerClientId: redeemerB.id,
        plaintextCode: issued.plaintextCode,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ errorCode: "INVALID_OR_USED" });

    const code = await prisma.giftCardCode.findUnique({ where: { orderItemId } });
    expect(code?.status).toBe(GiftCardCodeStatus.REDEEMED);
  });

  it("rate-limit — 6th redemption attempt within window is rejected", async () => {
    const { user, order } = await seedClientAndOrder(1000);
    const orderItemId = order.items[0]!.id;

    const issued = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 1000,
    });
    if (issued.alreadyIssued) throw new Error("unexpected");

    await prisma.rateLimitCounter.upsert({
      where: { keyHash: hashRateLimitKey("gift-card-code-redemption", user.id) },
      create: {
        keyHash: hashRateLimitKey("gift-card-code-redemption", user.id),
        windowStartedAt: new Date(),
        requestCount: 5,
      },
      update: { requestCount: 5 },
    });

    await expect(
      redeemGiftCardCode({
        redeemerUserId: user.id,
        redeemerClientId: user.id,
        plaintextCode: issued.plaintextCode,
      }),
    ).rejects.toMatchObject({ errorCode: "RATE_LIMITED" });
  });
});
