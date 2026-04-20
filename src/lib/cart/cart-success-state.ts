import { OrderStatus, PaymentProvider, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCheckoutSessionReconciliationState } from "@/lib/public-booking/stripe-webhook-service";

export type CartSuccessLineItem = {
  productId: string;
  priceId: string;
  productNameSnapshot: string;
  priceNameSnapshot: string;
  quantity: number;
  unitAmountMinor: number;
  lineTotalAmountMinor: number;
  currencyCode: string;
};

export type CartSuccessState = {
  paymentStatus: PaymentStatus | null;
  orderStatus: OrderStatus | null;
  reconciliationState: "PENDING" | "CONFIRMED" | "FAILED";
  cartClearEligible: boolean;
  subtotalAmountMinor: number | null;
  totalAmountMinor: number | null;
  currencyCode: string | null;
  items: CartSuccessLineItem[];
};

export async function getCartCheckoutSuccessState(input: {
  checkoutSessionId: string;
  userId: string;
}): Promise<CartSuccessState> {
  const reconciliation = await getCheckoutSessionReconciliationState({
    checkoutSessionId: input.checkoutSessionId,
    userId: input.userId,
  });

  const payment = await prisma.payment.findFirst({
    where: {
      provider: PaymentProvider.STRIPE,
      AND: [
        {
          OR: [
            { stripeCheckoutSessionId: input.checkoutSessionId },
            { providerReference: input.checkoutSessionId },
          ],
        },
        {
          order: { clientId: input.userId },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      order: {
        select: {
          subtotalAmountMinor: true,
          totalAmountMinor: true,
          currencyCode: true,
          items: {
            orderBy: { createdAt: "asc" },
            select: {
              productId: true,
              priceId: true,
              productNameSnapshot: true,
              priceNameSnapshot: true,
              quantity: true,
              unitAmountMinor: true,
              lineTotalAmountMinor: true,
              currencyCode: true,
            },
          },
        },
      },
    },
  });

  const cartClearEligible =
    reconciliation.reconciliationState === "CONFIRMED" &&
    reconciliation.paymentStatus === PaymentStatus.SUCCEEDED &&
    reconciliation.orderStatus === OrderStatus.PAID;

  return {
    paymentStatus: reconciliation.paymentStatus,
    orderStatus: reconciliation.orderStatus,
    reconciliationState: reconciliation.reconciliationState,
    cartClearEligible,
    subtotalAmountMinor: payment?.order?.subtotalAmountMinor ?? null,
    totalAmountMinor: payment?.order?.totalAmountMinor ?? null,
    currencyCode: payment?.order?.currencyCode ?? null,
    items:
      payment?.order?.items.map((item) => ({
        productId: item.productId,
        priceId: item.priceId,
        productNameSnapshot: item.productNameSnapshot,
        priceNameSnapshot: item.priceNameSnapshot,
        quantity: item.quantity,
        unitAmountMinor: item.unitAmountMinor,
        lineTotalAmountMinor: item.lineTotalAmountMinor,
        currencyCode: item.currencyCode,
      })) ?? [],
  };
}
