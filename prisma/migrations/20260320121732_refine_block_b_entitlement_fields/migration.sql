-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('DROP_IN_CLASS', 'CLASS_PACK', 'UNLIMITED_MEMBERSHIP', 'INTRO_OFFER', 'PRIVATE_CLASS', 'WORKSHOP_PASS', 'GIFT_CARD');

-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('ONE_TIME', 'RECURRING');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "EntitlementType" AS ENUM ('SINGLE_USE', 'CREDIT_PACK', 'UNLIMITED_ACCESS', 'GIFT_VALUE');

-- CreateEnum
CREATE TYPE "EntitlementScope" AS ENUM ('COLLECTIVE_CLASSES', 'PRIVATE_CLASSES', 'WORKSHOPS', 'ALL_CLASSES');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "productType" "ProductType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lookupKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceType" "PriceType" NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "unitAmountMinor" INTEGER NOT NULL,
    "billingInterval" "BillingInterval",
    "billingIntervalCount" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementRule" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "entitlementType" "EntitlementType" NOT NULL,
    "entitlementScope" "EntitlementScope" NOT NULL,
    "quantity" INTEGER,
    "validForDays" INTEGER,
    "giftValueMinor" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntitlementRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_productType_isActive_idx" ON "Product"("productType", "isActive");

-- CreateIndex
CREATE INDEX "Product_sortOrder_idx" ON "Product"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Price_lookupKey_key" ON "Price"("lookupKey");

-- CreateIndex
CREATE INDEX "Price_productId_isActive_idx" ON "Price"("productId", "isActive");

-- CreateIndex
CREATE INDEX "Price_priceType_billingInterval_idx" ON "Price"("priceType", "billingInterval");

-- CreateIndex
CREATE INDEX "Price_startsAt_endsAt_idx" ON "Price"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "EntitlementRule_entitlementType_entitlementScope_idx" ON "EntitlementRule"("entitlementType", "entitlementScope");

-- CreateIndex
CREATE INDEX "EntitlementRule_isActive_idx" ON "EntitlementRule"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementRule_productId_entitlementType_entitlementScope_key" ON "EntitlementRule"("productId", "entitlementType", "entitlementScope");

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementRule" ADD CONSTRAINT "EntitlementRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
