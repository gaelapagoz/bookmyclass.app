import { OrderStatus, PaymentProvider, PriceType, ProductType, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export type OwnedOneTimeProduct = {
  orderId: string;
  productId: string;
  productName: string;
  productType: ProductType;
  priceName: string;
  amountMinor: number;
  currencyCode: string;
  purchasedAt: string;
};

export type OwnedRecurringSubscription = {
  subscriptionContractId: string;
  productId: string;
  productName: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  endedAt: string | null;
  provider: PaymentProvider;
};

export async function getOwnedOneTimeProducts(userId: string): Promise<OwnedOneTimeProduct[]> {
  const orderItems = await prisma.orderItem.findMany({
    where: {
      order: {
        clientId: userId,
        status: OrderStatus.PAID,
      },
      price: {
        priceType: PriceType.ONE_TIME,
      },
    },
    orderBy: [{ order: { placedAt: "desc" } }, { createdAt: "desc" }],
    select: {
      orderId: true,
      productId: true,
      productNameSnapshot: true,
      priceNameSnapshot: true,
      lineTotalAmountMinor: true,
      currencyCode: true,
      product: {
        select: {
          productType: true,
        },
      },
      order: {
        select: {
          placedAt: true,
        },
      },
    },
  });

  return orderItems.map((item) => ({
    orderId: item.orderId,
    productId: item.productId,
    productName: item.productNameSnapshot,
    productType: item.product.productType,
    priceName: item.priceNameSnapshot,
    amountMinor: item.lineTotalAmountMinor,
    currencyCode: item.currencyCode,
    purchasedAt: item.order.placedAt.toISOString(),
  }));
}

export async function getOwnedRecurringSubscriptions(
  userId: string,
): Promise<OwnedRecurringSubscription[]> {
  const now = new Date();
  const subscriptions = await prisma.subscriptionContract.findMany({
    where: {
      clientId: userId,
      OR: [{ endedAt: null }, { endedAt: { gt: now } }],
    },
    orderBy: [{ currentPeriodEnd: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      productId: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      cancelledAt: true,
      endedAt: true,
      provider: true,
      product: {
        select: {
          name: true,
        },
      },
    },
  });

  return subscriptions.map((subscription) => ({
    subscriptionContractId: subscription.id,
    productId: subscription.productId,
    productName: subscription.product.name,
    status: subscription.status,
    currentPeriodStart: subscription.currentPeriodStart.toISOString(),
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
    endedAt: subscription.endedAt?.toISOString() ?? null,
    provider: subscription.provider,
  }));
}

export async function hasActiveRecurringSubscriptionForProduct(input: {
  userId: string;
  productId: string;
}): Promise<boolean> {
  const now = new Date();
  const subscription = await prisma.subscriptionContract.findFirst({
    where: {
      clientId: input.userId,
      productId: input.productId,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: { gt: now },
      OR: [{ endedAt: null }, { endedAt: { gt: now } }],
    },
    select: { id: true },
  });

  return Boolean(subscription);
}

export async function getLatestStripeCustomerIdForUser(userId: string): Promise<string | null> {
  const payment = await prisma.payment.findFirst({
    where: {
      provider: PaymentProvider.STRIPE,
      stripeCustomerId: { not: null },
      order: {
        clientId: userId,
      },
    },
    orderBy: { createdAt: "desc" },
    select: { stripeCustomerId: true },
  });

  return payment?.stripeCustomerId ?? null;
}
