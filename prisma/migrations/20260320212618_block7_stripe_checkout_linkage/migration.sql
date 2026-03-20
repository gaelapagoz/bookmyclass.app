-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "bookingId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Payment_bookingId_status_createdAt_idx" ON "Payment"("bookingId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
