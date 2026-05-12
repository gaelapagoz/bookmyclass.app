import { cleanupExpiredGiftCardReservations } from "@/lib/gift-cards/gift-card-maintenance-service";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cleanup = await cleanupExpiredGiftCardReservations();

  return Response.json({
    ok: cleanup.failedCount === 0,
    ...cleanup,
  });
}
