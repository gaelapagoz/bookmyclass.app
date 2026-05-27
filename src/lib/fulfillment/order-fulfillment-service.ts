import {
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { issueGiftCardCodesForOrder } from "@/lib/gift-cards/gift-card-code-service";
import { consumeCredit } from "@/lib/credits/credit-service";

const PURCHASE_CONFIRMATION_EMAIL_SENT = "PURCHASE_CONFIRMATION_EMAIL_SENT";
const PURCHASE_CONFIRMATION_EMAIL_FAILED = "PURCHASE_CONFIRMATION_EMAIL_FAILED";
const STORE_PURCHASE_CONFIRMATION_EMAIL_SENT = "STORE_PURCHASE_CONFIRMATION_EMAIL_SENT";
const STORE_PURCHASE_CONFIRMATION_EMAIL_FAILED = "STORE_PURCHASE_CONFIRMATION_EMAIL_FAILED";
const FULFILLMENT_MAX_ATTEMPTS = 3;

function isRetryablePrismaConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P1017") {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Server has closed the connection");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildLedgerIdempotencyKey(
  prefix: string,
  input: {
    type: "GRANT" | "CONSUME";
    clientId: string;
    entitlementId: string;
    orderId: string | null;
    bookingId: string | null;
    linePriceId?: string | null;
  },
): string {
  return [
    prefix,
    input.type,
    input.clientId,
    input.entitlementId,
    input.orderId ?? "no-order",
    input.bookingId ?? "no-booking",
    input.linePriceId ?? "no-line-price",
  ].join(":");
}

function resolveEntitlementRule(params: {
  productType: ProductType;
  configuredQuantity: number | null;
}): {
  entitlementType: EntitlementType;
  entitlementScope: EntitlementScope;
  quantity: number;
} {
  switch (params.productType) {
    case ProductType.DROP_IN_CLASS:
      return {
        entitlementType: EntitlementType.SINGLE_USE,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        quantity: 1,
      };
    case ProductType.CLASS_PACK: {
      const quantity = params.configuredQuantity ?? 0;
      if (quantity < 1) throw new Error("CLASS_PACK_QUANTITY_INVALID");
      return {
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        quantity,
      };
    }
    case ProductType.PRIVATE_PACK: {
      const quantity = params.configuredQuantity ?? 0;
      if (quantity < 1) throw new Error("CLASS_PACK_QUANTITY_INVALID");
      return {
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.PRIVATE_CLASSES,
        quantity,
      };
    }
    default:
      throw new Error("UNSUPPORTED_PRODUCT_TYPE_FOR_ONE_TIME_ENTITLEMENT");
  }
}

