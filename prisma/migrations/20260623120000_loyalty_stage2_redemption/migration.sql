ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'LOYALTY_CREDIT';
ALTER TYPE "LoyaltyPointsLedgerEntryType" ADD VALUE IF NOT EXISTS 'REDEEM';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LoyaltyCreditLedgerEntryType') THEN
    CREATE TYPE "LoyaltyCreditLedgerEntryType" AS ENUM ('REDEEM', 'RESERVE', 'CAPTURE', 'RELEASE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LoyaltyCreditReservationStatus') THEN
    CREATE TYPE "LoyaltyCreditReservationStatus" AS ENUM ('RESERVED', 'CAPTURED', 'RELEASED');
  END IF;
END $$;

CREATE TABLE "LoyaltyRewardDefinition" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "pointsRequired" INTEGER NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyRewardDefinition_pkey" PRIMARY KEY ("id")
);

INSERT INTO "LoyaltyRewardDefinition" (
  "id",
  "programId",
  "name",
  "pointsRequired",
  "amountMinor",
  "isActive"
)
SELECT
  'lrwd_' || substr(md5("id" || ':default-reward'), 1, 24),
  "id",
  "rewardName",
  "rewardPointsRequired",
  "rewardAmountMinor",
  true
FROM "LoyaltyProgram";

ALTER TABLE "LoyaltyProgram" DROP COLUMN "rewardName";
ALTER TABLE "LoyaltyProgram" DROP COLUMN "rewardPointsRequired";
ALTER TABLE "LoyaltyProgram" DROP COLUMN "rewardAmountMinor";

CREATE TABLE "LoyaltyRewardRedemption" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "rewardDefinitionId" TEXT NOT NULL,
  "pointsSpent" INTEGER NOT NULL,
  "creditAmountMinor" INTEGER NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "metadata" JSONB,
  "happenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyRewardRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoyaltyRewardRedemption_idempotencyKey_key" ON "LoyaltyRewardRedemption"("idempotencyKey");
CREATE INDEX "LoyaltyRewardRedemption_clientId_happenedAt_idx" ON "LoyaltyRewardRedemption"("clientId", "happenedAt");
CREATE INDEX "LoyaltyRewardRedemption_programId_idx" ON "LoyaltyRewardRedemption"("programId");
CREATE INDEX "LoyaltyRewardRedemption_rewardDefinitionId_idx" ON "LoyaltyRewardRedemption"("rewardDefinitionId");

CREATE TABLE "LoyaltyCreditReservation" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "status" "LoyaltyCreditReservationStatus" NOT NULL DEFAULT 'RESERVED',
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
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyCreditReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoyaltyCreditReservation_idempotencyKey_key" ON "LoyaltyCreditReservation"("idempotencyKey");
CREATE INDEX "LoyaltyCreditReservation_clientId_createdAt_idx" ON "LoyaltyCreditReservation"("clientId", "createdAt");
CREATE INDEX "LoyaltyCreditReservation_orderId_status_idx" ON "LoyaltyCreditReservation"("orderId", "status");
CREATE INDEX "LoyaltyCreditReservation_status_expiresAt_idx" ON "LoyaltyCreditReservation"("status", "expiresAt");

CREATE TABLE "LoyaltyCreditLedgerEntry" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "entryType" "LoyaltyCreditLedgerEntryType" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "orderId" TEXT,
  "paymentId" TEXT,
  "rewardRedemptionId" TEXT,
  "reservationId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "metadata" JSONB,
  "happenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyCreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoyaltyCreditLedgerEntry_idempotencyKey_key" ON "LoyaltyCreditLedgerEntry"("idempotencyKey");
CREATE INDEX "LoyaltyCreditLedgerEntry_clientId_happenedAt_idx" ON "LoyaltyCreditLedgerEntry"("clientId", "happenedAt");
CREATE INDEX "LoyaltyCreditLedgerEntry_entryType_happenedAt_idx" ON "LoyaltyCreditLedgerEntry"("entryType", "happenedAt");
CREATE INDEX "LoyaltyCreditLedgerEntry_orderId_idx" ON "LoyaltyCreditLedgerEntry"("orderId");
CREATE INDEX "LoyaltyCreditLedgerEntry_paymentId_idx" ON "LoyaltyCreditLedgerEntry"("paymentId");
CREATE INDEX "LoyaltyCreditLedgerEntry_rewardRedemptionId_idx" ON "LoyaltyCreditLedgerEntry"("rewardRedemptionId");
CREATE INDEX "LoyaltyCreditLedgerEntry_reservationId_idx" ON "LoyaltyCreditLedgerEntry"("reservationId");

ALTER TABLE "LoyaltyPointsLedgerEntry" ADD COLUMN "rewardRedemptionId" TEXT;
CREATE INDEX "LoyaltyPointsLedgerEntry_rewardRedemptionId_idx" ON "LoyaltyPointsLedgerEntry"("rewardRedemptionId");

ALTER TABLE "CartCheckoutIdempotency"
  ADD COLUMN "loyaltyCreditReservationId" TEXT,
  ADD COLUMN "loyaltyCreditPaymentId" TEXT;

CREATE INDEX "LoyaltyRewardDefinition_programId_isActive_idx" ON "LoyaltyRewardDefinition"("programId", "isActive");

ALTER TABLE "LoyaltyRewardDefinition"
  ADD CONSTRAINT "LoyaltyRewardDefinition_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoyaltyRewardRedemption"
  ADD CONSTRAINT "LoyaltyRewardRedemption_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LoyaltyRewardRedemption_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LoyaltyRewardRedemption_rewardDefinitionId_fkey"
  FOREIGN KEY ("rewardDefinitionId") REFERENCES "LoyaltyRewardDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LoyaltyCreditReservation"
  ADD CONSTRAINT "LoyaltyCreditReservation_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LoyaltyCreditReservation_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LoyaltyCreditLedgerEntry"
  ADD CONSTRAINT "LoyaltyCreditLedgerEntry_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LoyaltyCreditLedgerEntry_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LoyaltyCreditLedgerEntry_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LoyaltyCreditLedgerEntry_rewardRedemptionId_fkey"
  FOREIGN KEY ("rewardRedemptionId") REFERENCES "LoyaltyRewardRedemption"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LoyaltyCreditLedgerEntry_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "LoyaltyCreditReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LoyaltyPointsLedgerEntry"
  ADD CONSTRAINT "LoyaltyPointsLedgerEntry_rewardRedemptionId_fkey"
  FOREIGN KEY ("rewardRedemptionId") REFERENCES "LoyaltyRewardRedemption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
