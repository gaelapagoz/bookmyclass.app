-- Part 2: Add StripeWebhookEventReceipt for webhook deduplication

CREATE TYPE "StripeWebhookReceiptStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'RETRYABLE_FAILED');

CREATE TABLE "StripeWebhookEventReceipt" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "StripeWebhookReceiptStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeWebhookEventReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeWebhookEventReceipt_eventId_key" ON "StripeWebhookEventReceipt"("eventId");

CREATE INDEX "StripeWebhookEventReceipt_status_updatedAt_idx" ON "StripeWebhookEventReceipt"("status", "updatedAt");