async function grantEntitlementForOrderItem(input: {
  clientId: string;
  orderId: string;
  selectedPriceId: string;
  bookingId?: string | null;
  consumeCreditForBooking: boolean;
  purchaseQuantity?: number;
  idempotencyKeyPrefix: string;
}): Promise<string | null> {
  const price = await prisma.price.findUnique({
    where: { id: input.selectedPriceId },
    select: {
      priceType: true,
      productId: true,
      product: {
        select: {
          productType: true,
          entitlementRules: {
            where: { isActive: true },
            orderBy: { updatedAt: "desc" },
            select: { quantity: true, validForDays: true },
            take: 1,
          },
        },
      },
    },
  });

  const rule = price?.product.entitlementRules[0];
  if (!price || !rule) return null;

  if (price.priceType === PriceType.RECURRING) return null;

  if (price.product.productType === ProductType.UNLIMITED_MEMBERSHIP) {
    throw new Error("MEMBERSHIP_PRICE_TYPE_MISMATCH");
  }

  const resolvedRule = resolveEntitlementRule({
    productType: price.product.productType,
    configuredQuantity: rule.quantity,
  });

  const activatedAt = new Date();
  const expiresAt =
    typeof rule.validForDays === "number"
      ? new Date(activatedAt.getTime() + rule.validForDays * 24 * 60 * 60 * 1000)
      : null;

  const entitlement = await prisma.clientEntitlement.upsert({
    where: {
      clientId_productId_orderId: {
        clientId: input.clientId,
        productId: price.productId,
        orderId: input.orderId,
      },
    },
    update: {
      status: ClientEntitlementStatus.ACTIVE,
      entitlementType: resolvedRule.entitlementType,
      entitlementScope: resolvedRule.entitlementScope,
      activatedAt,
      expiresAt,
      notes: "Activated via checkout finalization.",
    },
    create: {
      clientId: input.clientId,
      productId: price.productId,
      orderId: input.orderId,
      entitlementType: resolvedRule.entitlementType,
      entitlementScope: resolvedRule.entitlementScope,
      status: ClientEntitlementStatus.ACTIVE,
      activatedAt,
      expiresAt,
      notes: "Activated via checkout finalization.",
    },
    select: { id: true },
  });

  if (resolvedRule.quantity > 0) {
    const purchaseQuantity = Math.max(1, input.purchaseQuantity ?? 1);
    await prisma.creditLedgerEntry.createMany({
      data: {
        clientId: input.clientId,
        entitlementId: entitlement.id,
        orderId: input.orderId,
        bookingId: input.bookingId ?? null,
        entryType: CreditLedgerEntryType.GRANT,
        amount: resolvedRule.quantity * purchaseQuantity,
        idempotencyKey: buildLedgerIdempotencyKey(input.idempotencyKeyPrefix, {
          type: "GRANT",
          clientId: input.clientId,
          entitlementId: entitlement.id,
          orderId: input.orderId,
          bookingId: input.bookingId ?? null,
          linePriceId: input.selectedPriceId,
        }),
        notes: "Credits granted from successful product purchase.",
      },
      skipDuplicates: true,
    });
  }

  if (
    input.consumeCreditForBooking &&
    input.bookingId &&
    (resolvedRule.entitlementType === EntitlementType.CREDIT_PACK ||
      resolvedRule.entitlementType === EntitlementType.SINGLE_USE)
  ) {
    await consumeCredit({
      clientId: input.clientId,
      entitlementId: entitlement.id,
      bookingId: input.bookingId,
      reason: "checkout-complete",
      idempotencyKey: buildLedgerIdempotencyKey(input.idempotencyKeyPrefix, {
        type: "CONSUME",
        clientId: input.clientId,
        entitlementId: entitlement.id,
        orderId: input.orderId,
        bookingId: input.bookingId,
        linePriceId: input.selectedPriceId,
      }),
    });
  }

  if (input.bookingId) {
    await prisma.booking.update({
      where: { id: input.bookingId },
      data: { selectedEntitlementId: entitlement.id },
    });
  }

  return entitlement.id;
}

async function hasPurchaseConfirmationEmailBeenSent(orderId: string): Promise<boolean> {
  const existing = await prisma.auditLog.findFirst({
    where: {
      actionType: PURCHASE_CONFIRMATION_EMAIL_SENT,
      entityType: "Order",
      entityId: orderId,
    },
    select: { id: true },
  });

  return existing !== null;
}

async function recordPurchaseConfirmationEmailSent(input: {
  orderId: string;
  clientId: string;
  itemCount: number;
  walletAmountMinor: number;
  stripeAmountMinor: number;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.clientId,
      actionType: PURCHASE_CONFIRMATION_EMAIL_SENT,
      entityType: "Order",
      entityId: input.orderId,
      metadata: {
        source: "order-fulfillment-service",
        itemCount: input.itemCount,
        walletAmountMinor: input.walletAmountMinor,
        stripeAmountMinor: input.stripeAmountMinor,
      },
    },
  });
}

