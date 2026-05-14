import "./helpers/setup-env";

import {
  GiftCardCodeStatus,
  OrderStatus,
  PriceType,
  ProductType,
  Role,
  UserActivationStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  requestGiftCardCodeResend,
  GiftCardCodeResendError,
} from "../../src/lib/gift-cards/gift-card-code-service";
import { clearCapturedTestEmails, getCapturedTestEmails } from "../../src/lib/email/resend-delivery";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

async function seedClient() {
  return prisma.user.create({
    data: {
      name: "Resend Test Client",
      email: `resend.${Date.now()}.${Math.random()}@example.test`,
      role: Role.CLIENT,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      isActive: true,
    },
  });
}

async function seedGiftCardCode(
  purchasedById: string,
  status: GiftCardCodeStatus = GiftCardCodeStatus.ISSUED,
) {
  const ts = `${Date.now()}-${Math.random()}`;
  const order = await prisma.order.create({
    data: {
      clientId: purchasedById,
      subtotalAmountMinor: 5000,
      discountAmountMinor: 0,
      totalAmountMinor: 5000,
      currencyCode: "EUR",
      status: OrderStatus.PAID,
    },
  });
  const product = await prisma.product.create({
    data: {
      name: `GC ${ts}`,
      slug: `gc-resend-${ts}`,
      productType: ProductType.GIFT_CARD,
      isActive: true,
      isArchived: false,
      sortOrder: 0,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `gc-resend-price-${ts}`,
      name: "Gift Card",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 5000,
      isActive: true,
      isArchived: false,
    },
  });
  const orderItem = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      priceId: price.id,
      quantity: 1,
      productNameSnapshot: "Gift Card",
      priceNameSnapshot: "Gift Card Price",
      unitAmountMinor: 5000,
      lineSubtotalAmountMinor: 5000,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: 5000,
      currencyCode: "EUR",
    },
  });
  const codeRecord = await prisma.giftCardCode.create({
    data: {
      orderId: order.id,
      orderItemId: orderItem.id,
      purchasedById,
      codeHash: `hash-${ts}`.padEnd(64, "0").slice(0, 64),
      maskedCode: `XXXXXXXX-XXXXXXXX-XXXXXXXX-${ts.slice(-8).toUpperCase()}`,
      amountMinor: 5000,
      currencyCode: "EUR",
      status,
      issuedAt: new Date(),
    },
  });
  return { order, orderItem, codeRecord };
}

describe("requestGiftCardCodeResend (Issue 4)", () => {
  beforeEach(async () => {
    await resetDb();
    clearCapturedTestEmails();
    process.env.E2E_TEST_MODE = "1";
  });

  it("rotates the code and sends an email for an ISSUED code owned by the requester", async () => {
    const client = await seedClient();
    const { orderItem, codeRecord } = await seedGiftCardCode(client.id, GiftCardCodeStatus.ISSUED);

    const result = await requestGiftCardCodeResend({
      orderItemId: orderItem.id,
      requestedById: client.id,
    });

    expect(result.outcome).toBe("sent");

    // The code hash must have changed (old code invalidated)
    const updated = await prisma.giftCardCode.findUnique({
      where: { orderItemId: orderItem.id },
      select: { codeHash: true, maskedCode: true },
    });
    expect(updated!.codeHash).not.toBe(codeRecord.codeHash);
    expect(updated!.maskedCode).not.toBe(codeRecord.maskedCode);

    // Email was sent
    const emails = getCapturedTestEmails();
    const issuanceEmail = emails.find((e) => e.context === "gift-card-issuance");
    expect(issuanceEmail).toBeDefined();
    expect(issuanceEmail!.to).toContain(client.email.toLowerCase());

    const audit = await prisma.auditLog.findFirst({
      where: {
        actionType: "GIFT_CARD_CODE_RESENT",
        entityType: "GiftCardCode",
        entityId: codeRecord.id,
      },
    });
    expect(audit).not.toBeNull();
  });

  it("throws OWNERSHIP_DENIED when requester is not the purchaser", async () => {
    const owner = await seedClient();
    const attacker = await seedClient();
    const { orderItem } = await seedGiftCardCode(owner.id, GiftCardCodeStatus.ISSUED);

    await expect(
      requestGiftCardCodeResend({ orderItemId: orderItem.id, requestedById: attacker.id }),
    ).rejects.toThrow(GiftCardCodeResendError);

    try {
      await requestGiftCardCodeResend({ orderItemId: orderItem.id, requestedById: attacker.id });
    } catch (error) {
      expect(error).toBeInstanceOf(GiftCardCodeResendError);
      expect((error as GiftCardCodeResendError).errorCode).toBe("OWNERSHIP_DENIED");
    }
  });

  it("returns already_redeemed for a REDEEMED code", async () => {
    const client = await seedClient();
    const { orderItem } = await seedGiftCardCode(client.id, GiftCardCodeStatus.REDEEMED);

    const result = await requestGiftCardCodeResend({
      orderItemId: orderItem.id,
      requestedById: client.id,
    });

    expect(result.outcome).toBe("already_redeemed");
    // No email sent
    expect(getCapturedTestEmails()).toHaveLength(0);
  });

  it("returns not_resendable/voided for a VOIDED code", async () => {
    const client = await seedClient();
    const { orderItem } = await seedGiftCardCode(client.id, GiftCardCodeStatus.VOIDED);

    const result = await requestGiftCardCodeResend({
      orderItemId: orderItem.id,
      requestedById: client.id,
    });

    expect(result.outcome).toBe("not_resendable");
    if (result.outcome === "not_resendable") {
      expect(result.reason).toBe("voided");
    }
  });

  it("returns not_resendable/expired for an expired code", async () => {
    const client = await seedClient();
    const { orderItem } = await seedGiftCardCode(client.id, GiftCardCodeStatus.ISSUED);
    await prisma.giftCardCode.update({
      where: { orderItemId: orderItem.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const result = await requestGiftCardCodeResend({
      orderItemId: orderItem.id,
      requestedById: client.id,
    });

    expect(result.outcome).toBe("not_resendable");
    if (result.outcome === "not_resendable") {
      expect(result.reason).toBe("expired");
    }
    expect(getCapturedTestEmails()).toHaveLength(0);
  });

  it("throws NOT_FOUND for a non-existent orderItemId", async () => {
    const client = await seedClient();

    await expect(
      requestGiftCardCodeResend({
        orderItemId: "non-existent-item-id",
        requestedById: client.id,
      }),
    ).rejects.toThrow(GiftCardCodeResendError);
  });

  it("does not expose codeHash in the result", async () => {
    const client = await seedClient();
    const { orderItem } = await seedGiftCardCode(client.id, GiftCardCodeStatus.ISSUED);

    const result = await requestGiftCardCodeResend({
      orderItemId: orderItem.id,
      requestedById: client.id,
    });

    // The result only contains maskedCode (XXXXXXXX... format), not the hash
    if (result.outcome === "sent") {
      expect(result.maskedCode).toMatch(/X{8}-/);
      expect(result.maskedCode).not.toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
