-- CreateEnum
CREATE TYPE "MarketingSubscriptionStatus" AS ENUM ('NEVER_SUBSCRIBED', 'SUBSCRIBED', 'UNSUBSCRIBED');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "marketingSubscriptionStatus" "MarketingSubscriptionStatus" NOT NULL DEFAULT 'NEVER_SUBSCRIBED';

-- CreateTable
CREATE TABLE "MarketingSegment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingUserSegment" (
    "userId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingUserSegment_pkey" PRIMARY KEY ("userId","segmentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSegment_slug_key" ON "MarketingSegment"("slug");

-- CreateIndex
CREATE INDEX "MarketingUserSegment_segmentId_idx" ON "MarketingUserSegment"("segmentId");

-- CreateIndex
CREATE INDEX "MarketingUserSegment_userId_idx" ON "MarketingUserSegment"("userId");

-- AddForeignKey
ALTER TABLE "MarketingUserSegment" ADD CONSTRAINT "MarketingUserSegment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingUserSegment" ADD CONSTRAINT "MarketingUserSegment_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "MarketingSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
