import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  expireStaleBookingDrafts: vi.fn(),
  cleanupStaleWebhookReceipts: vi.fn(),
  cleanupExpiredCouponReservations: vi.fn(),
  dispatchEmailAutomationBatch: vi.fn(),
  reconcileMissingBookingConfirmationEvents: vi.fn(),
}));

vi.mock("@/lib/public-booking/booking-draft-service", () => ({
  expireStaleBookingDrafts: mocks.expireStaleBookingDrafts,
}));

vi.mock("@/lib/public-booking/webhook-receipt-cleanup", () => ({
  cleanupStaleWebhookReceipts: mocks.cleanupStaleWebhookReceipts,
}));

vi.mock("@/lib/coupons/coupon-maintenance-service", () => ({
  cleanupExpiredCouponReservations: mocks.cleanupExpiredCouponReservations,
}));

vi.mock("@/lib/email/email-automation-dispatcher-service", () => ({
  dispatchEmailAutomationBatch: mocks.dispatchEmailAutomationBatch,
}));

vi.mock("@/lib/public-booking/booking-confirmation-transition-service", () => ({
  reconcileMissingBookingConfirmationEvents: mocks.reconcileMissingBookingConfirmationEvents,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    cartCheckoutIdempotency: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

import { GET } from "@/app/api/cron/maintenance/route";

describe("cron maintenance route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.expireStaleBookingDrafts.mockResolvedValue({ expiredCount: 2 });
    mocks.cleanupStaleWebhookReceipts.mockResolvedValue({ cleanedCount: 3 });
    mocks.cleanupExpiredCouponReservations.mockResolvedValue({ expiredCount: 4 });
    mocks.dispatchEmailAutomationBatch.mockResolvedValue({
      leasedCount: 1,
      sentCount: 1,
      failedCount: 0,
      deadLetterCount: 0,
      heartbeatWorkerId: "cron-maintenance",
    });
    mocks.reconcileMissingBookingConfirmationEvents.mockResolvedValue({
      scannedCount: 0,
      reconciledCount: 0,
    });
  });

  it("rejects unauthorized requests", async () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cron_secret_test";

    try {
      const response = await GET(
        new Request("http://localhost/api/cron/maintenance", {
          headers: { authorization: "Bearer wrong" },
        }),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    } finally {
      if (previous === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previous;
      }
    }
  });

  it("always runs canonical dispatcher", async () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cron_secret_test";

    try {
      const response = await GET(
        new Request("http://localhost/api/cron/maintenance", {
          headers: { authorization: "Bearer cron_secret_test" },
        }),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.expiredCouponReservations).toBe(4);
      expect(payload.emailAutomationDispatch).toMatchObject({
        leasedCount: 1,
        sentCount: 1,
      });
      expect(mocks.cleanupExpiredCouponReservations).toHaveBeenCalledTimes(1);
      expect(mocks.dispatchEmailAutomationBatch).toHaveBeenCalledWith({
        workerId: "cron-maintenance",
        maxEvents: 25,
        leaseMs: 30_000,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previous;
      }
    }
  });

  it("isolates dispatcher failures without changing maintenance ok semantics", async () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cron_secret_test";
    mocks.dispatchEmailAutomationBatch.mockRejectedValue(new Error("dispatch failed internals"));

    try {
      const response = await GET(
        new Request("http://localhost/api/cron/maintenance", {
          headers: { authorization: "Bearer cron_secret_test" },
        }),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.expiredBookingDrafts).toBe(2);
      expect(payload.cleanedWebhookReceipts).toBe(3);
      expect(payload.deletedCartCheckoutIdempotency).toBe(0);
      expect(payload.expiredCouponReservations).toBe(4);
      expect(payload.emailAutomationDispatch).toBeNull();
      expect(payload.dispatchError).toBe("EMAIL_AUTOMATION_DISPATCH_FAILED");
    } finally {
      if (previous === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previous;
      }
    }
  });

  it("marks maintenance as failed when coupon reservation cleanup fails", async () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cron_secret_test";
    mocks.cleanupExpiredCouponReservations.mockRejectedValue(new Error("coupon cleanup failed"));

    try {
      const response = await GET(
        new Request("http://localhost/api/cron/maintenance", {
          headers: { authorization: "Bearer cron_secret_test" },
        }),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(false);
      expect(payload.expiredCouponReservations).toBeNull();
      expect(payload.couponReservationError).toBe("COUPON_RESERVATION_CLEANUP_FAILED");
    } finally {
      if (previous === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previous;
      }
    }
  });
});
