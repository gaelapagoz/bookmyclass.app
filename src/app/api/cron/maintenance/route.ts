import { CartCheckoutIdempotencyState } from "@prisma/client";
import { cleanupStaleWebhookReceipts } from "@/lib/public-booking/webhook-receipt-cleanup";
import { expireStaleBookingDrafts } from "@/lib/public-booking/booking-draft-service";
import { prisma } from "@/lib/db";

const CART_IDEMPOTENCY_TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CART_IDEMPOTENCY_IN_PROGRESS_RETENTION_MS = 60 * 60 * 1000; // 1 hour

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

  const [draftsResult, cleanupResult, cartIdempotencyResult] = await Promise.allSettled([
    expireStaleBookingDrafts(),
    cleanupStaleWebhookReceipts(),
    cleanupStaleCartCheckoutIdempotency(),
  ]);

  const expiredDrafts = draftsResult.status === "fulfilled" ? draftsResult.value.expiredCount : 0;
  const cleanedWebhooks = cleanupResult.status === "fulfilled" ? cleanupResult.value.cleanedCount : null;
  const cleanupError = cleanupResult.status === "rejected" ? String(cleanupResult.reason) : null;
  const deletedCartIdempotency = cartIdempotencyResult.status === "fulfilled" ? cartIdempotencyResult.value.deletedCount : null;
  const cartIdempotencyError = cartIdempotencyResult.status === "rejected" ? String(cartIdempotencyResult.reason) : null;

  if (cleanupError) {
    console.error("[cron/maintenance] webhook receipt cleanup failed", { error: cleanupError });
  }
  if (cartIdempotencyError) {
    console.error("[cron/maintenance] cart checkout idempotency cleanup failed", { error: cartIdempotencyError });
  }

  return Response.json({
    ok: cleanupResult.status === "fulfilled" && cartIdempotencyResult.status === "fulfilled",
    expiredBookingDrafts: expiredDrafts,
    cleanedWebhookReceipts: cleanedWebhooks,
    deletedCartCheckoutIdempotency: deletedCartIdempotency,
    ...(cleanupError ? { cleanupError } : {}),
    ...(cartIdempotencyError ? { cartIdempotencyError } : {}),
  });
}
