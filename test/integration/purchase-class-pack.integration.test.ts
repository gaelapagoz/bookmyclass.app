import {
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  OrderStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createClassPackSetup,
  createClient,
  getCreditBalance,
} from "./helpers/factories";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("purchase class pack integration", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates paid purchase, entitlement, and +10 credits", async () => {
    // Arrange
    const client = await createClient(prisma);
    const { product, price } = await createClassPackSetup(prisma);

    // Act
    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: price.unitAmountMinor,
        discountAmountMinor: 0,
        totalAmountMinor: price.unitAmountMinor,
        currencyCode: "EUR",
        status: OrderStatus.PAID,
        notes: "Class-pack purchase integration test.",
      },
    });

    const orderItem = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        priceId: price.id,
        quantity: 1,
        productNameSnapshot: product.name,
        priceNameSnapshot: price.name,
        unitAmountMinor: price.unitAmountMinor,
        lineSubtotalAmountMinor: price.unitAmountMinor,
        lineDiscountAmountMinor: 0,
        lineTotalAmountMinor: price.unitAmountMinor,
        currencyCode: "EUR",
      },
    });

    const entitlement = await prisma.clientEntitlement.create({
      data: {
        clientId: client.id,
        productId: product.id,
        orderId: order.id,
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        status: ClientEntitlementStatus.ACTIVE,
        activatedAt: new Date(),
      },
    });

    await prisma.creditLedgerEntry.create({
      data: {
        clientId: client.id,
        entitlementId: entitlement.id,
        orderId: order.id,
        entryType: CreditLedgerEntryType.GRANT,
        amount: 10,
        notes: "Class-pack grant.",
      },
    });

    // Assert
    const persistedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    const persistedOrderItem = await prisma.orderItem.findUnique({ where: { id: orderItem.id } });
    const persistedEntitlement = await prisma.clientEntitlement.findUnique({
      where: { id: entitlement.id },
    });
    const creditRows = await prisma.creditLedgerEntry.findMany({
      where: { clientId: client.id },
    });
    const balance = await getCreditBalance(prisma, client.id);

    expect(persistedOrder).toBeTruthy();
    expect(persistedOrderItem).toBeTruthy();
    expect(persistedEntitlement).toBeTruthy();
    expect(creditRows).toHaveLength(1);
    expect(balance).toBe(10);
  });
});
