-- CreateEnum
CREATE TYPE "ClientEntitlementStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CreditLedgerEntryType" AS ENUM ('GRANT', 'CONSUME', 'RESTORE', 'EXPIRE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LoyaltyLedgerEntryType" AS ENUM ('EARN', 'REDEEM', 'EXPIRE', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "ClientEntitlement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderId" TEXT,
    "subscriptionContractId" TEXT,
    "entitlementType" "EntitlementType" NOT NULL,
    "entitlementScope" "EntitlementScope" NOT NULL,
    "status" "ClientEntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entryType" "CreditLedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "happenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entitlementId" TEXT,
    "bookingId" TEXT,
    "orderId" TEXT,
    "createdById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyLedgerEntry" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entryType" "LoyaltyLedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "happenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT,
    "createdById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientEntitlement_clientId_status_expiresAt_idx" ON "ClientEntitlement"("clientId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ClientEntitlement_productId_status_idx" ON "ClientEntitlement"("productId", "status");

-- CreateIndex
CREATE INDEX "ClientEntitlement_orderId_idx" ON "ClientEntitlement"("orderId");

-- CreateIndex
CREATE INDEX "ClientEntitlement_subscriptionContractId_idx" ON "ClientEntitlement"("subscriptionContractId");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_clientId_happenedAt_idx" ON "CreditLedgerEntry"("clientId", "happenedAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_clientId_entryType_happenedAt_idx" ON "CreditLedgerEntry"("clientId", "entryType", "happenedAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_entitlementId_idx" ON "CreditLedgerEntry"("entitlementId");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_bookingId_idx" ON "CreditLedgerEntry"("bookingId");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_orderId_idx" ON "CreditLedgerEntry"("orderId");

-- CreateIndex
CREATE INDEX "LoyaltyLedgerEntry_clientId_happenedAt_idx" ON "LoyaltyLedgerEntry"("clientId", "happenedAt");

-- CreateIndex
CREATE INDEX "LoyaltyLedgerEntry_clientId_entryType_happenedAt_idx" ON "LoyaltyLedgerEntry"("clientId", "entryType", "happenedAt");

-- CreateIndex
CREATE INDEX "LoyaltyLedgerEntry_orderId_idx" ON "LoyaltyLedgerEntry"("orderId");

-- AddForeignKey
ALTER TABLE "ClientEntitlement" ADD CONSTRAINT "ClientEntitlement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEntitlement" ADD CONSTRAINT "ClientEntitlement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEntitlement" ADD CONSTRAINT "ClientEntitlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEntitlement" ADD CONSTRAINT "ClientEntitlement_subscriptionContractId_fkey" FOREIGN KEY ("subscriptionContractId") REFERENCES "SubscriptionContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "ClientEntitlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedgerEntry" ADD CONSTRAINT "LoyaltyLedgerEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedgerEntry" ADD CONSTRAINT "LoyaltyLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedgerEntry" ADD CONSTRAINT "LoyaltyLedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
