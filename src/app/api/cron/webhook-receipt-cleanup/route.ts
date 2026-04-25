import { cleanupStaleWebhookReceipts } from "@/lib/public-booking/webhook-receipt-cleanup";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await cleanupStaleWebhookReceipts();
  return Response.json({ ok: true });
}
