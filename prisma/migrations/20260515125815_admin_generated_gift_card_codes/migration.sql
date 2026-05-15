-- CreateEnum
CREATE TYPE "GiftCardCodeSource" AS ENUM ('PURCHASED', 'ADMIN_GENERATED');

-- CreateEnum
CREATE TYPE "GiftCardCodeEmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- DropForeignKey
ALTER TABLE "GiftCardCode" DROP CONSTRAINT "GiftCardCode_orderId_fkey";

-- DropForeignKey
ALTER TABLE "GiftCardCode" DROP CONSTRAINT "GiftCardCode_orderItemId_fkey";

-- DropForeignKey
ALTER TABLE "GiftCardCode" DROP CONSTRAINT "GiftCardCode_purchasedById_fkey";

-- AlterTable
ALTER TABLE "GiftCardCode" ADD COLUMN     "adminMessage" TEXT,
ADD COLUMN     "adminReason" TEXT,
ADD COLUMN     "emailSentAt" TIMESTAMP(3),
ADD COLUMN     "emailStatus" "GiftCardCodeEmailStatus",
ADD COLUMN     "generatedById" TEXT,
ADD COLUMN     "recipientEmail" TEXT,
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "source" "GiftCardCodeSource" NOT NULL DEFAULT 'PURCHASED',
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL,
ALTER COLUMN "orderItemId" DROP NOT NULL,
ALTER COLUMN "purchasedById" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "GiftCardCode_generatedById_idx" ON "GiftCardCode"("generatedById");

-- CreateIndex
CREATE INDEX "GiftCardCode_voidedById_idx" ON "GiftCardCode"("voidedById");

-- CreateIndex
CREATE INDEX "GiftCardCode_source_status_idx" ON "GiftCardCode"("source", "status");

-- AddForeignKey
ALTER TABLE "GiftCardCode" ADD CONSTRAINT "GiftCardCode_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardCode" ADD CONSTRAINT "GiftCardCode_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardCode" ADD CONSTRAINT "GiftCardCode_purchasedById_fkey" FOREIGN KEY ("purchasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardCode" ADD CONSTRAINT "GiftCardCode_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardCode" ADD CONSTRAINT "GiftCardCode_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
