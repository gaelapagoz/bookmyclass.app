import "./helpers/setup-env";

import { CouponRedemptionStatus, CouponStatus, LoyaltyPointsLedgerEntryType, Role, UserActivationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  expireStaleBookingDrafts: vi.fn(),
  cleanupStaleWebhookReceipts: vi.fn(),
  dispatchEmailAutomationBatch: vi.fn(),
  reconcileMissingBookingConfirmationEvents: vi.fn(),
  enqueueBookingReminderNotifications: vi.fn(),
  enqueueWaitlistNotPromotedNotifications: vi.fn(),
}));

vi.mock("@/lib/public-booking/booking-draft-service", () => ({
  expireStaleBookingDrafts: mocks.expireStaleBookingDrafts,
}));

vi.mock("@/lib/public-booking/webhook-receipt-cleanup", () => ({
  cleanupStaleWebhookReceipts: mocks.cleanupStaleWebhookReceipts,
}));

vi.mock("@/lib/email/email-automation-dispatcher-service", () => ({
  dispatchEmailAutomationBatch: mocks.dispatchEmailAutomationBatch,
}));

vi.mock("@/lib/public-booking/booking-confirmation-transition-service", () => ({
  reconcileMissingBookingConfirmationEvents: mocks.reconcileMissingBookingConfirmationEvents,
}));

vi.mock("@/lib/public-booking/booking-reminder-notification-service", () => ({
  enqueueBookingReminderNotifications: mocks.enqueueBookingReminderNotifications,
}));

vi.mock("@/lib/public-booking/waitlist-notification-service", () => ({
  enqueueWaitlistNotPromotedNotifications: mocks.enqueueWaitlistNotPromotedNotifications,
}));

import { GET } from "../../src/app/api/cron/maintenance/route";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("cron maintenance route integration", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mocks.expireStaleBookingDrafts.mockResolvedValue({ expiredCount: 0 });
    mocks.cleanupStaleWebhookReceipts.mockResolvedValue({ cleanedCount: 0 });
    mocks.dispatchEmailAutomationBatch.mockResolvedValue({
      leasedCount: 0,
      sentCount: 0,
      failedCount: 0,
      deadLetterCount: 0,
      heartbeatWorkerId: "cron-maintenance",
    });
    mocks.reconcileMissingBookingConfirmationEvents.mockResolvedValue({
      scannedCount: 0,
      reconciledCount: 0,
    });
    mocks.enqueueBookingReminderNotifications.mockResolvedValue({
      scanned: 0,
      enqueued: 0,
      failed: 0,
    });
    mocks.enqueueWaitlistNotPromotedNotifications.mockResolvedValue({
      scanned: 0,
      enqueued: 0,
      failed: 0,
    });
  });

  it("uses the canonical maintenance route to expire stale coupon reservations", async () => {
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cron_secret_test";

    try {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const admin = await prisma.user.create({
        data: {
          name: "Coupon Admin",
          email: `coupon-admin-${unique}@example.test`,
          role: Role.ADMIN,
        },
      });
      const client = await prisma.user.create({
        data: {
          name: "Coupon Client",
          email: `coupon-client-${unique}@example.test`,
          role: Role.CLIENT,
        },
      });
      const coupon = await prisma.coupon.create({
        data: {
          code: `MAINT_${Date.now()}`,
          status: CouponStatus.ACTIVE,
          discountType: "PERCENTAGE",
          discountPercentBps: 1500,
          maxTotalRedemptions: 1,
          expiresAt: new Date("2026-12-31T00:00:00.000Z"),
          createdById: admin.id,
        },
      });

      await prisma.couponRedemption.create({
        data: {
          couponId: coupon.id,
          clientId: client.id,
          status: CouponRedemptionStatus.RESERVED,
          couponCodeSnapshot: coupon.code,
          subtotalBeforeMinor: 1000,
          discountAmountMinor: 100,
          totalAfterMinor: 900,
          currencyCode: "EUR",
          idempotencyKey: `idem-maint-${Date.now()}`,
          payloadHash: "hash-maint",
          expiresAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });

      const response = await GET(
        new Request("http://localhost/api/cron/maintenance", {
          headers: { authorization: "Bearer cron_secret_test" },
        }),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        ok: true,
        expiredCouponReservations: 1,
        bookingReminder: {
          scanned: 0,
          enqueued: 0,
          failed: 0,
        },
        waitlistNotPromoted: {
          scanned: 0,
          enqueued: 0,
          failed: 0,
        },
      });
      expect(
        await prisma.couponRedemption.count({
          where: {
            couponId: coupon.id,
            status: CouponRedemptionStatus.RESERVED,
          },
        }),
      ).toBe(0);
      expect(
        await prisma.couponRedemption.count({
          where: {
            couponId: coupon.id,
            status: CouponRedemptionStatus.EXPIRED,
          },
        }),
      ).toBe(1);
    } finally {
      if (previousSecret === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previousSecret;
      }
    }
  });

  it("runs loyalty expiration and reminder maintenance through the canonical route", async () => {
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cron_secret_test";

    try {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const verifiedAt = new Date();
      const client = await prisma.user.create({
        data: {
          name: "Loyalty Client",
          email: `loyalty-client-${unique}@example.test`,
          role: Role.CLIENT,
          isActive: true,
          isInactive: false,
          activationStatus: UserActivationStatus.ACTIVE,
          emailVerified: verifiedAt,
          emailVerifiedAt: verifiedAt,
        },
      });
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
      const now = new Date();
      const expiringEntry = await prisma.loyaltyPointsLedgerEntry.create({
        data: {
          clientId: client.id,
          entryType: LoyaltyPointsLedgerEntryType.EARN,
          amountPoints: 50,
          currencyCode: "EUR",
          idempotencyKey: `loyalty-route-expire-${unique}`,
          happenedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(now.getTime() - 60 * 60 * 1000),
        },
      });
      const reminderEntry = await prisma.loyaltyPointsLedgerEntry.create({
        data: {
          clientId: client.id,
          entryType: LoyaltyPointsLedgerEntryType.EARN,
          amountPoints: 70,
          currencyCode: "EUR",
          idempotencyKey: `loyalty-route-reminder-${unique}`,
          happenedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
        },
      });

      const response = await GET(
        new Request("http://localhost/api/cron/maintenance", {
          headers: { authorization: "Bearer cron_secret_test" },
        }),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.loyaltyExpiration).toMatchObject({
        scannedCount: 1,
        createdCount: 1,
        failedCount: 0,
      });
      expect(payload.loyaltyReminder).toMatchObject({
        scannedCount: 1,
        enqueuedCount: 1,
        failedCount: 0,
      });
      expect(
        await prisma.loyaltyPointsLedgerEntry.count({
          where: {
            sourceEntryId: expiringEntry.id,
            entryType: LoyaltyPointsLedgerEntryType.EXPIRE,
          },
        }),
      ).toBe(1);
      expect(
        await prisma.emailAutomationEvent.count({
          where: {
            template: { templateKey: "loyalty.points-expiring" },
            idempotencyKey: {
              startsWith: `loyalty:reminder:entry:${reminderEntry.id}:`,
            },
          },
        }),
      ).toBe(1);
    } finally {
      if (previousSecret === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previousSecret;
      }
    }
  });
});
