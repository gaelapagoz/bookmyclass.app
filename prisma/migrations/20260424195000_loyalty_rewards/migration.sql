-- Loyalty rewards: configurable rule + coupon tracking + idempotent ledger links

CREATE TYPE "LoyaltyCouponStatus" AS ENUM ('GENERATED', 'SENT', 'USED', 'EXPIRED', 'VOIDED');

CREATE TABLE "LoyaltyRewardRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pointsThreshold" INTEGER NOT NULL,
    "couponValueMinor" INTEGER NOT NULL,
    "couponCurrencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyRewardRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoyaltyCoupon" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rewardRuleId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "pointsRedeemed" INTEGER NOT NULL,
    "couponValueMinor" INTEGER NOT NULL,
    "couponCurrencyCode" TEXT NOT NULL,
    "status" "LoyaltyCouponStatus" NOT NULL DEFAULT 'GENERATED',
    "idempotencyKey" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "emailSendAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailLastError" TEXT,
    "usedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT,
    "voidedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyCoupon_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LoyaltyLedgerEntry"
    ADD COLUMN "rewardRuleId" TEXT,
    ADD COLUMN "couponId" TEXT,
    ADD COLUMN "sourceType" TEXT,
    ADD COLUMN "sourceReference" TEXT,
    ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "LoyaltyLedgerEntry_idempotencyKey_key" ON "LoyaltyLedgerEntry"("idempotencyKey");
CREATE INDEX "LoyaltyLedgerEntry_rewardRuleId_idx" ON "LoyaltyLedgerEntry"("rewardRuleId");
CREATE INDEX "LoyaltyLedgerEntry_couponId_idx" ON "LoyaltyLedgerEntry"("couponId");
CREATE INDEX "LoyaltyLedgerEntry_sourceType_sourceReference_idx" ON "LoyaltyLedgerEntry"("sourceType", "sourceReference");

CREATE INDEX "LoyaltyRewardRule_isActive_updatedAt_idx" ON "LoyaltyRewardRule"("isActive", "updatedAt");

CREATE UNIQUE INDEX "LoyaltyCoupon_code_key" ON "LoyaltyCoupon"("code");
CREATE UNIQUE INDEX "LoyaltyCoupon_idempotencyKey_key" ON "LoyaltyCoupon"("idempotencyKey");
CREATE INDEX "LoyaltyCoupon_clientId_status_createdAt_idx" ON "LoyaltyCoupon"("clientId", "status", "createdAt");
CREATE INDEX "LoyaltyCoupon_rewardRuleId_status_createdAt_idx" ON "LoyaltyCoupon"("rewardRuleId", "status", "createdAt");
CREATE INDEX "LoyaltyCoupon_status_createdAt_idx" ON "LoyaltyCoupon"("status", "createdAt");

ALTER TABLE "LoyaltyRewardRule" ADD CONSTRAINT "LoyaltyRewardRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoyaltyRewardRule" ADD CONSTRAINT "LoyaltyRewardRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LoyaltyCoupon" ADD CONSTRAINT "LoyaltyCoupon_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyCoupon" ADD CONSTRAINT "LoyaltyCoupon_rewardRuleId_fkey" FOREIGN KEY ("rewardRuleId") REFERENCES "LoyaltyRewardRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyCoupon" ADD CONSTRAINT "LoyaltyCoupon_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoyaltyCoupon" ADD CONSTRAINT "LoyaltyCoupon_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LoyaltyLedgerEntry" ADD CONSTRAINT "LoyaltyLedgerEntry_rewardRuleId_fkey" FOREIGN KEY ("rewardRuleId") REFERENCES "LoyaltyRewardRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoyaltyLedgerEntry" ADD CONSTRAINT "LoyaltyLedgerEntry_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "LoyaltyCoupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
