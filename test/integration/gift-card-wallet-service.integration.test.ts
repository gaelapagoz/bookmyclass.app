import "./helpers/setup-env";

import { GiftCardLedgerEntryType, GiftCardRedemptionStatus, PriceType, ProductType, Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../../src/lib/db";
import { GiftCardIdempotencyConflictError } from "../../src/lib/gift-cards/gift-card-errors";
import {
  activateGiftCardValue,
  assertGiftCardWalletInvariant,
  captureGiftCardRedemption,
  getGiftCardWalletBalance,
  releaseGiftCardRedemption,
  reserveGiftCardValue,
} from "../../src/lib/gift-cards/gift-card-wallet-service";
import { resetDb } from "./helpers/reset-db";

const actor = { type: "SYSTEM" as const, label: "gift-card-foundation-test" };

async function createClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Gift Client ${unique}`,
      email: `gift-client-${unique}@example.test`,
      role: Role.CLIENT,
    },
  });
}

async function createNonClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Gift Admin ${unique}`,
      email: `gift-admin-${unique}@example.test`,
      role: Role.ADMIN,
    },
  });
}

async function createGiftCardOrder(clientId: string, amountMinor = 5_000) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const product = await prisma.product.create({
    data: {
      name: `Gift Card ${unique}`,
      slug: `gift-card-${unique}`,
      productType: ProductType.GIFT_CARD,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `gift-card-${unique}`,
      name: "Gift Card",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: amountMinor,
    },
  });
  const order = await prisma.order.create({
    data: {
      clientId,
      subtotalAmountMinor: amountMinor,
      totalAmountMinor: amountMinor,
      currencyCode: "EUR",
    },
  });
  const orderItem = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      priceId: price.id,
      productNameSnapshot: product.name,
      priceNameSnapshot: price.name,
      unitAmountMinor: amountMinor,
      lineSubtotalAmountMinor: amountMinor,
      lineTotalAmountMinor: amountMinor,
      currencyCode: "EUR",
    },
  });

  return { order, orderItem };
}

async function activate(clientId: string, amountMinor = 5_000) {
  const { order, orderItem } = await createGiftCardOrder(clientId, amountMinor);
  return activateGiftCardValue({
    actor,
    clientId,
    orderId: order.id,
    orderItemId: orderItem.id,
    amountMinor,
    idempotencyKey: `gift-card:activation:orderItem:${orderItem.id}`,
  });
}

async function reserve(clientId: string, amountMinor = 2_000) {
  const order = await createOrder(clientId, amountMinor);
  return reserveGiftCardValue({
    actor,
    clientId,
    orderId: order.id,
    amountMinor,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    idempotencyKey: `gift-card:reserve:order:${order.id}`,
  });
}

async function createOrder(clientId: string, amountMinor = 2_000) {
  return prisma.order.create({
    data: {
      clientId,
      subtotalAmountMinor: amountMinor,
      totalAmountMinor: amountMinor,
      currencyCode: "EUR",
    },
  });
}

