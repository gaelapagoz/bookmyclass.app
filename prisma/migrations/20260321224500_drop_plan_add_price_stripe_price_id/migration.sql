-- AlterTable
ALTER TABLE "Price"
ADD COLUMN "stripePriceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Price_stripePriceId_key" ON "Price"("stripePriceId");

-- DropTable
DROP TABLE "Plan";
