-- CreateEnum
CREATE TYPE "BookingPaymentSelection" AS ENUM ('SINGLE_SESSION', 'EXISTING_PLAN', 'NEW_PLAN_PURCHASE');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "draftAmountMinor" INTEGER,
ADD COLUMN     "draftCurrencyCode" TEXT,
ADD COLUMN     "paymentSelection" "BookingPaymentSelection",
ADD COLUMN     "selectedEntitlementId" TEXT,
ADD COLUMN     "selectedPriceId" TEXT;

-- CreateIndex
CREATE INDEX "Booking_selectedEntitlementId_idx" ON "Booking"("selectedEntitlementId");

-- CreateIndex
CREATE INDEX "Booking_selectedPriceId_idx" ON "Booking"("selectedPriceId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_selectedEntitlementId_fkey" FOREIGN KEY ("selectedEntitlementId") REFERENCES "ClientEntitlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_selectedPriceId_fkey" FOREIGN KEY ("selectedPriceId") REFERENCES "Price"("id") ON DELETE SET NULL ON UPDATE CASCADE;
