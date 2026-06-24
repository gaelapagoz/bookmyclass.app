import "./helpers/setup-env";

import {
  EmailAutomationEventStatus,
  LoyaltyCreditLedgerEntryType,
  LoyaltyCreditReservationStatus,
  LoyaltyPointsLedgerEntryType,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Role,
  UserActivationStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  cleanupExpiredLoyaltyCreditReservations,
  enqueueLoyaltyExpirationReminderNotifications,
  expireDueLoyaltyPoints,
} from "../../src/lib/loyalty/loyalty-maintenance-service";
import { reserveLoyaltyCreditValue } from "../../src/lib/loyalty/loyalty-redemption-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

const actor = { type: "SYSTEM" as const, label: "loyalty-maintenance-test" };

async function createVerifiedClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const verifiedAt = new Date();

  return prisma.user.create({
    data: {
      name: `Loyalty Client ${unique}`,
      email: `loyalty-maintenance-${unique}@example.test`,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: verifiedAt,
      emailVerifiedAt: verifiedAt,
    },
  });
}

async function createActiveLoyaltyReminderTemplate() {
  await prisma.emailTemplate.create({
    data: {
      templateKey: "loyalty.points-expiring",
      name: "Loyalty Reminder",
      category: "Loyalty",
      subjectTemplate: "{{loyalty.pointsExpiring}} loyalty points expire on {{loyalty.expiresAt}}",
      bodyTemplateJson: {
        blocks: [{ type: "paragraph", contentHtml: "<p>Hello {{contact.fullName}}</p>" }],
      },
      contentSchemaVersion: 1,
      isActive: true,
    },
  });
}

