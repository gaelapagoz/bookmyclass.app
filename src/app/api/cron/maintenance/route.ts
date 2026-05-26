import { CartCheckoutIdempotencyState } from "@prisma/client";
import { cleanupStaleWebhookReceipts } from "@/lib/public-booking/webhook-receipt-cleanup";
import { expireStaleBookingDrafts } from "@/lib/public-booking/booking-draft-service";
import { prisma } from "@/lib/db";
import {
  dispatchEmailAutomationBatch,
} from "@/lib/email/email-automation-dispatcher-service";
import { reconcileMissingBookingConfirmationEvents } from "@/lib/public-booking/booking-confirmation-transition-service";

const CART_IDEMPOTENCY_TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CART_IDEMPOTENCY_IN_PROGRESS_RETENTION_MS = 60 * 60 * 1000; // 1 hour

const CLEANUP_ERROR_CODE = "WEBHOOK_RECEIPT_CLEANUP_FAILED";
const CART_IDEMPOTENCY_ERROR_CODE = "CART_CHECKOUT_IDEMPOTENCY_CLEANUP_FAILED";
const DISPATCH_ERROR_CODE = "EMAIL_AUTOMATION_DISPATCH_FAILED";
const BOOKING_CONFIRMATION_RECONCILE_ERROR_CODE = "BOOKING_CONFIRMATION_RECONCILE_FAILED";

async function cleanupStaleCartCheckoutIdempotency(): Promise<{ deletedCount: number }> {
  const now = new Date();
  const terminalCutoff = new Date(now.getTime() - CART_IDEMPOTENCY_TERMINAL_RETENTION_MS);
  const inProgressCutoff = new Date(now.getTime() - CART_IDEMPOTENCY_IN_PROGRESS_RETENTION_MS);

  const [terminalResult, inProgressResult] = await Promise.all([
    prisma.cartCheckoutIdempotency.deleteMany({
      where: {
        state: {
          in: [
            CartCheckoutIdempotencyState.SUCCEEDED,
            CartCheckoutIdempotencyState.FAILED_BEFORE_WRITE,
            CartCheckoutIdempotencyState.FAILED_AFTER_WRITE_PRE_STRIPE,
            CartCheckoutIdempotencyState.FAILED_STRIPE_UNCERTAIN,
          ],
        },
        updatedAt: { lt: terminalCutoff },
      },
    }),
    prisma.cartCheckoutIdempotency.deleteMany({
      where: {
        state: CartCheckoutIdempotencyState.IN_PROGRESS,
        updatedAt: { lt: inProgressCutoff },
      },
    }),
  ]);

  return { deletedCount: terminalResult.count + inProgressResult.count };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [draftsResult, cleanupResult, cartIdempotencyResult, bookingConfirmationResult] = await Promise.allSettled([
    expireStaleBookingDrafts(),
    cleanupStaleWebhookReceipts(),
    cleanupStaleCartCheckoutIdempotency(),
    reconcileMissingBookingConfirmationEvents({ limit: 100 }),
  ]);
  const dispatcherResult = await Promise.allSettled([
    dispatchEmailAutomationBatch({
      workerId: "cron-maintenance",
      maxEvents: 25,
      leaseMs: 30_000,
    }),
  ]).then((results) => results[0]);

  const expiredDrafts = draftsResult.status === "fulfilled" ? draftsResult.value.expiredCount : 0;
  const cleanedWebhooks = cleanupResult.status === "fulfilled" ? cleanupResult.value.cleanedCount : null;
  const cleanupError = cleanupResult.status === "rejected" ? CLEANUP_ERROR_CODE : null;
  const deletedCartIdempotency = cartIdempotencyResult.status === "fulfilled" ? cartIdempotencyResult.value.deletedCount : null;
  const cartIdempotencyError = cartIdempotencyResult.status === "rejected" ? CART_IDEMPOTENCY_ERROR_CODE : null;
  const dispatchResult = dispatcherResult.status === "fulfilled" ? dispatcherResult.value : null;
  const dispatchError = dispatcherResult.status === "rejected" ? DISPATCH_ERROR_CODE : null;
  const bookingConfirmationReconcile =
    bookingConfirmationResult.status === "fulfilled" ? bookingConfirmationResult.value : null;
  const bookingConfirmationError =
    bookingConfirmationResult.status === "rejected" ? BOOKING_CONFIRMATION_RECONCILE_ERROR_CODE : null;
  const cleanupErrorDetail = cleanupResult.status === "rejected" ? String(cleanupResult.reason) : null;
  const cartIdempotencyErrorDetail =
    cartIdempotencyResult.status === "rejected" ? String(cartIdempotencyResult.reason) : null;
  const dispatchErrorDetail = dispatcherResult.status === "rejected" ? String(dispatcherResult.reason) : null;
  const bookingConfirmationErrorDetail =
    bookingConfirmationResult.status === "rejected" ? String(bookingConfirmationResult.reason) : null;

  if (cleanupError) {
    console.error("[cron/maintenance] webhook receipt cleanup failed", {
      code: CLEANUP_ERROR_CODE,
      error: cleanupErrorDetail,
    });
  }
  if (cartIdempotencyError) {
    console.error("[cron/maintenance] cart checkout idempotency cleanup failed", {
      code: CART_IDEMPOTENCY_ERROR_CODE,
      error: cartIdempotencyErrorDetail,
    });
  }
  if (dispatchError) {
    console.error("[cron/maintenance] email automation dispatch failed", {
      code: DISPATCH_ERROR_CODE,
      error: dispatchErrorDetail,
    });
  }
  if (bookingConfirmationError) {
    console.error("[cron/maintenance] booking confirmation reconciliation failed", {
      code: BOOKING_CONFIRMATION_RECONCILE_ERROR_CODE,
      error: bookingConfirmationErrorDetail,
    });
  }

  return Response.json({
    ok: cleanupResult.status === "fulfilled" && cartIdempotencyResult.status === "fulfilled",
    expiredBookingDrafts: expiredDrafts,
    cleanedWebhookReceipts: cleanedWebhooks,
    deletedCartCheckoutIdempotency: deletedCartIdempotency,
    emailAutomationDispatch: dispatchResult,
    bookingConfirmationReconcile,
    ...(cleanupError ? { cleanupError } : {}),
    ...(cartIdempotencyError ? { cartIdempotencyError } : {}),
    ...(dispatchError ? { dispatchError } : {}),
    ...(bookingConfirmationError ? { bookingConfirmationError } : {}),
  });
}
