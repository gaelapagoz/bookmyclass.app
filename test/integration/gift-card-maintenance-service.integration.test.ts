import "./helpers/setup-env";

import {
  GiftCardLedgerEntryType,
  GiftCardRedemptionStatus,
  GiftCardWalletStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentryMocks);

import { GET as giftCardMaintenanceRoute } from "../../src/app/api/cron/gift-cards/maintenance/route";
import {
  cleanupExpiredGiftCardReservations,
  type CleanupExpiredGiftCardReservationsResult,
  GIFT_CARD_MAINTENANCE_BATCH_SIZE,
} from "../../src/lib/gift-cards/gift-card-maintenance-service";
import {
  activateGiftCardValue,
  captureGiftCardRedemption,
  reserveGiftCardValue,
} from "../../src/lib/gift-cards/gift-card-wallet-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

const actor = { type: "SYSTEM" as const, label: "gift-card-maintenance-test" };
const baseNow = new Date("2026-05-08T12:00:00.000Z");

async function createClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Gift Maintenance Client ${unique}`,
      email: `gift-maintenance-client-${unique}@example.test`,
      role: Role.CLIENT,
    },
  });
}

async function createGiftCardProduct(amountMinor: number) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const product = await prisma.product.create({
    data: {
      name: `Gift Card ${unique}`,
      slug: `gift-card-maintenance-${unique}`,
      productType: ProductType.GIFT_CARD,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `gift-card-maintenance-${unique}`,
      name: "Gift Card",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: amountMinor,
    },
  });

  return { product, price };
}

async function createOrder(input: { clientId: string; amountMinor: number; withGiftCardPayment?: boolean }) {
  const order = await prisma.order.create({
    data: {
      clientId: input.clientId,
      subtotalAmountMinor: input.amountMinor,
      totalAmountMinor: input.amountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
    },
  });

  if (input.withGiftCardPayment) {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.PENDING,
        method: PaymentMethod.GIFT_CARD,
        provider: PaymentProvider.INTERNAL,
        amountMinor: input.amountMinor,
        currencyCode: "EUR",
      },
    });
  }

  return order;
}

async function activate(clientId: string, amountMinor: number) {
  const { product, price } = await createGiftCardProduct(amountMinor);
  const order = await createOrder({ clientId, amountMinor });
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

  return activateGiftCardValue({
    actor,
    clientId,
    orderId: order.id,
    orderItemId: orderItem.id,
    amountMinor,
    idempotencyKey: `gift-card:activation:orderItem:${orderItem.id}`,
  });
}

async function reserve(input: {
  clientId: string;
  amountMinor: number;
  expiresAt: Date;
  withGiftCardPayment?: boolean;
}) {
  const order = await createOrder({
    clientId: input.clientId,
    amountMinor: input.amountMinor,
    withGiftCardPayment: input.withGiftCardPayment,
  });

  return reserveGiftCardValue({
    actor,
    clientId: input.clientId,
    orderId: order.id,
    amountMinor: input.amountMinor,
    expiresAt: input.expiresAt,
    idempotencyKey: `gift-card:reserve:order:${order.id}`,
  });
}

describe("gift card maintenance cleanup", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn<Console, "error">> | undefined;

  beforeEach(async () => {
    await resetDb();
    sentryMocks.captureException.mockReset();
    sentryMocks.captureMessage.mockReset();
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = undefined;
  });

  it("rejects invalid cron secrets before running cleanup", async () => {
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cron_secret_test";

    try {
      const response = await giftCardMaintenanceRoute(
        new Request("http://localhost/api/cron/gift-cards/maintenance", {
          headers: { authorization: "Bearer wrong" },
        }),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    } finally {
      if (previousSecret === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previousSecret;
      }
    }
  });

  it("runs cleanup and releases expired reservations when CRON_SECRET is valid", async () => {
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cron_secret_test";

    try {
      const client = await createClient();
      await activate(client.id, 3_000);
      await reserve({
        clientId: client.id,
        amountMinor: 1_500,
        expiresAt: new Date(baseNow.getTime() - 1_000),
        withGiftCardPayment: true,
      });

      const response = await giftCardMaintenanceRoute(
        new Request("http://localhost/api/cron/gift-cards/maintenance", {
          headers: { authorization: "Bearer cron_secret_test" },
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        releasedCount: 1,
      });
      expect(
        await prisma.giftCardRedemption.count({ where: { status: GiftCardRedemptionStatus.RELEASED } }),
      ).toBe(1);
    } finally {
      if (previousSecret === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previousSecret;
      }
    }
  });

  it("releases expired reservations and leaves non-expired reservations untouched", async () => {
    const client = await createClient();
    await activate(client.id, 5_000);
    const expired = await reserve({
      clientId: client.id,
      amountMinor: 2_000,
      expiresAt: new Date(baseNow.getTime() - 1_000),
      withGiftCardPayment: true,
    });
    const active = await reserve({
      clientId: client.id,
      amountMinor: 1_000,
      expiresAt: new Date(baseNow.getTime() + 15 * 60 * 1_000),
      withGiftCardPayment: true,
    });

    const result = await cleanupExpiredGiftCardReservations({ now: baseNow });

    expect(result).toMatchObject({
      scannedCount: 1,
      releasedCount: 1,
      failedCount: 0,
      paymentFailedCount: 1,
      orderCancelledCount: 1,
    });
    await expect(prisma.giftCardRedemption.findUniqueOrThrow({ where: { id: expired.redemption.id } }))
      .resolves.toMatchObject({
        status: GiftCardRedemptionStatus.RELEASED,
        releasedAmountMinor: 2_000,
      });
    await expect(prisma.giftCardRedemption.findUniqueOrThrow({ where: { id: active.redemption.id } }))
      .resolves.toMatchObject({
        status: GiftCardRedemptionStatus.RESERVED,
        releasedAmountMinor: 0,
      });
    await expect(prisma.order.findUniqueOrThrow({ where: { id: expired.redemption.orderId } }))
      .resolves.toMatchObject({ status: OrderStatus.CANCELLED });
    await expect(prisma.payment.findFirstOrThrow({ where: { orderId: expired.redemption.orderId } }))
      .resolves.toMatchObject({ status: PaymentStatus.FAILED });
  });

  it("enforces the maintenance batch limit", async () => {
    const client = await createClient();
    await activate(client.id, GIFT_CARD_MAINTENANCE_BATCH_SIZE + 1);
    const expiresAt = new Date(baseNow.getTime() - 1_000);

    for (let index = 0; index < GIFT_CARD_MAINTENANCE_BATCH_SIZE + 1; index += 1) {
      await reserve({ clientId: client.id, amountMinor: 1, expiresAt });
    }

    const result = await cleanupExpiredGiftCardReservations({
      now: baseNow,
      batchSize: GIFT_CARD_MAINTENANCE_BATCH_SIZE + 50,
    });

    expect(result.scannedCount).toBe(GIFT_CARD_MAINTENANCE_BATCH_SIZE);
    expect(result.releasedCount).toBe(GIFT_CARD_MAINTENANCE_BATCH_SIZE);
    expect(await prisma.giftCardRedemption.count({ where: { status: GiftCardRedemptionStatus.RESERVED } })).toBe(1);
  }, 15_000);

  it("is idempotent and creates exactly one release ledger entry", async () => {
    const client = await createClient();
    await activate(client.id, 3_000);
    const reservation = await reserve({
      clientId: client.id,
      amountMinor: 1_500,
      expiresAt: new Date(baseNow.getTime() - 1_000),
    });

    const first = await cleanupExpiredGiftCardReservations({ now: baseNow });
    const second = await cleanupExpiredGiftCardReservations({ now: baseNow });

    expect(first.releasedCount).toBe(1);
    expect(second).toMatchObject({ scannedCount: 0, releasedCount: 0, failedCount: 0 });
    expect(
      await prisma.giftCardLedgerEntry.count({
        where: {
          redemptionId: reservation.redemption.id,
          entryType: GiftCardLedgerEntryType.RELEASE,
        },
      }),
    ).toBe(1);
    await expect(prisma.giftCardRedemption.findUniqueOrThrow({ where: { id: reservation.redemption.id } }))
      .resolves.toMatchObject({ releasedAmountMinor: 1_500 });
  });

  it("does not double-release when cleanup races capture completion", async () => {
    const client = await createClient();
    await activate(client.id, 3_000);
    const reservation = await reserve({
      clientId: client.id,
      amountMinor: 1_500,
      expiresAt: new Date(baseNow.getTime() - 1_000),
    });

    const results = await Promise.allSettled([
      cleanupExpiredGiftCardReservations({ now: baseNow }),
      captureGiftCardRedemption({
        actor,
        redemptionId: reservation.redemption.id,
        idempotencyKey: `gift-card:capture:redemption:${reservation.redemption.id}`,
      }),
    ]);

    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const financialTransitions = await prisma.giftCardLedgerEntry.findMany({
      where: {
        redemptionId: reservation.redemption.id,
        entryType: { in: [GiftCardLedgerEntryType.CAPTURE, GiftCardLedgerEntryType.RELEASE] },
      },
    });
    expect(financialTransitions).toHaveLength(1);
    expect(financialTransitions[0]?.entryType).toMatch(/CAPTURE|RELEASE/);
    const cleanupResult =
      results[0].status === "fulfilled"
        ? (results[0] as PromiseFulfilledResult<CleanupExpiredGiftCardReservationsResult>).value
        : null;
    if (cleanupResult && financialTransitions[0]?.entryType === GiftCardLedgerEntryType.CAPTURE) {
      expect(cleanupResult.skippedCount).toBe(1);
    }
  });

  it("side effects are no-op when cleanup runs via idempotent release path", async () => {
    const client = await createClient();
    await activate(client.id, 3_000);
    const reservation = await reserve({
      clientId: client.id,
      amountMinor: 1_500,
      expiresAt: new Date(baseNow.getTime() - 1_000),
      withGiftCardPayment: true,
    });

    const first = await cleanupExpiredGiftCardReservations({ now: baseNow });
    expect(first).toMatchObject({ releasedCount: 1, paymentFailedCount: 1, orderCancelledCount: 1 });

    // Force redemption back to RESERVED so the second cleanup finds it again.
    // This triggers the idempotent-release path: the release ledger entry already
    // exists so releaseGiftCardRedemption returns idempotent=true, then
    // markExpiredReservationSideEffects runs against an already-CANCELLED order.
    await prisma.giftCardRedemption.update({
      where: { id: reservation.redemption.id },
      data: { status: GiftCardRedemptionStatus.RESERVED },
    });

    const second = await cleanupExpiredGiftCardReservations({ now: baseNow });

    expect(second).toMatchObject({
      scannedCount: 1,
      releasedCount: 0,
      failedCount: 0,
      paymentFailedCount: 0,
      orderCancelledCount: 0,
    });
  });

  it("emits an alert event when cleanup fails", async () => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = await createClient();
    const activation = await activate(client.id, 3_000);
    const reservation = await reserve({
      clientId: client.id,
      amountMinor: 1_500,
      expiresAt: new Date(baseNow.getTime() - 1_000),
    });
    await prisma.giftCardWallet.update({
      where: { id: activation.wallet.id },
      data: { status: GiftCardWalletStatus.SUSPENDED },
    });

    const result = await cleanupExpiredGiftCardReservations({ now: baseNow });

    expect(result).toMatchObject({ scannedCount: 1, releasedCount: 0, failedCount: 1 });
    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[gift_card.reservation_cleanup_failed]",
      expect.objectContaining({ entityId: reservation.redemption.id }),
    );
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: {
          actionType: "gift_card.reservation_cleanup_failed",
          entityType: "GiftCardRedemption",
          entityId: reservation.redemption.id,
        },
      }),
    ).resolves.toBeTruthy();
  });
});
