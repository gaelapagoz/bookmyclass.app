-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "BookingStatus" ADD VALUE 'NO_SHOW';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cancellationEligibleUntilAt" TIMESTAMP(3),
ADD COLUMN     "creditRefundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- CreateTable
CREATE TABLE "BookingPolicy" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "cancellationCutoffHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingPolicy_scope_key" ON "BookingPolicy"("scope");

-- CreateIndex
CREATE INDEX "Booking_cancellationEligibleUntilAt_idx" ON "Booking"("cancellationEligibleUntilAt");
