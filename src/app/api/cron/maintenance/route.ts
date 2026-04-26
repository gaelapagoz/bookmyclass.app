import { cleanupStaleWebhookReceipts } from "@/lib/public-booking/webhook-receipt-cleanup";
import { expireStaleBookingDrafts } from "@/lib/public-booking/booking-draft-service";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [draftsResult, cleanupResult] = await Promise.allSettled([
    expireStaleBookingDrafts(),
    cleanupStaleWebhookReceipts(),
  ]);

  const expiredDrafts = draftsResult.status === "fulfilled" ? draftsResult.value.expiredCount : 0;
  const cleanedWebhooks = cleanupResult.status === "fulfilled" ? cleanupResult.value.cleanedCount : null;
  const cleanupError = cleanupResult.status === "rejected" ? String(cleanupResult.reason) : null;

  if (cleanupError) {
    console.error("[cron/maintenance] webhook receipt cleanup failed", { error: cleanupError });
  }

  return Response.json({
    ok: cleanupResult.status === "fulfilled",
    expiredBookingDrafts: expiredDrafts,
    cleanedWebhookReceipts: cleanedWebhooks,
    ...(cleanupError ? { cleanupError } : {}),
  });
}