describe("gift card wallet foundation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("tracks settled and available wallet balances from ledger entries", async () => {
    const client = await createClient();
    const activation = await activate(client.id, 10_000);
    const order = await createOrder(client.id);

    const reserve = await reserveGiftCardValue({
      actor,
      clientId: client.id,
      orderId: order.id,
      amountMinor: 3_000,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      idempotencyKey: `gift-card:reserve:order:${order.id}`,
    });

    const reservedBalance = await getGiftCardWalletBalance(client.id);
    expect(reservedBalance?.balanceMinor).toBe(10_000);
    expect(reservedBalance?.availableBalanceMinor).toBe(7_000);

    await captureGiftCardRedemption({
      actor,
      redemptionId: reserve.redemption.id,
      idempotencyKey: `gift-card:capture:redemption:${reserve.redemption.id}`,
    });

    const invariant = await assertGiftCardWalletInvariant(activation.wallet.id);
    expect(invariant.balanceMinor).toBe(7_000);
    expect(invariant.availableBalanceMinor).toBe(7_000);
  });

  it("rejects wallet creation for non-client users", async () => {
    const admin = await createNonClient();
    const { order, orderItem } = await createGiftCardOrder(admin.id);

    await expect(
      activateGiftCardValue({
        actor,
        clientId: admin.id,
        orderId: order.id,
        orderItemId: orderItem.id,
        amountMinor: 5_000,
        idempotencyKey: `gift-card:activation:orderItem:${orderItem.id}`,
      }),
    ).rejects.toMatchObject({ code: "GIFT_CARD_CLIENT_REQUIRED" });
  });

  it("replays activation, reserve, capture, and release idempotently", async () => {
    const client = await createClient();
    const { order, orderItem } = await createGiftCardOrder(client.id, 8_000);
    const activationInput = {
      actor,
      clientId: client.id,
      orderId: order.id,
      orderItemId: orderItem.id,
      amountMinor: 8_000,
      idempotencyKey: `gift-card:activation:orderItem:${orderItem.id}`,
    };

    const firstActivation = await activateGiftCardValue(activationInput);
    const secondActivation = await activateGiftCardValue(activationInput);
    expect(firstActivation.idempotent).toBe(false);
    expect(secondActivation.idempotent).toBe(true);

    const reserveOrder = await createOrder(client.id);
    const reserveInput = {
      actor,
      clientId: client.id,
      orderId: reserveOrder.id,
      amountMinor: 2_000,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      idempotencyKey: `gift-card:reserve:order:${reserveOrder.id}`,
    };
    const firstReserve = await reserveGiftCardValue(reserveInput);
    const secondReserve = await reserveGiftCardValue(reserveInput);
    expect(firstReserve.idempotent).toBe(false);
    expect(secondReserve.idempotent).toBe(true);

    const captureInput = {
      actor,
      redemptionId: firstReserve.redemption.id,
      idempotencyKey: `gift-card:capture:redemption:${firstReserve.redemption.id}`,
    };
    const firstCapture = await captureGiftCardRedemption(captureInput);
    const secondCapture = await captureGiftCardRedemption(captureInput);
    expect(firstCapture.idempotent).toBe(false);
    expect(secondCapture.idempotent).toBe(true);

    const releaseOrder = await createOrder(client.id);
    const releaseReserve = await reserveGiftCardValue({
      actor,
      clientId: client.id,
      orderId: releaseOrder.id,
      amountMinor: 1_000,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      idempotencyKey: `gift-card:reserve:order:${releaseOrder.id}`,
    });
    const releaseInput = {
      actor,
      redemptionId: releaseReserve.redemption.id,
      idempotencyKey: `gift-card:release:redemption:${releaseReserve.redemption.id}`,
    };
    const firstRelease = await releaseGiftCardRedemption(releaseInput);
    const secondRelease = await releaseGiftCardRedemption(releaseInput);
    expect(firstRelease.idempotent).toBe(false);
    expect(secondRelease.idempotent).toBe(true);
  });

  it("rejects same activation idempotency key with a different payload", async () => {
    const client = await createClient();
    const { order, orderItem } = await createGiftCardOrder(client.id, 4_000);
    const key = `gift-card:activation:orderItem:${orderItem.id}`;

    await activateGiftCardValue({
      actor,
      clientId: client.id,
      orderId: order.id,
      orderItemId: orderItem.id,
      amountMinor: 4_000,
      idempotencyKey: key,
    });

    await expect(
      activateGiftCardValue({
        actor,
        clientId: client.id,
        orderId: order.id,
        orderItemId: orderItem.id,
        amountMinor: 5_000,
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(GiftCardIdempotencyConflictError);
  });

  it("rejects same reserve idempotency key with a different payload", async () => {
    const client = await createClient();
    await activate(client.id, 8_000);
    const order = await createOrder(client.id);
    const key = `gift-card:reserve:order:${order.id}`;

    await reserveGiftCardValue({
      actor,
      clientId: client.id,
      orderId: order.id,
      amountMinor: 2_000,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      idempotencyKey: key,
    });

    await expect(
      reserveGiftCardValue({
        actor,
        clientId: client.id,
        orderId: order.id,
        amountMinor: 3_000,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(GiftCardIdempotencyConflictError);
  });

  it("rejects same capture idempotency key with a different payload", async () => {
    const client = await createClient();
    await activate(client.id, 8_000);
    const reserveResult = await reserve(client.id, 2_000);
    const key = `gift-card:capture:redemption:${reserveResult.redemption.id}`;

    await captureGiftCardRedemption({
      actor,
      redemptionId: reserveResult.redemption.id,
      idempotencyKey: key,
    });

    await expect(
      captureGiftCardRedemption({
        actor,
        redemptionId: reserveResult.redemption.id,
        paymentId: "different-payment-id",
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(GiftCardIdempotencyConflictError);
  });

  it("rejects same release idempotency key with a different payload", async () => {
    const client = await createClient();
    await activate(client.id, 8_000);
    const firstReserve = await reserve(client.id, 1_000);
    const secondReserve = await reserve(client.id, 1_000);
    const key = `gift-card:release:redemption:${firstReserve.redemption.id}`;

    await releaseGiftCardRedemption({
      actor,
      redemptionId: firstReserve.redemption.id,
      idempotencyKey: key,
    });

    await expect(
      releaseGiftCardRedemption({
        actor,
        redemptionId: secondReserve.redemption.id,
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(GiftCardIdempotencyConflictError);
  });

  it("allows only one activation per order item", async () => {
    const client = await createClient();
    const { order, orderItem } = await createGiftCardOrder(client.id, 4_000);

    await activateGiftCardValue({
      actor,
      clientId: client.id,
      orderId: order.id,
      orderItemId: orderItem.id,
      amountMinor: 4_000,
      idempotencyKey: `gift-card:activation:orderItem:${orderItem.id}`,
    });

    await expect(
      activateGiftCardValue({
        actor,
        clientId: client.id,
        orderId: order.id,
        orderItemId: orderItem.id,
        amountMinor: 4_000,
        idempotencyKey: `gift-card:activation:orderItem:${orderItem.id}:different`,
      }),
    ).rejects.toMatchObject({ code: "GIFT_CARD_ACTIVATION_ORDER_ITEM_ALREADY_EXISTS" });
  });

  it("rejects invalid capture and release transitions", async () => {
    const client = await createClient();
    await activate(client.id, 5_000);
    const order = await createOrder(client.id);
    const reserve = await reserveGiftCardValue({
      actor,
      clientId: client.id,
      orderId: order.id,
      amountMinor: 2_000,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      idempotencyKey: `gift-card:reserve:order:${order.id}`,
    });

    await captureGiftCardRedemption({
      actor,
      redemptionId: reserve.redemption.id,
      idempotencyKey: `gift-card:capture:redemption:${reserve.redemption.id}`,
    });

    await expect(
      releaseGiftCardRedemption({
        actor,
        redemptionId: reserve.redemption.id,
        idempotencyKey: `gift-card:release:redemption:${reserve.redemption.id}`,
      }),
    ).rejects.toMatchObject({ code: "GIFT_CARD_INVALID_TRANSITION" });
  });

  it("prevents concurrent reserves from overspending available balance", async () => {
    const client = await createClient();
    await activate(client.id, 5_000);
    const [orderA, orderB] = await Promise.all([createOrder(client.id), createOrder(client.id)]);

    const results = await Promise.allSettled([
      reserveGiftCardValue({
        actor,
        clientId: client.id,
        orderId: orderA.id,
        amountMinor: 4_000,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        idempotencyKey: `gift-card:reserve:order:${orderA.id}`,
      }),
      reserveGiftCardValue({
        actor,
        clientId: client.id,
        orderId: orderB.id,
        amountMinor: 4_000,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        idempotencyKey: `gift-card:reserve:order:${orderB.id}`,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const balance = await getGiftCardWalletBalance(client.id);
    expect(balance?.availableBalanceMinor).toBe(1_000);
  });

  it("replays concurrent same-key activation without surfacing unique errors", async () => {
    const client = await createClient();
    const { order, orderItem } = await createGiftCardOrder(client.id, 4_000);
    const input = {
      actor,
      clientId: client.id,
      orderId: order.id,
      orderItemId: orderItem.id,
      amountMinor: 4_000,
      idempotencyKey: `gift-card:activation:orderItem:${orderItem.id}`,
    };

    const results = await Promise.allSettled([
      activateGiftCardValue(input),
      activateGiftCardValue(input),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await prisma.giftCardLedgerEntry.count({ where: { idempotencyKey: input.idempotencyKey } })).toBe(1);
    expect((await getGiftCardWalletBalance(client.id))?.balanceMinor).toBe(4_000);
  });

  it("replays concurrent same-key reserve without surfacing unique errors", async () => {
    const client = await createClient();
    await activate(client.id, 4_000);
    const order = await createOrder(client.id, 2_000);
    const input = {
      actor,
      clientId: client.id,
      orderId: order.id,
      amountMinor: 2_000,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      idempotencyKey: `gift-card:reserve:order:${order.id}`,
    };

    const results = await Promise.allSettled([
      reserveGiftCardValue(input),
      reserveGiftCardValue(input),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await prisma.giftCardRedemption.count({ where: { idempotencyKey: input.idempotencyKey } })).toBe(1);
    expect((await getGiftCardWalletBalance(client.id))?.availableBalanceMinor).toBe(2_000);
  });

  it("replays concurrent same-key capture without surfacing unique errors", async () => {
    const client = await createClient();
    await activate(client.id, 4_000);
    const reserveResult = await reserve(client.id, 2_000);
    const input = {
      actor,
      redemptionId: reserveResult.redemption.id,
      idempotencyKey: `gift-card:capture:redemption:${reserveResult.redemption.id}`,
    };

    const results = await Promise.allSettled([
      captureGiftCardRedemption(input),
      captureGiftCardRedemption(input),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await prisma.giftCardLedgerEntry.count({ where: { idempotencyKey: input.idempotencyKey } })).toBe(1);
    expect((await getGiftCardWalletBalance(client.id))?.balanceMinor).toBe(2_000);
  });

  it("replays concurrent same-key release without surfacing unique errors", async () => {
    const client = await createClient();
    await activate(client.id, 4_000);
    const reserveResult = await reserve(client.id, 2_000);
    const input = {
      actor,
      redemptionId: reserveResult.redemption.id,
      idempotencyKey: `gift-card:release:redemption:${reserveResult.redemption.id}`,
    };

    const results = await Promise.allSettled([
      releaseGiftCardRedemption(input),
      releaseGiftCardRedemption(input),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await prisma.giftCardLedgerEntry.count({ where: { idempotencyKey: input.idempotencyKey } })).toBe(1);
    expect((await getGiftCardWalletBalance(client.id))?.availableBalanceMinor).toBe(4_000);
  });

  it("allows only one concurrent capture or release transition to win", async () => {
    const client = await createClient();
    await activate(client.id, 4_000);
    const reserveResult = await reserve(client.id, 2_000);

    const results = await Promise.allSettled([
      captureGiftCardRedemption({
        actor,
        redemptionId: reserveResult.redemption.id,
        idempotencyKey: `gift-card:capture:redemption:${reserveResult.redemption.id}`,
      }),
      releaseGiftCardRedemption({
        actor,
        redemptionId: reserveResult.redemption.id,
        idempotencyKey: `gift-card:release:redemption:${reserveResult.redemption.id}`,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const financialTransitions = await prisma.giftCardLedgerEntry.count({
      where: {
        redemptionId: reserveResult.redemption.id,
        entryType: { in: [GiftCardLedgerEntryType.CAPTURE, GiftCardLedgerEntryType.RELEASE] },
      },
    });
    expect(financialTransitions).toBe(1);
  });

  it("enforces one RESERVED redemption per order with a partial unique index", async () => {
    const client = await createClient();
    await activate(client.id, 8_000);
    const order = await createOrder(client.id);

    await reserveGiftCardValue({
      actor,
      clientId: client.id,
      orderId: order.id,
      amountMinor: 2_000,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      idempotencyKey: `gift-card:reserve:order:${order.id}`,
    });

    await expect(
      reserveGiftCardValue({
        actor,
        clientId: client.id,
        orderId: order.id,
        amountMinor: 1_000,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        idempotencyKey: `gift-card:reserve:order:${order.id}:second`,
      }),
    ).rejects.toMatchObject({ code: "GIFT_CARD_RESERVED_REDEMPTION_ALREADY_EXISTS" });
  });

  it("keeps release ledger entries single and records released amount", async () => {
    const client = await createClient();
    await activate(client.id, 5_000);
    const order = await createOrder(client.id);
    const reserve = await reserveGiftCardValue({
      actor,
      clientId: client.id,
      orderId: order.id,
      amountMinor: 2_000,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      idempotencyKey: `gift-card:reserve:order:${order.id}`,
    });

    const release = await releaseGiftCardRedemption({
      actor,
      redemptionId: reserve.redemption.id,
      idempotencyKey: `gift-card:release:redemption:${reserve.redemption.id}`,
    });

    expect(release.redemption.status).toBe(GiftCardRedemptionStatus.RELEASED);
    expect(release.redemption.releasedAmountMinor).toBe(2_000);
    const releaseCount = await prisma.giftCardLedgerEntry.count({
      where: { redemptionId: reserve.redemption.id, entryType: GiftCardLedgerEntryType.RELEASE },
    });
    expect(releaseCount).toBe(1);
  });

  it("protects activation ledger provenance at the database level", async () => {
    const client = await createClient();
    const { order, orderItem } = await createGiftCardOrder(client.id, 4_000);
    const activation = await activateGiftCardValue({
      actor,
      clientId: client.id,
      orderId: order.id,
      orderItemId: orderItem.id,
      amountMinor: 4_000,
      idempotencyKey: `gift-card:activation:orderItem:${orderItem.id}`,
    });

    await expect(prisma.orderItem.delete({ where: { id: orderItem.id } })).rejects.toThrow();
    await expect(
      prisma.giftCardLedgerEntry.create({
        data: {
          walletId: activation.wallet.id,
          clientId: client.id,
          entryType: GiftCardLedgerEntryType.ACTIVATION,
          amountMinor: 1_000,
          currencyCode: "EUR",
          idempotencyKey: `gift-card:activation:orderItem:missing-${orderItem.id}`,
          payloadHash: "missing-order-item-test",
        },
      }),
    ).rejects.toThrow();
  });
});