describe("loyalty maintenance service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("expires due loyalty points and keeps reminder enqueue replay-safe", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const client = await createVerifiedClient();
    await createActiveLoyaltyReminderTemplate();
    await prisma.loyaltyProgram.create({
      data: {
        currencyCode: "EUR",
        isActive: true,
        earningPoints: 10,
        earningAmountMinor: 500,
        pointsExpireAfterDays: 30,
        expirationReminderDays: 7,
        maxManualGrantPoints: 500,
      },
    });

    const expiringSource = await prisma.loyaltyPointsLedgerEntry.create({
      data: {
        clientId: client.id,
        entryType: LoyaltyPointsLedgerEntryType.EARN,
        amountPoints: 120,
        currencyCode: "EUR",
        idempotencyKey: "loyalty-maintenance-expire-source",
        happenedAt: new Date("2026-05-01T10:00:00.000Z"),
        expiresAt: new Date("2026-06-24T08:00:00.000Z"),
      },
    });
    const reminderSource = await prisma.loyaltyPointsLedgerEntry.create({
      data: {
        clientId: client.id,
        entryType: LoyaltyPointsLedgerEntryType.EARN,
        amountPoints: 80,
        currencyCode: "EUR",
        idempotencyKey: "loyalty-maintenance-reminder-source",
        happenedAt: new Date("2026-06-01T10:00:00.000Z"),
        expiresAt: new Date("2026-07-01T12:00:00.000Z"),
      },
    });

    const expireFirst = await expireDueLoyaltyPoints({ now });
    const expireSecond = await expireDueLoyaltyPoints({ now });
    const reminderFirst = await enqueueLoyaltyExpirationReminderNotifications({ now });
    const reminderSecond = await enqueueLoyaltyExpirationReminderNotifications({ now });

    expect(expireFirst).toMatchObject({
      scannedCount: 1,
      createdCount: 1,
      replayedCount: 0,
      failedCount: 0,
    });
    expect(expireSecond).toMatchObject({
      scannedCount: 1,
      createdCount: 0,
      replayedCount: 1,
      failedCount: 0,
    });
    expect(reminderFirst).toMatchObject({
      scannedCount: 1,
      enqueuedCount: 1,
      failedCount: 0,
    });
    expect(reminderSecond).toMatchObject({
      scannedCount: 1,
      enqueuedCount: 1,
      failedCount: 0,
    });

    await expect(prisma.loyaltyPointsLedgerEntry.findFirstOrThrow({
      where: {
        sourceEntryId: expiringSource.id,
        entryType: LoyaltyPointsLedgerEntryType.EXPIRE,
      },
    })).resolves.toMatchObject({
      amountPoints: -120,
      metadata: expect.objectContaining({
        source: "loyalty-maintenance",
        effectiveDate: "2026-06-24",
      }),
    });
    expect(
      await prisma.emailAutomationEvent.count({
        where: {
          template: { templateKey: "loyalty.points-expiring" },
          status: EmailAutomationEventStatus.PENDING,
          idempotencyKey: "loyalty:reminder:entry:" + reminderSource.id + ":2026-06-24:maintenance-v1",
        },
      }),
    ).toBe(1);
  });

  it("releases stale loyalty credit reservations without Stripe checkout sessions", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const client = await createVerifiedClient();
    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 500,
        totalAmountMinor: 500,
        currencyCode: "EUR",
        status: OrderStatus.PLACED,
      },
    });
    await prisma.loyaltyCreditLedgerEntry.create({
      data: {
        clientId: client.id,
        entryType: LoyaltyCreditLedgerEntryType.REDEEM,
        amountMinor: 500,
        currencyCode: "EUR",
        idempotencyKey: "loyalty-credit-balance-seed",
        payloadHash: "balance-seed",
      },
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.PENDING,
        method: PaymentMethod.LOYALTY_CREDIT,
        provider: PaymentProvider.INTERNAL,
        amountMinor: 500,
        currencyCode: "EUR",
      },
    });

    const reserved = await reserveLoyaltyCreditValue({
      actor,
      clientId: client.id,
      orderId: order.id,
      amountMinor: 500,
      currencyCode: "EUR",
      expiresAt: new Date("2026-06-24T09:45:00.000Z"),
      idempotencyKey: "loyalty-credit-reserve-cleanup",
    });

    const result = await cleanupExpiredLoyaltyCreditReservations({ now });

    expect(result).toMatchObject({
      scannedCount: 1,
      releasedCount: 1,
      failedCount: 0,
      paymentFailedCount: 1,
      orderCancelledCount: 1,
    });
    await expect(prisma.loyaltyCreditReservation.findUniqueOrThrow({
      where: { id: reserved.reservation.id },
    })).resolves.toMatchObject({
      status: LoyaltyCreditReservationStatus.RELEASED,
      releasedAmountMinor: 500,
    });
    await expect(prisma.payment.findFirstOrThrow({
      where: { orderId: order.id, method: PaymentMethod.LOYALTY_CREDIT },
    })).resolves.toMatchObject({
      status: PaymentStatus.FAILED,
      failureReason: "LOYALTY_CREDIT_RESERVATION_EXPIRED",
    });
  });

  it("does not release loyalty reservations once a Stripe checkout session exists", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const client = await createVerifiedClient();
    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 500,
        totalAmountMinor: 500,
        currencyCode: "EUR",
        status: OrderStatus.PLACED,
      },
    });
    await prisma.loyaltyCreditLedgerEntry.create({
      data: {
        clientId: client.id,
        entryType: LoyaltyCreditLedgerEntryType.REDEEM,
        amountMinor: 500,
        currencyCode: "EUR",
        idempotencyKey: "loyalty-credit-balance-seed-stripe",
        payloadHash: "balance-seed-stripe",
      },
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.PENDING,
        method: PaymentMethod.LOYALTY_CREDIT,
        provider: PaymentProvider.INTERNAL,
        amountMinor: 500,
        currencyCode: "EUR",
      },
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.PENDING,
        method: PaymentMethod.CARD,
        provider: PaymentProvider.STRIPE,
        amountMinor: 1_000,
        currencyCode: "EUR",
        stripeCheckoutSessionId: "cs_live_existing_checkout",
      },
    });

    const reserved = await reserveLoyaltyCreditValue({
      actor,
      clientId: client.id,
      orderId: order.id,
      amountMinor: 500,
      currencyCode: "EUR",
      expiresAt: new Date("2026-06-24T09:45:00.000Z"),
      idempotencyKey: "loyalty-credit-reserve-skip",
    });

    const result = await cleanupExpiredLoyaltyCreditReservations({ now });

    expect(result).toMatchObject({
      scannedCount: 0,
      releasedCount: 0,
      failedCount: 0,
    });
    await expect(prisma.loyaltyCreditReservation.findUniqueOrThrow({
      where: { id: reserved.reservation.id },
    })).resolves.toMatchObject({
      status: LoyaltyCreditReservationStatus.RESERVED,
    });
  });
});
