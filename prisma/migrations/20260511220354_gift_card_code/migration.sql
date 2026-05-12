/*
  Warnings:

  - You are about to drop the `PriceStripeIdRemediationRequest` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "GiftCardCodeStatus" AS ENUM ('ISSUED', 'REDEEMED', 'VOIDED', 'EXPIRED');

-- DropForeignKey
ALTER TABLE "PriceStripeIdRemediationRequest" DROP CONSTRAINT "PriceStripeIdRemediationRequest_actor_fkey";

-- DropForeignKey
ALTER TABLE "PriceStripeIdRemediationRequest" DROP CONSTRAINT "PriceStripeIdRemediationRequest_price_fkey";

-- DropTable
DROP TABLE "PriceStripeIdRemediationRequest";

-- CreateTable
CREATE TABLE "GiftCardCode" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "purchasedById" TEXT NOT NULL,
    "redeemedById" TEXT,
    "codeHash" TEXT NOT NULL,
    "maskedCode" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "status" "GiftCardCodeStatus" NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCardCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardCode_orderItemId_key" ON "GiftCardCode"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardCode_codeHash_key" ON "GiftCardCode"("codeHash");

-- CreateIndex
CREATE INDEX "GiftCardCode_purchasedById_idx" ON "GiftCardCode"("purchasedById");

-- CreateIndex
CREATE INDEX "GiftCardCode_redeemedById_idx" ON "GiftCardCode"("redeemedById");

-- CreateIndex
CREATE INDEX "GiftCardCode_status_idx" ON "GiftCardCode"("status");

-- AddForeignKey
ALTER TABLE "GiftCardCode" ADD CONSTRAINT "GiftCardCode_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardCode" ADD CONSTRAINT "GiftCardCode_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardCode" ADD CONSTRAINT "GiftCardCode_purchasedById_fkey" FOREIGN KEY ("purchasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardCode" ADD CONSTRAINT "GiftCardCode_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