async function hasStoreConfirmationEmailBeenSent(orderId: string): Promise<boolean> {
  const existing = await prisma.auditLog.findFirst({
    where: {
      actionType: STORE_PURCHASE_CONFIRMATION_EMAIL_SENT,
      entityType: "Order",
      entityId: orderId,
    },
    select: { id: true },
  });

  return existing !== null;
}

async function recordStoreConfirmationEmailSent(input: {
  orderId: string;
  clientId: string;
  itemCount: number;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.clientId,
      actionType: STORE_PURCHASE_CONFIRMATION_EMAIL_SENT,
      entityType: "Order",
      entityId: input.orderId,
      metadata: {
        source: "order-fulfillment-service",
        itemCount: input.itemCount,
      },
    },
  });
}

async function recordLifecycleEmailFailure(input: {
  actionType: string;
  orderId: string;
  clientId: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.clientId,
      actionType: input.actionType,
      entityType: "Order",
      entityId: input.orderId,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

/**
 * Fulfills a paid cart order: issues gift card codes, grants entitlements,
 * and sends confirmation emails. Safe to call multiple times (idempotent).
 *
 * @param idempotencyKeyPrefix Segment prepended to credit ledger idempotency
 *   keys. Use "stripe-fulfillment" when called from the Stripe webhook path to
 *   remain backward-compatible with previously-created ledger records.
 */
export async function fulfillPaidCartOrder(input: {
  orderId: string;
  clientId: string;
  giftCardPaymentId?: string;
  idempotencyKeyPrefix?: string;
  issueGiftCardCodes?: boolean;
  grantEntitlements?: boolean;
  sendEmails?: boolean;
}): Promise<void> {
  for (let attempt = 1; attempt <= FULFILLMENT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const prefix = input.idempotencyKeyPrefix ?? "cart-fulfillment";
      const issueGiftCardCodes = input.issueGiftCardCodes ?? true;
      const grantEntitlements = input.grantEntitlements ?? true;
      const sendEmails = input.sendEmails ?? true;

      const order = await prisma.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          clientId: true,
          totalAmountMinor: true,
          currencyCode: true,
        },
      });

      if (!order || order.clientId !== input.clientId) return;

      const items = await prisma.orderItem.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          priceId: true,
          quantity: true,
          lineTotalAmountMinor: true,
          productNameSnapshot: true,
          currencyCode: true,
          price: { select: { priceType: true, unitAmountMinor: true } },
          product: { select: { productType: true } },
        },
      });

      const payments = await prisma.payment.findMany({
        where: {
          orderId: order.id,
          status: PaymentStatus.SUCCEEDED,
        },
        orderBy: { capturedAt: "desc" },
        select: { id: true, provider: true, amountMinor: true },
      });

      const paymentId = input.giftCardPaymentId ?? payments[0]?.id;

      const giftCardItems = items
        .filter((item) => item.product.productType === ProductType.GIFT_CARD)
        .map((item) => ({ orderItemId: item.id, amountMinor: item.lineTotalAmountMinor }));

      if (issueGiftCardCodes && giftCardItems.length > 0) {
        await issueGiftCardCodesForOrder({
          orderId: order.id,
          clientId: input.clientId,
          paymentId,
          items: giftCardItems,
        });
      }

      const entitlementItems = items.filter(
        (item) =>
          item.product.productType !== ProductType.GIFT_CARD &&
          item.product.productType !== ProductType.MERCHANDISE &&
          item.price.priceType === PriceType.ONE_TIME,
      );

      if (grantEntitlements) {
        for (const item of entitlementItems) {
          await grantEntitlementForOrderItem({
            clientId: input.clientId,
            orderId: order.id,
            selectedPriceId: item.priceId,
            consumeCreditForBooking: false,
            purchaseQuantity: item.quantity,
            idempotencyKeyPrefix: prefix,
          });
        }
      }

      const merchandiseItems = items.filter(
        (item) => item.product.productType === ProductType.MERCHANDISE,
      );
      const purchaseConfirmationItems = items.filter(
        (item) =>
          item.product.productType !== ProductType.GIFT_CARD &&
          item.product.productType !== ProductType.MERCHANDISE,
      );

      const needsEmail =
        sendEmails && (purchaseConfirmationItems.length > 0 || merchandiseItems.length > 0);
      let purchaser: { name: string | null; email: string | null } | null = null;
      if (needsEmail) {
        purchaser = await prisma.user.findUnique({
          where: { id: input.clientId },
          select: { name: true, email: true },
        });
      }

      if (purchaseConfirmationItems.length > 0 && purchaser?.email) {
        try {
          const walletAmountMinor = payments
            .filter((p) => p.provider === PaymentProvider.INTERNAL)
            .reduce((sum, p) => sum + p.amountMinor, 0);
          const stripeAmountMinor = payments
            .filter((p) => p.provider === PaymentProvider.STRIPE)
            .reduce((sum, p) => sum + p.amountMinor, 0);
          if (!(await hasPurchaseConfirmationEmailBeenSent(order.id))) {
            const { sendPurchaseConfirmationEmail } = await import(
              "@/lib/email/purchase-confirmation-email"
            );
            await sendPurchaseConfirmationEmail({
              to: purchaser.email,
              purchaserName: purchaser.name,
              orderId: order.id,
              items: purchaseConfirmationItems.map((item) => ({
                name: item.productNameSnapshot,
                quantity: item.quantity,
                lineTotalAmountMinor: item.lineTotalAmountMinor,
                currencyCode: item.currencyCode,
              })),
              totalAmountMinor: order.totalAmountMinor,
              currencyCode: order.currencyCode,
              walletAmountMinor,
              stripeAmountMinor,
              idempotencyKey: `payment:purchase-confirmation:${order.id}`,
            });
            await recordPurchaseConfirmationEmailSent({
              orderId: order.id,
              clientId: input.clientId,
              itemCount: purchaseConfirmationItems.length,
              walletAmountMinor,
              stripeAmountMinor,
            });
          }
        } catch (emailError) {
          console.error(
            "[fulfillment] purchase confirmation email failed",
            emailError instanceof Error ? emailError.message : String(emailError),
          );
          await recordLifecycleEmailFailure({
            actionType: PURCHASE_CONFIRMATION_EMAIL_FAILED,
            orderId: order.id,
            clientId: input.clientId,
            metadata: {
              source: "order-fulfillment-service",
              context: "purchase-confirmation",
            },
          });
        }
      }

      if (merchandiseItems.length > 0 && purchaser?.email) {
        try {
          if (!(await hasStoreConfirmationEmailBeenSent(order.id))) {
            const { sendStorePurchaseConfirmationEmail } = await import("@/lib/email/store-email");
            await sendStorePurchaseConfirmationEmail({
              to: purchaser.email,
              purchaserName: purchaser.name,
              orderId: order.id,
              idempotencyKey: `store:purchase-confirmation:${order.id}`,
              items: merchandiseItems.map((item) => ({
                name: item.productNameSnapshot,
                quantity: item.quantity,
                unitAmountMinor: item.price.unitAmountMinor,
                currencyCode: item.currencyCode,
              })),
            });
            await recordStoreConfirmationEmailSent({
              orderId: order.id,
              clientId: input.clientId,
              itemCount: merchandiseItems.length,
            });
          }
        } catch (emailError) {
          console.error(
            "[fulfillment] merchandise confirmation email failed",
            emailError instanceof Error ? emailError.message : String(emailError),
          );
          await recordLifecycleEmailFailure({
            actionType: STORE_PURCHASE_CONFIRMATION_EMAIL_FAILED,
            orderId: order.id,
            clientId: input.clientId,
            metadata: {
              source: "order-fulfillment-service",
              context: "store-purchase-confirmation",
            },
          });
        }
      }

      return;
    } catch (error) {
      if (!isRetryablePrismaConnectionError(error) || attempt === FULFILLMENT_MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(100 * attempt);
    }
  }
}
