-- CreateEnum
CREATE TYPE "CheckoutSource" AS ENUM ('BOOKING_FLOW', 'SUBSCRIPTION_CATALOG', 'CART_CHECKOUT_V1');

-- CreateEnum
CREATE TYPE "CartCheckoutIdempotencyState" AS ENUM (
  'IN_PROGRESS',
  'SUCCEEDED',
  'FAILED_BEFORE_WRITE',
  'FAILED_AFTER_WRITE_PRE_STRIPE',
  'FAILED_STRIPE_UNCERTAIN'
);

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "checkoutSource" "CheckoutSource";

-- CreateTable
CREATE TABLE "CartCheckoutIdempotency" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "cartHash" TEXT NOT NULL,
  "state" "CartCheckoutIdempotencyState" NOT NULL,
  "orderId" TEXT,
  "paymentId" TEXT,
  "responseStatus" INTEGER,
  "responseCode" TEXT,
  "responseMessage" TEXT,
  "responseBody" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CartCheckoutIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CartCheckoutIdempotency_userId_idempotencyKey_key"
ON "CartCheckoutIdempotency"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CartCheckoutIdempotency_userId_createdAt_idx"
ON "CartCheckoutIdempotency"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_checkoutSource_createdAt_idx"
ON "Payment"("checkoutSource", "createdAt");
