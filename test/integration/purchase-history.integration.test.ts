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

import { getClientOrderHistory } from "../../src/lib/dashboard/dashboard-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

async function seedClient() {
  return prisma.user.create({
    data: {
      name: "History Test Client",
      email: `history.${Date.now()}.${Math.random()}@example.test`,
      role: Role.CLIENT,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      isActive: true,
    },
  });
}

async function seedProductAndPrice(type: ProductType) {
  const ts = `${Date.now()}-${Math.random()}`;
  const product = await prisma.product.create({
    data: {
      name: `Product ${ts}`,
      slug: `product-${ts}`,
      productType: type,
      isActive: true,
      isArchived: false,
      sortOrder: 0,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `price-${ts}`,
      name: "Price",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 10000,
      isActive: true,
      isArchived: false,
    },
  });
  return { product, price };
}

async function seedPaidOrder(clientId: string, productId: string, priceId: string) {
  const order = await prisma.order.create({
    data: {
      clientId,
      subtotalAmountMinor: 10000,
      discountAmountMinor: 0,
      totalAmountMinor: 10000,
      currencyCode: "EUR",
      status: OrderStatus.PAID,
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId,
      priceId,
      quantity: 1,
      productNameSnapshot: "Test Product",
      priceNameSnapshot: "Test Price",
      unitAmountMinor: 10000,
      lineSubtotalAmountMinor: 10000,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: 10000,
      currencyCode: "EUR",
    },
  });
  return order;
}

describe("getClientOrderHistory (Issue 3: unified purchase history)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("includes CLASS_PACK orders", async () => {
    const client = await seedClient();
    const { product, price } = await seedProductAndPrice(ProductType.CLASS_PACK);
    await seedPaidOrder(client.id, product.id, price.id);

    const history = await getClientOrderHistory(client.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.items[0]!.productType).toBe(ProductType.CLASS_PACK);
  });

  it("includes MERCHANDISE orders", async () => {
    const client = await seedClient();
    const { product, price } = await seedProductAndPrice(ProductType.MERCHANDISE);
    await seedPaidOrder(client.id, product.id, price.id);

    const history = await getClientOrderHistory(client.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.items[0]!.productType).toBe(ProductType.MERCHANDISE);
  });

  it("includes GIFT_CARD orders with giftCardCode null when not yet issued", async () => {
    const client = await seedClient();
    const { product, price } = await seedProductAndPrice(ProductType.GIFT_CARD);
    await seedPaidOrder(client.id, product.id, price.id);

    const history = await getClientOrderHistory(client.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.items[0]!.productType).toBe(ProductType.GIFT_CARD);
    expect(history[0]!.items[0]!.giftCardCode).toBeNull();
  });

  it("includes GIFT_CARD orders with maskedCode and status when code is issued", async () => {
    const client = await seedClient();
    const { product, price } = await seedProductAndPrice(ProductType.GIFT_CARD);
    const order = await seedPaidOrder(client.id, product.id, price.id);
    const orderItem = await prisma.orderItem.findFirst({ where: { orderId: order.id } });

    await prisma.giftCardCode.create({
      data: {
        orderId: order.id,
        orderItemId: orderItem!.id,
        purchasedById: client.id,
        codeHash: "deadbeef".repeat(8),
        maskedCode: "XXXXXXXX-XXXXXXXX-XXXXXXXX-TESTCODE",
        amountMinor: 10000,
        currencyCode: "EUR",
        status: GiftCardCodeStatus.ISSUED,
        issuedAt: new Date(),
      },
    });

    const history = await getClientOrderHistory(client.id);
    const gcItem = history[0]!.items[0]!;
    expect(gcItem.giftCardCode).not.toBeNull();
    expect(gcItem.giftCardCode!.maskedCode).toBe("XXXXXXXX-XXXXXXXX-XXXXXXXX-TESTCODE");
    expect(gcItem.giftCardCode!.status).toBe(GiftCardCodeStatus.ISSUED);
  });

  it("excludes DRAFT orders", async () => {
    const client = await seedClient();
    const { product, price } = await seedProductAndPrice(ProductType.CLASS_PACK);
    await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 10000,
        discountAmountMinor: 0,
        totalAmountMinor: 10000,
        currencyCode: "EUR",
        status: OrderStatus.DRAFT,
        items: {
          create: {
            productId: product.id,
            priceId: price.id,
            quantity: 1,
            productNameSnapshot: "Test",
            priceNameSnapshot: "Test",
            unitAmountMinor: 10000,
            lineSubtotalAmountMinor: 10000,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: 10000,
            currencyCode: "EUR",
          },
        },
      },
    });

    const history = await getClientOrderHistory(client.id);
    expect(history).toHaveLength(0);
  });

  it("does not return orders belonging to other clients", async () => {
    const clientA = await seedClient();
    const clientB = await seedClient();
    const { product, price } = await seedProductAndPrice(ProductType.CLASS_PACK);
    await seedPaidOrder(clientA.id, product.id, price.id);

    const historyB = await getClientOrderHistory(clientB.id);
    expect(historyB).toHaveLength(0);
  });

  it("shows fulfillmentNote only for orders with MERCHANDISE items", async () => {
    const client = await seedClient();
    const { product: cp, price: cpPrice } = await seedProductAndPrice(ProductType.CLASS_PACK);
    const { product: merch, price: merchPrice } = await seedProductAndPrice(ProductType.MERCHANDISE);

    await seedPaidOrder(client.id, cp.id, cpPrice.id);
    await seedPaidOrder(client.id, merch.id, merchPrice.id);

    const history = await getClientOrderHistory(client.id);
    const cpOrder = history.find((o) => o.items[0]!.productType === ProductType.CLASS_PACK);
    const merchOrder = history.find((o) => o.items[0]!.productType === ProductType.MERCHANDISE);
    expect(cpOrder!.fulfillmentNote).toBeNull();
    expect(merchOrder!.fulfillmentNote).not.toBeNull();
  });
});
