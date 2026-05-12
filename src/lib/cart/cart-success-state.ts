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

type CartSuccessAccessInput = {
  orderId?: string | null;
  checkoutSessionId?: string | null;
  userId: string;
};

export type CartSuccessAccessResult =
  | { ok: true; orderId: string; checkoutSessionId: string | null }
  | { ok: false; status: 403 | 404; code: "ORDER_NOT_FOUND" | "CHECKOUT_SESSION_MISMATCH" };

export async function validateCartSuccessAccess(
  input: CartSuccessAccessInput,
): Promise<CartSuccessAccessResult> {
  const orderId = input.orderId?.trim() || null;
  const checkoutSessionId = input.checkoutSessionId?.trim() || null;

  if (!orderId && !checkoutSessionId) {
    return { ok: false, status: 404, code: "ORDER_NOT_FOUND" };
  }

  const order = await prisma.order.findFirst({
    where: {
      ...(orderId ? { id: orderId } : {}),
      clientId: input.userId,
      ...(checkoutSessionId
        ? {
            payments: {
              some: {
                provider: PaymentProvider.STRIPE,
                OR: [
                  { stripeCheckoutSessionId: checkoutSessionId },
                  { providerReference: checkoutSessionId },
                ],
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      payments: {
        where: {
          provider: PaymentProvider.STRIPE,
          ...(checkoutSessionId
            ? {
                OR: [
                  { stripeCheckoutSessionId: checkoutSessionId },
                  { providerReference: checkoutSessionId },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          stripeCheckoutSessionId: true,
          providerReference: true,
        },
      },
    },
  });

  if (!order) {
    return { ok: false, status: 404, code: "ORDER_NOT_FOUND" };
  }

  const matchedSessionId =
    order.payments[0]?.stripeCheckoutSessionId ?? order.payments[0]?.providerReference ?? null;

  if (checkoutSessionId && matchedSessionId !== checkoutSessionId) {
    return { ok: false, status: 403, code: "CHECKOUT_SESSION_MISMATCH" };
  }

  return { ok: true, orderId: order.id, checkoutSessionId: matchedSessionId };
}

async function readOrderSuccessState(input: {
  orderId: string;
  userId: string;
  reconciliationState: CartSuccessState["reconciliationState"];
  paymentStatus: PaymentStatus | null;
  orderStatus: OrderStatus | null;
}): Promise<CartSuccessState> {
  const order = await prisma.order.findFirst({
    where: {
      id: input.orderId,
      clientId: input.userId,
    },
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
  });

  const cartClearEligible =
    input.reconciliationState === "CONFIRMED" &&
    input.orderStatus === OrderStatus.PAID &&
    (input.paymentStatus === PaymentStatus.SUCCEEDED || input.paymentStatus === null);

  return {
    paymentStatus: input.paymentStatus,
    orderStatus: input.orderStatus,
    reconciliationState: input.reconciliationState,
    cartClearEligible,
    subtotalAmountMinor: order?.subtotalAmountMinor ?? null,
    totalAmountMinor: order?.totalAmountMinor ?? null,
    currencyCode: order?.currencyCode ?? null,
    items:
      order?.items.map((item) => ({
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

export async function getCartCheckoutSuccessStateForOrder(input: {
  orderId: string;
  userId: string;
}): Promise<CartSuccessState> {
  const access = await validateCartSuccessAccess({
    orderId: input.orderId,
    userId: input.userId,
  });
  if (!access.ok) {
    return {
      paymentStatus: null,
      orderStatus: null,
      reconciliationState: "PENDING",
      cartClearEligible: false,
      subtotalAmountMinor: null,
      totalAmountMinor: null,
      currencyCode: null,
      items: [],
    };
  }

  const order = await prisma.order.findFirst({
    where: {
      id: access.orderId,
      clientId: input.userId,
    },
    select: {
      status: true,
      payments: {
        orderBy: { createdAt: "desc" },
        select: { status: true },
      },
    },
  });

  const anyFailed = order?.payments.some((payment) => payment.status === PaymentStatus.FAILED) ?? false;
  const allSucceeded =
    (order?.payments.length ?? 0) > 0 &&
    order?.payments.every((payment) => payment.status === PaymentStatus.SUCCEEDED);
  const reconciliationState =
    order?.status === OrderStatus.PAID && allSucceeded
      ? "CONFIRMED"
      : anyFailed || order?.status === OrderStatus.CANCELLED || order?.status === OrderStatus.REFUNDED
        ? "FAILED"
        : "PENDING";

  return readOrderSuccessState({
    orderId: access.orderId,
    userId: input.userId,
    reconciliationState,
    paymentStatus: order?.payments[0]?.status ?? null,
    orderStatus: order?.status ?? null,
  });
}

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
          id: true,
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

  if (!payment?.order) {
    return {
      paymentStatus: reconciliation.paymentStatus,
      orderStatus: reconciliation.orderStatus,
      reconciliationState: reconciliation.reconciliationState,
      cartClearEligible,
      subtotalAmountMinor: null,
      totalAmountMinor: null,
      currencyCode: null,
      items: [],
    };
  }

  return readOrderSuccessState({
    orderId: payment.order.id,
    userId: input.userId,
    reconciliationState: reconciliation.reconciliationState,
    paymentStatus: reconciliation.paymentStatus,
    orderStatus: reconciliation.orderStatus,
  });
}
