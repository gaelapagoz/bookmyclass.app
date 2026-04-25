import { StripeWebhookReceiptStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

const RETENTION_DAYS = 90;

export async function cleanupStaleWebhookReceipts(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  try {
    const result = await prisma.stripeWebhookEventReceipt.deleteMany({
      where: {
        status: StripeWebhookReceiptStatus.PROCESSED,
        updatedAt: { lt: cutoff },
      },
    });

    console.info("[webhook-receipt-cleanup] removed stale receipts", {
      count: result.count,
      cutoff: cutoff.toISOString(),
    });
  } catch (error) {
    console.error("[webhook-receipt-cleanup] cleanup failed", { error });
  }
}
