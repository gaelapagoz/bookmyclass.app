import {
  LoyaltyCreditReservationStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    payment: {
      updateMany: vi.fn(),
    },
    order: {
      updateMany: vi.fn(),
    },
  };

  return {
    tx,
    findMany: vi.fn(),
    findUnique: vi.fn(),
    transaction: vi.fn(),
    releaseLoyaltyCreditReservation: vi.fn(),
    ensureExpectedAutomationTemplateExists: vi.fn(),
    enqueueEmailAutomationEvent: vi.fn(),
    expireLoyaltyPointsEntry: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    loyaltyCreditReservation: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/loyalty/loyalty-redemption-service", () => ({
  releaseLoyaltyCreditReservation: mocks.releaseLoyaltyCreditReservation,
}));

vi.mock("@/lib/email/email-automation-admin-service", () => ({
  ensureExpectedAutomationTemplateExists: mocks.ensureExpectedAutomationTemplateExists,
}));

vi.mock("@/lib/email/email-automation-outbox-service", () => ({
  enqueueEmailAutomationEvent: mocks.enqueueEmailAutomationEvent,
}));

vi.mock("@/lib/loyalty/loyalty-points-service", () => ({
  expireLoyaltyPointsEntry: mocks.expireLoyaltyPointsEntry,
}));

import { cleanupExpiredLoyaltyCreditReservations } from "@/lib/loyalty/loyalty-maintenance-service";

describe("loyalty maintenance reservation cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([
      {
        id: "reservation_1",
        orderId: "order_1",
        clientId: "client_1",
      },
    ]);
    mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx));
    mocks.releaseLoyaltyCreditReservation.mockResolvedValue({
      idempotent: false,
      reservation: {
        id: "reservation_1",
        orderId: "order_1",
        status: LoyaltyCreditReservationStatus.RELEASED,
      },
    });
    mocks.tx.payment.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.order.updateMany.mockResolvedValue({ count: 1 });
  });

  it("releases reservations and marks order side effects inside one transaction", async () => {
    const result = await cleanupExpiredLoyaltyCreditReservations({
      now: new Date("2026-06-24T10:00:00.000Z"),
    });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.releaseLoyaltyCreditReservation).toHaveBeenCalledWith({
      actor: { type: "SYSTEM", label: "loyalty-maintenance" },
      reservationId: "reservation_1",
      idempotencyKey: "loyalty-credit:release:reservation:reservation_1",
      metadata: { source: "loyalty-maintenance" },
      prismaClient: mocks.tx,
    });
    expect(mocks.tx.payment.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: "order_1",
        provider: PaymentProvider.INTERNAL,
        method: PaymentMethod.LOYALTY_CREDIT,
        status: PaymentStatus.PENDING,
      },
      data: {
        status: PaymentStatus.FAILED,
        failedAt: new Date("2026-06-24T10:00:00.000Z"),
        failureReason: "LOYALTY_CREDIT_RESERVATION_EXPIRED",
      },
    });
    expect(mocks.tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: "order_1",
        status: { in: [OrderStatus.DRAFT, OrderStatus.PLACED] },
      },
      data: { status: OrderStatus.CANCELLED },
    });
    expect(result).toMatchObject({
      scannedCount: 1,
      releasedCount: 1,
      failedCount: 0,
      paymentFailedCount: 1,
      orderCancelledCount: 1,
    });
  });

  it("does not count a release when side effects fail inside the transaction", async () => {
    mocks.tx.order.updateMany.mockRejectedValue(new Error("order update failed"));

    const result = await cleanupExpiredLoyaltyCreditReservations({
      now: new Date("2026-06-24T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      scannedCount: 1,
      releasedCount: 0,
      failedCount: 1,
      paymentFailedCount: 0,
      orderCancelledCount: 0,
    });
  });
});
