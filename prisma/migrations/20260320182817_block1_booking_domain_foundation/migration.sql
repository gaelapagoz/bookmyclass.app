-- CreateEnum
CREATE TYPE "ServicePricingMode" AS ENUM ('SINGLE_ONLY', 'PLAN_ONLY', 'SINGLE_OR_PLAN');

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'PENDING';

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_clientId_fkey";

-- DropIndex
DROP INDEX "Booking_clientId_status_idx";

-- DropIndex
DROP INDEX "ClassType_categoryId_isActive_sortOrder_idx";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "customerMessage" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "orderId" TEXT,
ALTER COLUMN "clientId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ClassType" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pricingMode" "ServicePricingMode" NOT NULL DEFAULT 'SINGLE_OR_PLAN';

-- CreateIndex
CREATE INDEX "Booking_clientId_status_bookedAt_idx" ON "Booking"("clientId", "status", "bookedAt");

-- CreateIndex
CREATE INDEX "Booking_orderId_idx" ON "Booking"("orderId");

-- CreateIndex
CREATE INDEX "Booking_customerEmail_bookedAt_idx" ON "Booking"("customerEmail", "bookedAt");

-- CreateIndex
CREATE INDEX "Booking_studioSessionId_customerEmail_idx" ON "Booking"("studioSessionId", "customerEmail");

-- CreateIndex
CREATE INDEX "ClassType_categoryId_isActive_isVisible_sortOrder_idx" ON "ClassType"("categoryId", "isActive", "isVisible", "sortOrder");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
