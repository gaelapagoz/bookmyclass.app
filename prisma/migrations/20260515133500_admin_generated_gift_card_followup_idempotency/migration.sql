-- AlterTable
ALTER TABLE "GiftCardCode" ADD COLUMN "adminIdempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardCode_adminIdempotencyKey_key" ON "GiftCardCode"("adminIdempotencyKey");
