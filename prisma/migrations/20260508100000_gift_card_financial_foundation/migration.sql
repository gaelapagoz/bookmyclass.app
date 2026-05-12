ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'MERCHANDISE';
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'GIFT_CARD';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'GIFT_CARD';
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'INTERNAL';

CREATE TYPE "GiftCardWalletStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "GiftCardLedgerEntryType" AS ENUM ('ACTIVATION', 'RESERVE', 'CAPTURE', 'RELEASE');
CREATE TYPE "GiftCardRedemptionStatus" AS ENUM ('RESERVED', 'CAPTURED', 'RELEASED');
CREATE TYPE "GiftCardReconciliationStatus" AS ENUM ('OPEN', 'RETRYING', 'RESOLVED', 'MANUAL_REVIEW');

CREATE TABLE "GiftCardWallet" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "balanceMinor" INTEGER NOT NULL DEFAULT 0,
    "status" "GiftCardWalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCardWallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiftCardLedgerEntry" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entryType" "GiftCardLedgerEntryType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "paymentId" TEXT,
    "redemptionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "metadata" JSONB,
    "happenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCardLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiftCardRedemption" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "GiftCardRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedAmountMinor" INTEGER NOT NULL,
    "capturedAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "releasedAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCardRedemption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiftCardReconciliationCase" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "walletId" TEXT,
    "redemptionId" TEXT,
    "paymentId" TEXT,
    "status" "GiftCardReconciliationStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "payloadHash" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCardReconciliationCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GiftCardWallet_clientId_currencyCode_key" ON "GiftCardWallet"("clientId", "currencyCode");
CREATE INDEX "GiftCardWallet_clientId_idx" ON "GiftCardWallet"("clientId");
CREATE INDEX "GiftCardWallet_status_idx" ON "GiftCardWallet"("status");
CREATE INDEX "GiftCardWallet_clientId_status_idx" ON "GiftCardWallet"("clientId", "status");
CREATE INDEX "GiftCardWallet_currencyCode_idx" ON "GiftCardWallet"("currencyCode");

CREATE UNIQUE INDEX "GiftCardLedgerEntry_idempotencyKey_key" ON "GiftCardLedgerEntry"("idempotencyKey");
CREATE INDEX "GiftCardLedgerEntry_walletId_idx" ON "GiftCardLedgerEntry"("walletId");
CREATE INDEX "GiftCardLedgerEntry_clientId_idx" ON "GiftCardLedgerEntry"("clientId");
CREATE INDEX "GiftCardLedgerEntry_orderId_idx" ON "GiftCardLedgerEntry"("orderId");
CREATE INDEX "GiftCardLedgerEntry_orderItemId_idx" ON "GiftCardLedgerEntry"("orderItemId");
CREATE INDEX "GiftCardLedgerEntry_paymentId_idx" ON "GiftCardLedgerEntry"("paymentId");
CREATE INDEX "GiftCardLedgerEntry_redemptionId_idx" ON "GiftCardLedgerEntry"("redemptionId");
CREATE INDEX "GiftCardLedgerEntry_entryType_idx" ON "GiftCardLedgerEntry"("entryType");
CREATE INDEX "GiftCardLedgerEntry_happenedAt_idx" ON "GiftCardLedgerEntry"("happenedAt");
CREATE INDEX "GiftCardLedgerEntry_createdAt_idx" ON "GiftCardLedgerEntry"("createdAt");
CREATE UNIQUE INDEX "GiftCardLedgerEntry_activation_orderItem_unique" ON "GiftCardLedgerEntry"("orderItemId") WHERE "entryType" = 'ACTIVATION';

CREATE UNIQUE INDEX "GiftCardRedemption_idempotencyKey_key" ON "GiftCardRedemption"("idempotencyKey");
CREATE INDEX "GiftCardRedemption_walletId_idx" ON "GiftCardRedemption"("walletId");
CREATE INDEX "GiftCardRedemption_clientId_idx" ON "GiftCardRedemption"("clientId");
CREATE INDEX "GiftCardRedemption_orderId_idx" ON "GiftCardRedemption"("orderId");
CREATE INDEX "GiftCardRedemption_status_idx" ON "GiftCardRedemption"("status");
CREATE INDEX "GiftCardRedemption_walletId_status_idx" ON "GiftCardRedemption"("walletId", "status");
CREATE INDEX "GiftCardRedemption_orderId_status_idx" ON "GiftCardRedemption"("orderId", "status");
CREATE INDEX "GiftCardRedemption_expiresAt_idx" ON "GiftCardRedemption"("expiresAt");
CREATE INDEX "GiftCardRedemption_createdAt_idx" ON "GiftCardRedemption"("createdAt");
CREATE UNIQUE INDEX "GiftCardRedemption_one_reserved_per_order" ON "GiftCardRedemption"("orderId") WHERE "status" = 'RESERVED';

CREATE UNIQUE INDEX "GiftCardReconciliationCase_idempotencyKey_key" ON "GiftCardReconciliationCase"("idempotencyKey");
CREATE INDEX "GiftCardReconciliationCase_status_idx" ON "GiftCardReconciliationCase"("status");
CREATE INDEX "GiftCardReconciliationCase_orderId_idx" ON "GiftCardReconciliationCase"("orderId");
CREATE INDEX "GiftCardReconciliationCase_clientId_idx" ON "GiftCardReconciliationCase"("clientId");
CREATE INDEX "GiftCardReconciliationCase_redemptionId_idx" ON "GiftCardReconciliationCase"("redemptionId");
CREATE INDEX "GiftCardReconciliationCase_paymentId_idx" ON "GiftCardReconciliationCase"("paymentId");
CREATE INDEX "GiftCardReconciliationCase_createdAt_idx" ON "GiftCardReconciliationCase"("createdAt");
CREATE INDEX "GiftCardReconciliationCase_updatedAt_idx" ON "GiftCardReconciliationCase"("updatedAt");

ALTER TABLE "GiftCardWallet" ADD CONSTRAINT "GiftCardWallet_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCardLedgerEntry" ADD CONSTRAINT "GiftCardLedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "GiftCardWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCardLedgerEntry" ADD CONSTRAINT "GiftCardLedgerEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCardLedgerEntry" ADD CONSTRAINT "GiftCardLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GiftCardLedgerEntry" ADD CONSTRAINT "GiftCardLedgerEntry_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GiftCardLedgerEntry" ADD CONSTRAINT "GiftCardLedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GiftCardLedgerEntry" ADD CONSTRAINT "GiftCardLedgerEntry_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "GiftCardRedemption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GiftCardRedemption" ADD CONSTRAINT "GiftCardRedemption_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "GiftCardWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCardRedemption" ADD CONSTRAINT "GiftCardRedemption_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCardRedemption" ADD CONSTRAINT "GiftCardRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCardReconciliationCase" ADD CONSTRAINT "GiftCardReconciliationCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCardReconciliationCase" ADD CONSTRAINT "GiftCardReconciliationCase_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCardReconciliationCase" ADD CONSTRAINT "GiftCardReconciliationCase_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "GiftCardWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GiftCardReconciliationCase" ADD CONSTRAINT "GiftCardReconciliationCase_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "GiftCardRedemption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GiftCardReconciliationCase" ADD CONSTRAINT "GiftCardReconciliationCase_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GiftCardReconciliationCase" ADD CONSTRAINT "GiftCardReconciliationCase_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
