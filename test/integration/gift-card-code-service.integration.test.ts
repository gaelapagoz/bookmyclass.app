import "./helpers/setup-env";

import {
  GiftCardCodeEmailStatus,
  GiftCardCodeSource,
  GiftCardCodeStatus,
  GiftCardWalletStatus,
  OrderStatus,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
  UserActivationStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as giftCardEmail from "../../src/lib/email/gift-card-email";
import { clearCapturedTestEmails, getCapturedTestEmails } from "../../src/lib/email/resend-delivery";

import {
  issueGiftCardCode,
  lookupGiftCardCodeForRedemption,
  redeemGiftCardCode,
  GiftCardCodeRedemptionError,
  generateAdminGiftCardCode,
  voidGiftCardCode,
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
    clearCapturedTestEmails();
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
    expect(stored?.source).toBe(GiftCardCodeSource.PURCHASED);
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

describe("generateAdminGiftCardCode", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates an admin-generated code without wallet credit", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Gift Card Admin",
        email: `gift.card.admin.${Date.now()}@example.test`,
        role: Role.ADMIN,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    const result = await generateAdminGiftCardCode({
      actor: { userId: admin.id, role: Role.ADMIN },
      generatedById: admin.id,
      idempotencyKey: `admin-issue-${Date.now()}`,
      amountMinor: 4200,
      recipientEmail: "recipient@example.test",
      recipientName: "Recipient",
      adminMessage: "Enjoy this gift card.",
      adminReason: "Goodwill adjustment",
    });

    expect(result.source).toBe(GiftCardCodeSource.ADMIN_GENERATED);
    expect(result.status).toBe(GiftCardCodeStatus.ISSUED);
    expect(result.emailStatus).toBe(GiftCardCodeEmailStatus.SENT);

    const stored = await prisma.giftCardCode.findUniqueOrThrow({ where: { id: result.id } });
    expect(stored.orderId).toBeTruthy();
    expect(stored.orderItemId).toBeTruthy();
    expect(stored.purchasedById).toBeNull();
    expect(stored.generatedById).toBe(admin.id);
    expect(stored.codeHash).toBeTruthy();

    const walletCount = await prisma.giftCardWallet.count({ where: { clientId: admin.id } });
    expect(walletCount).toBe(0);

    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty("codeHash");

    const emails = getCapturedTestEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]?.subject).toBe("Your gift card code");
    expect(emails[0]?.html).toContain("Enjoy this gift card.");
    expect(emails[0]?.html).not.toContain("Goodwill adjustment");
  });

  it("rejects invalid amount, invalid email, and missing reason", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Gift Card Admin 2",
        email: `gift.card.admin2.${Date.now()}@example.test`,
        role: Role.ADMIN,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    await expect(
      generateAdminGiftCardCode({
        actor: { userId: admin.id, role: Role.ADMIN },
      generatedById: admin.id,
        idempotencyKey: `invalid-amount-${Date.now()}`,
        amountMinor: 0,
        recipientEmail: "valid@example.test",
        adminReason: "Reason",
      }),
    ).rejects.toThrow();

    await expect(
      generateAdminGiftCardCode({
        actor: { userId: admin.id, role: Role.ADMIN },
      generatedById: admin.id,
        idempotencyKey: `invalid-email-${Date.now()}`,
        amountMinor: 1000,
        recipientEmail: "not-an-email",
        adminReason: "Reason",
      }),
    ).rejects.toThrow();

    await expect(
      generateAdminGiftCardCode({
        actor: { userId: admin.id, role: Role.ADMIN },
      generatedById: admin.id,
        idempotencyKey: `invalid-reason-${Date.now()}`,
        amountMinor: 1000,
        recipientEmail: "valid@example.test",
        adminReason: "",
      }),
    ).rejects.toThrow();
  });

  it("rejects non-admin actor and enforces idempotency", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Gift Card Client",
        email: `gift.card.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    await expect(
      generateAdminGiftCardCode({
        actor: { userId: client.id, role: Role.ADMIN },
        generatedById: client.id,
        idempotencyKey: `forbidden-${Date.now()}`,
        amountMinor: 1200,
        recipientEmail: "recipient@example.test",
        adminReason: "Reason",
      }),
    ).rejects.toMatchObject({ code: "GIFT_CARD_ADMIN_ACTOR_FORBIDDEN" });

    const admin = await prisma.user.create({
      data: {
        name: "Gift Card Admin 3",
        email: `gift.card.admin3.${Date.now()}@example.test`,
        role: Role.ADMIN,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    const key = `idempotent-${Date.now()}`;
    const first = await generateAdminGiftCardCode({
      actor: { userId: admin.id, role: Role.ADMIN },
      generatedById: admin.id,
      idempotencyKey: key,
      amountMinor: 1200,
      recipientEmail: "recipient@example.test",
      adminReason: "Reason",
    });

    const second = await generateAdminGiftCardCode({
      actor: { userId: admin.id, role: Role.ADMIN },
      generatedById: admin.id,
      idempotencyKey: key,
      amountMinor: 1200,
      recipientEmail: "recipient@example.test",
      adminReason: "Reason",
    });

    expect(second.id).toBe(first.id);
  });

  it("marks email status as FAILED when email send throws", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Gift Card Admin 4",
        email: `gift.card.admin4.${Date.now()}@example.test`,
        role: Role.ADMIN,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    const spy = vi.spyOn(giftCardEmail, "sendGiftCardIssuanceEmail").mockRejectedValueOnce(new Error("smtp down"));

    await expect(
      generateAdminGiftCardCode({
        actor: { userId: admin.id, role: Role.ADMIN },
        generatedById: admin.id,
        idempotencyKey: `email-fail-${Date.now()}`,
        amountMinor: 1700,
        recipientEmail: "recipient@example.test",
        adminReason: "Reason",
      }),
    ).rejects.toMatchObject({ code: "GIFT_CARD_ADMIN_EMAIL_DELIVERY_FAILED" });

    const stored = await prisma.giftCardCode.findFirstOrThrow({
      where: { generatedById: admin.id },
      orderBy: { createdAt: "desc" },
    });
    expect(stored.emailStatus).toBe(GiftCardCodeEmailStatus.FAILED);
    spy.mockRestore();
  });

  it("does not mint a second code when retrying a FAILED email intent with a new idempotency key", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Gift Card Admin 5",
        email: `gift.card.admin5.${Date.now()}@example.test`,
        role: Role.ADMIN,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    const failSpy = vi.spyOn(giftCardEmail, "sendGiftCardIssuanceEmail").mockRejectedValueOnce(new Error("smtp down"));
    await expect(
      generateAdminGiftCardCode({
        actor: { userId: admin.id, role: Role.ADMIN },
        generatedById: admin.id,
        idempotencyKey: `email-fail-a-${Date.now()}`,
        amountMinor: 2600,
        recipientEmail: "retry@example.test",
        recipientName: "Retry Recipient",
        adminMessage: "Retry me",
        adminReason: "retry test",
      }),
    ).rejects.toMatchObject({ code: "GIFT_CARD_ADMIN_EMAIL_DELIVERY_FAILED" });
    failSpy.mockRestore();

    const retried = await generateAdminGiftCardCode({
      actor: { userId: admin.id, role: Role.ADMIN },
      generatedById: admin.id,
      idempotencyKey: `email-fail-b-${Date.now()}`,
      amountMinor: 2600,
      recipientEmail: "retry@example.test",
      recipientName: "Retry Recipient",
      adminMessage: "Retry me",
      adminReason: "retry test",
    });

    expect(retried.emailStatus).toBe(GiftCardCodeEmailStatus.FAILED);
    const count = await prisma.giftCardCode.count({
      where: {
        generatedById: admin.id,
        recipientEmail: "retry@example.test",
        amountMinor: 2600,
        source: GiftCardCodeSource.ADMIN_GENERATED,
      },
    });
    expect(count).toBe(1);
  });

  it("rejects idempotency key reuse when payload changes", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Gift Card Admin 6",
        email: `gift.card.admin6.${Date.now()}@example.test`,
        role: Role.ADMIN,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    const key = `payload-mismatch-${Date.now()}`;
    await generateAdminGiftCardCode({
      actor: { userId: admin.id, role: Role.ADMIN },
      generatedById: admin.id,
      idempotencyKey: key,
      amountMinor: 3100,
      recipientEmail: "payload@example.test",
      adminReason: "reason one",
    });

    await expect(
      generateAdminGiftCardCode({
        actor: { userId: admin.id, role: Role.ADMIN },
        generatedById: admin.id,
        idempotencyKey: key,
        amountMinor: 3100,
        recipientEmail: "payload@example.test",
        adminReason: "reason changed",
      }),
    ).rejects.toMatchObject({ code: "GIFT_CARD_ADMIN_IDEMPOTENCY_PAYLOAD_MISMATCH" });
  });
});

describe("voidGiftCardCode", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("voids an issued code and blocks redemption after void", async () => {
    const { user, order } = await seedClientAndOrder(1500);
    const orderItemId = order.items[0]!.id;

    const issued = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 1500,
    });
    if (issued.alreadyIssued) throw new Error("unexpected");

    const admin = await prisma.user.create({
      data: {
        name: "Void Admin",
        email: `void.admin.${Date.now()}@example.test`,
        role: Role.ADMIN,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    const code = await prisma.giftCardCode.findUniqueOrThrow({ where: { orderItemId } });
    const voided = await voidGiftCardCode({
      codeId: code.id,
      actor: { userId: admin.id, role: Role.ADMIN },
        actorUserId: admin.id,
      reason: "Fraud review",
    });
    expect(voided.status).toBe(GiftCardCodeStatus.VOIDED);

    await expect(
      redeemGiftCardCode({
        redeemerUserId: user.id,
        redeemerClientId: user.id,
        plaintextCode: issued.plaintextCode,
      }),
    ).rejects.toMatchObject({ errorCode: "INVALID_OR_USED" });
  });

  it("cannot void a redeemed code", async () => {
    const { user, order } = await seedClientAndOrder(1800);
    const orderItemId = order.items[0]!.id;

    const issued = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 1800,
    });
    if (issued.alreadyIssued) throw new Error("unexpected");

    await redeemGiftCardCode({
      redeemerUserId: user.id,
      redeemerClientId: user.id,
      plaintextCode: issued.plaintextCode,
    });

    const admin = await prisma.user.create({
      data: {
        name: "Void Admin 2",
        email: `void.admin2.${Date.now()}@example.test`,
        role: Role.ADMIN,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    const code = await prisma.giftCardCode.findUniqueOrThrow({ where: { orderItemId } });

    await expect(
      voidGiftCardCode({
        codeId: code.id,
        actor: { userId: admin.id, role: Role.ADMIN },
        actorUserId: admin.id,
        reason: "Late request",
      }),
    ).rejects.toMatchObject({ code: "GIFT_CARD_CODE_NOT_VOIDABLE" });
  });

  it("rejects non-admin actor and writes audit log for void", async () => {
    const { user, order } = await seedClientAndOrder(1900);
    const orderItemId = order.items[0]!.id;
    const issued = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 1900,
    });
    if (issued.alreadyIssued) throw new Error("unexpected");

    const clientActor = await prisma.user.create({
      data: {
        name: "Client Actor",
        email: `client.actor.${Date.now()}@example.test`,
        role: Role.CLIENT,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    const code = await prisma.giftCardCode.findUniqueOrThrow({ where: { orderItemId } });
    await expect(
      voidGiftCardCode({
        codeId: code.id,
        actor: { userId: clientActor.id, role: Role.ADMIN },
        actorUserId: clientActor.id,
        reason: "Nope",
      }),
    ).rejects.toMatchObject({ code: "GIFT_CARD_ADMIN_ACTOR_FORBIDDEN" });

    const admin = await prisma.user.create({
      data: {
        name: "Void Admin 3",
        email: `void.admin3.${Date.now()}@example.test`,
        role: Role.ADMIN,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    await voidGiftCardCode({
      codeId: code.id,
      actor: { userId: admin.id, role: Role.ADMIN },
        actorUserId: admin.id,
      reason: "Fraud review",
    });

    const audit = await prisma.auditLog.findFirst({
      where: {
        actionType: "GIFT_CARD_CODE_VOIDED",
        entityType: "GiftCardCode",
        entityId: code.id,
        actorId: admin.id,
      },
    });
    expect(audit).not.toBeNull();
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

  it("redeems an admin-generated code and credits the redeemer wallet", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Redeem Admin Issuer",
        email: `redeem.admin.issuer.${Date.now()}@example.test`,
        role: Role.ADMIN,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    clearCapturedTestEmails();
    await generateAdminGiftCardCode({
      actor: { userId: admin.id, role: Role.ADMIN },
      generatedById: admin.id,
      idempotencyKey: `admin-redeem-${Date.now()}`,
      amountMinor: 10000,
      recipientEmail: "redeemer@example.test",
      adminReason: "Manual goodwill",
    });

    const delivered = getCapturedTestEmails().at(-1);
    expect(delivered).toBeDefined();
    const plaintextCode = delivered?.html.match(/[0-9A-F]{8}(?:-[0-9A-F]{8}){3}/)?.[0];
    if (!plaintextCode) {
      throw new Error("Expected plaintext gift card code in delivered email");
    }

    const redeemer = await prisma.user.create({
      data: {
        name: "Admin Code Redeemer",
        email: `admin.code.redeemer.${Date.now()}@example.test`,
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
      plaintextCode,
    });

    expect(result.amountRedeemedMinor).toBe(10000);
    expect(result.newBalanceMinor).toBe(10000);
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



