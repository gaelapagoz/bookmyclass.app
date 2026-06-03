import {
  BookingPaymentSelection,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  PriceType,
  ProductType,
} from "@prisma/client";

import { consumeCredit } from "@/lib/credits/credit-service";
import { prisma } from "@/lib/db";
import { fulfillPaidCartOrder } from "@/lib/fulfillment/order-fulfillment-service";

function buildCreditLedgerIdempotencyKey(input: {
  type: "GRANT" | "CONSUME";
  clientId: string;
  entitlementId: string;
  orderId: string | null;
  bookingId: string | null;
  linePriceId?: string | null;
}): string {
  return [
    "stripe-fulfillment",
    input.type,
    input.clientId,
    input.entitlementId,
    input.orderId ?? "no-order",
    input.bookingId ?? "no-booking",
    input.linePriceId ?? "no-line-price",
  ].join(":");
}

async function grantEntitlementForSuccessfulPricePurchase(input: {
  clientId: string;
  orderId: string | null;
  selectedPriceId: string;
  bookingId?: string | null;
  consumeCreditForBooking: boolean;
  purchaseQuantity?: number;
}) {
  function resolveRuleFromProductType(params: {
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
        if (quantity < 1) {
          throw new Error("CLASS_PACK_QUANTITY_INVALID");
        }
        return {
          entitlementType: EntitlementType.CREDIT_PACK,
          entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
          quantity,
        };
      }
      case ProductType.PRIVATE_PACK: {
        const quantity = params.configuredQuantity ?? 0;
        if (quantity < 1) {
          throw new Error("CLASS_PACK_QUANTITY_INVALID");
        }
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
            select: {
              entitlementType: true,
              entitlementScope: true,
              quantity: true,
              validForDays: true,
            },
            take: 1,
          },
        },
      },
    },
  });

  const rule = price?.product.entitlementRules[0];
  if (!price || !rule) {
    return null;
  }
  if (price.priceType === PriceType.RECURRING) {
    if (input.bookingId) {
      await prisma.booking.update({
        where: { id: input.bookingId },
        data: { selectedEntitlementId: null },
      });
    }
    return null;
  }

  if (price.product.productType === ProductType.UNLIMITED_MEMBERSHIP) {
    throw new Error("MEMBERSHIP_PRICE_TYPE_MISMATCH");
  }

  const resolvedRule = resolveRuleFromProductType({
    productType: price.product.productType,
    configuredQuantity: rule.quantity,
  });

  const activatedAt = new Date();
  const expiresAt =
    typeof rule.validForDays === "number"
      ? new Date(activatedAt.getTime() + rule.validForDays * 24 * 60 * 60 * 1000)
      : null;

  const entitlement = input.orderId
    ? await prisma.clientEntitlement.upsert({
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
          notes: "Activated via Stripe checkout finalization.",
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
          notes: "Activated via Stripe checkout finalization.",
        },
        select: { id: true },
      })
    : await prisma.clientEntitlement.create({
        data: {
          clientId: input.clientId,
          productId: price.productId,
          orderId: input.orderId,
          entitlementType: resolvedRule.entitlementType,
          entitlementScope: resolvedRule.entitlementScope,
          status: ClientEntitlementStatus.ACTIVE,
          activatedAt,
          expiresAt,
          notes: "Activated via Stripe checkout finalization.",
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
        idempotencyKey: buildCreditLedgerIdempotencyKey({
          type: "GRANT",
          clientId: input.clientId,
          entitlementId: entitlement.id,
          orderId: input.orderId,
          bookingId: input.bookingId ?? null,
          linePriceId: input.selectedPriceId,
        }),
        notes: "Credits granted from successful Stripe product purchase.",
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
      reason: "stripe:checkout-complete",
      idempotencyKey: buildCreditLedgerIdempotencyKey({
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

export async function ensureOwnershipForSuccessfulPricePurchase(input: {
  clientId: string;
  bookingId?: string | null;
  enforceBookingSelectionMatch?: boolean;
  orderId: string | null;
  selectedPriceId: string;
  consumeCreditForBooking: boolean;
  purchaseQuantity?: number;
}) {
  const bookingId = input.bookingId ?? null;
  if (bookingId && input.enforceBookingSelectionMatch) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        selectedEntitlementId: true,
        selectedPriceId: true,
      },
    });

    if (!booking || booking.selectedPriceId !== input.selectedPriceId) {
      return;
    }

    if (booking.selectedEntitlementId) {
      return;
    }
  }

  await grantEntitlementForSuccessfulPricePurchase({
    bookingId,
    clientId: input.clientId,
    orderId: input.orderId,
    selectedPriceId: input.selectedPriceId,
    consumeCreditForBooking: input.consumeCreditForBooking,
    purchaseQuantity: input.purchaseQuantity,
  });
}

export async function ensureCartOrderOwnershipFromPersistedItems(input: {
  orderId: string;
  clientId: string;
  booking: {
    id: string;
    paymentSelection: BookingPaymentSelection | null;
    selectedPriceId: string | null;
  } | null;
}) {
  const bookingSelection = input.booking?.paymentSelection ?? null;
  const shouldConsumeForBooking =
    bookingSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE ||
    bookingSelection === BookingPaymentSelection.SINGLE_SESSION;

  if (input.booking && shouldConsumeForBooking && input.booking.selectedPriceId) {
    await ensureOwnershipForSuccessfulPricePurchase({
      clientId: input.clientId,
      bookingId: input.booking.id,
      enforceBookingSelectionMatch: true,
      orderId: input.orderId,
      selectedPriceId: input.booking.selectedPriceId,
      consumeCreditForBooking: true,
    });
  }

  await fulfillPaidCartOrder({
    orderId: input.orderId,
    clientId: input.clientId,
    idempotencyKeyPrefix: "stripe-fulfillment",
    grantEntitlements: !(input.booking && shouldConsumeForBooking),
    issueGiftCardCodes: !(input.booking && shouldConsumeForBooking),
  });
}
