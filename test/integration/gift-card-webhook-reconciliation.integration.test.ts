import "./helpers/setup-env";

import {
  CheckoutSource,
  GiftCardCodeStatus,
  GiftCardLedgerEntryType,
  GiftCardReconciliationStatus,
  GiftCardRedemptionStatus,
  GiftCardWalletStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
  StripeWebhookReceiptStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentryMocks);
vi.mock("@/lib/payments/stripe", () => ({
  getStripeClient: () => ({
    checkout: {
      sessions: {
        retrieve: () => {
          throw new Error("Stripe checkout.sessions.retrieve should not be called in this test");
        },
      },
    },
    subscriptions: {
      retrieve: () => {
        throw new Error("Stripe subscriptions.retrieve should not be called in this test");
      },
    },
  }),
}));

import { processStripeWebhookEvent } from "../../src/lib/public-booking/stripe-webhook-service";
import {
  reserveGiftCardValue,
} from "../../src/lib/gift-cards/gift-card-wallet-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

const actor = { type: "SYSTEM" as const, label: "gift-card-webhook-test" };

async function createClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Gift Webhook Client ${unique}`,
      email: `gift-webhook-client-${unique}@example.test`,
      role: Role.CLIENT,
    },
  });
}

async function createProduct(input: { productType: ProductType; amountMinor: number }) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const product = await prisma.product.create({
    data: {
      name: `${input.productType} ${unique}`,
      slug: `gift-webhook-${input.productType.toLowerCase()}-${unique}`,
      productType: input.productType,
      isActive: true,
      isArchived: false,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `gift-webhook-price-${unique}`,
      name: `${input.productType} Price`,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: input.amountMinor,
      isActive: true,
      isArchived: false,
    },
  });

  return { product, price };
}

async function createPaidGiftCardOrder(input: {
  clientId: string;
  lines: Array<{ amountMinor: number; quantity: number }>;
  sessionId: string;
}) {
  const totalAmountMinor = input.lines.reduce(
    (total, line) => total + line.amountMinor * line.quantity,
    0,
  );
  const order = await prisma.order.create({
    data: {
      clientId: input.clientId,
      subtotalAmountMinor: totalAmountMinor,
      totalAmountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
    },
  });

  for (const line of input.lines) {
    const { product, price } = await createProduct({
      productType: ProductType.GIFT_CARD,
      amountMinor: line.amountMinor,
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        priceId: price.id,
        quantity: line.quantity,
        productNameSnapshot: product.name,
        priceNameSnapshot: price.name,
        unitAmountMinor: line.amountMinor,
        lineSubtotalAmountMinor: line.amountMinor * line.quantity,
        lineTotalAmountMinor: line.amountMinor * line.quantity,
        currencyCode: "EUR",
      },
    });
  }

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: input.sessionId,
      checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
      amountMinor: totalAmountMinor,
      currencyCode: "EUR",
    },
  });

  return { order, payment };
}

function completedEvent(input: {
  eventId: string;
  sessionId: string;
  paymentId: string;
  orderId: string;
  clientId: string;
}) {
  return {
    id: input.eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: input.sessionId,
        mode: "payment",
        payment_status: "paid",
        payment_intent: `pi_${input.eventId}`,
        metadata: {
          source: "CART_CHECKOUT_V1",
          orderId: input.orderId,
          paymentId: input.paymentId,
          userId: input.clientId,
        },
      },
    },
  } as unknown as import("stripe").default.Event;
}

async function createPartialGiftCardOrder(input: {
  clientId: string;
  sessionId: string;
  walletBalanceMinor?: number;
  walletAmountMinor?: number;
  totalAmountMinor?: number;
}) {
  const walletBalanceMinor = input.walletBalanceMinor ?? 5_000;
  const walletAmountMinor = input.walletAmountMinor ?? 2_500;
  const totalAmountMinor = input.totalAmountMinor ?? 5_000;
  const wallet = await prisma.giftCardWallet.create({
    data: {
      clientId: input.clientId,
      currencyCode: "EUR",
      balanceMinor: walletBalanceMinor,
    },
  });
  const merch = await createProduct({
    productType: ProductType.MERCHANDISE,
    amountMinor: totalAmountMinor,
  });
  const order = await prisma.order.create({
    data: {
      clientId: input.clientId,
      subtotalAmountMinor: totalAmountMinor,
      totalAmountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
      items: {
        create: {
          productId: merch.product.id,
          priceId: merch.price.id,
          quantity: 1,
          productNameSnapshot: merch.product.name,
          priceNameSnapshot: merch.price.name,
          unitAmountMinor: totalAmountMinor,
          lineSubtotalAmountMinor: totalAmountMinor,
          lineTotalAmountMinor: totalAmountMinor,
          currencyCode: "EUR",
        },
      },
    },
  });
  const stripePayment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: input.sessionId,
      checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
      amountMinor: totalAmountMinor - walletAmountMinor,
      currencyCode: "EUR",
    },
  });
  const giftCardPayment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.GIFT_CARD,
      provider: PaymentProvider.INTERNAL,
      amountMinor: walletAmountMinor,
      currencyCode: "EUR",
    },
  });
  const reservation = await reserveGiftCardValue({
    actor,
    clientId: input.clientId,
    orderId: order.id,
    amountMinor: walletAmountMinor,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    idempotencyKey: `gift-card:reserve:order:${order.id}`,
  });

  return { wallet, order, stripePayment, giftCardPayment, reservation };
}

describe("gift-card webhook fulfillment and reconciliation", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.stripeWebhookEventReceipt.deleteMany();
    sentryMocks.captureException.mockReset();
    sentryMocks.captureMessage.mockReset();
  });

  it("issues one GiftCardCode per paid gift-card order item and duplicate webhooks are safe", async () => {
    const client = await createClient();
    const { order, payment } = await createPaidGiftCardOrder({
      clientId: client.id,
      sessionId: "cs_slice6_issuance",
      lines: [
        { amountMinor: 2_500, quantity: 2 },
        { amountMinor: 5_000, quantity: 1 },
      ],
    });

    const event = completedEvent({
      eventId: "evt_slice6_issuance",
      sessionId: "cs_slice6_issuance",
      paymentId: payment.id,
      orderId: order.id,
      clientId: client.id,
    });

    await processStripeWebhookEvent(event);
    await processStripeWebhookEvent(event);
    await processStripeWebhookEvent({
      ...event,
      id: "evt_slice6_issuance_replay_new_event",
    } as never);

    const codes = await prisma.giftCardCode.findMany({
      where: { purchasedById: client.id },
      orderBy: { amountMinor: "asc" },
    });
    expect(codes).toHaveLength(2);
    expect(codes.map((c) => c.amountMinor)).toEqual([5_000, 5_000]);
    expect(codes.every((c) => c.status === GiftCardCodeStatus.ISSUED)).toBe(true);
    expect(new Set(codes.map((c) => c.orderItemId)).size).toBe(2);
    await expect(prisma.order.findUnique({ where: { id: order.id } })).resolves.toMatchObject({
      status: OrderStatus.PAID,
    });
  });

  it("creates manual review when a gift-card payment has no redemption", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = await createClient();
    const merch = await createProduct({ productType: ProductType.MERCHANDISE, amountMinor: 5_000 });
    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 5_000,
        totalAmountMinor: 5_000,
        currencyCode: "EUR",
        status: OrderStatus.PLACED,
        items: {
          create: {
            productId: merch.product.id,
            priceId: merch.price.id,
            quantity: 1,
            productNameSnapshot: merch.product.name,
            priceNameSnapshot: merch.price.name,
            unitAmountMinor: 5_000,
            lineSubtotalAmountMinor: 5_000,
            lineTotalAmountMinor: 5_000,
            currencyCode: "EUR",
          },
        },
      },
    });
    const stripePayment = await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.PENDING,
        method: PaymentMethod.CARD,
        provider: PaymentProvider.STRIPE,
        providerReference: "cs_slice6_missing_redemption",
        checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
        amountMinor: 2_500,
        currencyCode: "EUR",
      },
    });
    const giftCardPayment = await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.PENDING,
        method: PaymentMethod.GIFT_CARD,
        provider: PaymentProvider.INTERNAL,
        amountMinor: 2_500,
        currencyCode: "EUR",
      },
    });

    await processStripeWebhookEvent(completedEvent({
      eventId: "evt_slice6_missing_redemption",
      sessionId: "cs_slice6_missing_redemption",
      paymentId: stripePayment.id,
      orderId: order.id,
      clientId: client.id,
    }));

    await expect(prisma.giftCardReconciliationCase.findFirstOrThrow({ where: { orderId: order.id } }))
      .resolves.toMatchObject({
        status: GiftCardReconciliationStatus.MANUAL_REVIEW,
        reason: "GIFT_CARD_PAYMENT_WITHOUT_REDEMPTION",
        paymentId: stripePayment.id,
      });
    await expect(prisma.order.findUnique({ where: { id: order.id } })).resolves.toMatchObject({
      status: OrderStatus.PLACED,
    });
    await expect(prisma.payment.findUnique({ where: { id: giftCardPayment.id } })).resolves.toMatchObject({
      status: PaymentStatus.PENDING,
    });
    expect(sentryMocks.captureMessage).toHaveBeenCalledWith(
      "gift_card.reconciliation_manual_review",
      expect.any(Object),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[gift_card.reconciliation_manual_review]",
      expect.objectContaining({ entityId: expect.any(String) }),
    );
    await expect(prisma.auditLog.findFirstOrThrow({
      where: { actionType: "gift_card.reconciliation_manual_review" },
    })).resolves.toBeTruthy();
    consoleErrorSpy.mockRestore();
  });

  it("duplicate capture and release webhooks do not create duplicate ledger entries", async () => {
    const client = await createClient();
    const capture = await createPartialGiftCardOrder({
      clientId: client.id,
      sessionId: "cs_slice6_duplicate_capture",
    });
    const captureEvent = completedEvent({
      eventId: "evt_slice6_duplicate_capture",
      sessionId: "cs_slice6_duplicate_capture",
      paymentId: capture.stripePayment.id,
      orderId: capture.order.id,
      clientId: client.id,
    });

    await processStripeWebhookEvent(captureEvent);
    await processStripeWebhookEvent(captureEvent);
    await processStripeWebhookEvent({
      ...captureEvent,
      id: "evt_slice6_duplicate_capture_new_event",
    });

    expect(await prisma.giftCardLedgerEntry.count({
      where: {
        redemptionId: capture.reservation.redemption.id,
        entryType: GiftCardLedgerEntryType.CAPTURE,
      },
    })).toBe(1);
    await expect(prisma.giftCardWallet.findUnique({ where: { id: capture.wallet.id } })).resolves.toMatchObject({
      balanceMinor: 2_500,
    });

    const releaseClient = await createClient();
    const release = await createPartialGiftCardOrder({
      clientId: releaseClient.id,
      sessionId: "cs_slice6_duplicate_release",
    });
    const releaseEvent = {
      id: "evt_slice6_duplicate_release",
      type: "checkout.session.expired",
      data: { object: { id: "cs_slice6_duplicate_release" } },
    } as never;

    await processStripeWebhookEvent(releaseEvent);
    await processStripeWebhookEvent(releaseEvent);
    await processStripeWebhookEvent({
      id: "evt_slice6_duplicate_release_new_event",
      type: "checkout.session.expired",
      data: { object: { id: "cs_slice6_duplicate_release" } },
    } as never);

    expect(await prisma.giftCardLedgerEntry.count({
      where: {
        redemptionId: release.reservation.redemption.id,
        entryType: GiftCardLedgerEntryType.RELEASE,
      },
    })).toBe(1);
    await expect(prisma.giftCardRedemption.findUnique({
      where: { id: release.reservation.redemption.id },
    })).resolves.toMatchObject({
      status: GiftCardRedemptionStatus.RELEASED,
      releasedAmountMinor: 2_500,
    });
  });

  it("caps webhook reconciliation retries at three and escalates the fourth failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = await createClient();
    const wallet = await prisma.giftCardWallet.create({
      data: {
        clientId: client.id,
        currencyCode: "EUR",
        balanceMinor: 5_000,
      },
    });
    const merch = await createProduct({ productType: ProductType.MERCHANDISE, amountMinor: 5_000 });
    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 5_000,
        totalAmountMinor: 5_000,
        currencyCode: "EUR",
        status: OrderStatus.PLACED,
        items: {
          create: {
            productId: merch.product.id,
            priceId: merch.price.id,
            quantity: 1,
            productNameSnapshot: merch.product.name,
            priceNameSnapshot: merch.price.name,
            unitAmountMinor: 5_000,
            lineSubtotalAmountMinor: 5_000,
            lineTotalAmountMinor: 5_000,
            currencyCode: "EUR",
          },
        },
      },
    });
    const stripePayment = await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.PENDING,
        method: PaymentMethod.CARD,
        provider: PaymentProvider.STRIPE,
        providerReference: "cs_slice6_retry",
        checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
        amountMinor: 2_500,
        currencyCode: "EUR",
      },
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.PENDING,
        method: PaymentMethod.GIFT_CARD,
        provider: PaymentProvider.INTERNAL,
        amountMinor: 2_500,
        currencyCode: "EUR",
      },
    });
    await reserveGiftCardValue({
      actor,
      clientId: client.id,
      orderId: order.id,
      amountMinor: 2_500,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      idempotencyKey: `gift-card:reserve:order:${order.id}`,
    });
    await prisma.giftCardWallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: 100, status: GiftCardWalletStatus.ACTIVE },
    });

    const event = completedEvent({
      eventId: "evt_slice6_retry",
      sessionId: "cs_slice6_retry",
      paymentId: stripePayment.id,
      orderId: order.id,
      clientId: client.id,
    });

    await expect(processStripeWebhookEvent(event)).rejects.toThrow();
    await expect(processStripeWebhookEvent(event)).rejects.toThrow();
    await expect(processStripeWebhookEvent(event)).rejects.toThrow();
    await expect(processStripeWebhookEvent(event)).resolves.toBeUndefined();

    const redemption = await prisma.giftCardRedemption.findFirstOrThrow({
      where: { orderId: order.id },
      select: { id: true },
    });
    const retryCaseKey = [
      "gift-card:reconciliation:webhook",
      "reason:STRIPE_WEBHOOK_PROCESSING_FAILED",
      `order:${order.id}`,
      `redemption:${redemption.id}`,
      `payment:${stripePayment.id}`,
    ].join(":");

    await expect(prisma.giftCardReconciliationCase.findUniqueOrThrow({
      where: { idempotencyKey: retryCaseKey },
    })).resolves.toMatchObject({
      status: GiftCardReconciliationStatus.MANUAL_REVIEW,
      retryCount: 4,
    });
    expect(await prisma.giftCardReconciliationCase.count({
      where: {
        orderId: order.id,
        status: {
          in: [
            GiftCardReconciliationStatus.OPEN,
            GiftCardReconciliationStatus.RETRYING,
            GiftCardReconciliationStatus.MANUAL_REVIEW,
          ],
        },
      },
    })).toBe(1);
    await expect(prisma.stripeWebhookEventReceipt.findUnique({ where: { eventId: "evt_slice6_retry" } }))
      .resolves.toMatchObject({ status: StripeWebhookReceiptStatus.PROCESSED });
    await expect(prisma.order.findUnique({ where: { id: order.id } })).resolves.toMatchObject({
      status: OrderStatus.PLACED,
    });
    await expect(prisma.payment.findUnique({ where: { id: stripePayment.id } })).resolves.toMatchObject({
      status: PaymentStatus.PENDING,
    });
    expect(sentryMocks.captureException).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[gift_card.capture_failed_after_stripe_success]",
      expect.objectContaining({ entityId: expect.any(String) }),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[gift_card.reconciliation_required]",
      expect.objectContaining({ entityId: retryCaseKey }),
    );
    await expect(prisma.auditLog.findFirstOrThrow({
      where: { actionType: "gift_card.reconciliation_manual_review" },
    })).resolves.toBeTruthy();
    await expect(prisma.auditLog.findFirstOrThrow({
      where: { actionType: "gift_card.reconciliation_required" },
    })).resolves.toBeTruthy();
    await expect(prisma.auditLog.findFirstOrThrow({
      where: { actionType: "gift_card.capture_failed_after_stripe_success" },
    })).resolves.toBeTruthy();
    consoleErrorSpy.mockRestore();
  });
});
