CREATE TYPE "LoyaltyPointsLedgerEntryType" AS ENUM ('EARN', 'MANUAL_GRANT', 'REVERSAL', 'EXPIRE');

CREATE TABLE "LoyaltyProgram" (
    "id" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "earningPoints" INTEGER NOT NULL,
    "earningAmountMinor" INTEGER NOT NULL,
    "pointsExpireAfterDays" INTEGER NOT NULL,
    "expirationReminderDays" INTEGER,
    "maxManualGrantPoints" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoyaltyEligibleProduct" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyEligibleProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoyaltyPointsLedgerEntry" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entryType" "LoyaltyPointsLedgerEntryType" NOT NULL,
    "amountPoints" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "sourceEntryId" TEXT,
    "createdById" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "happenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyPointsLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoyaltyProgram_currencyCode_key" ON "LoyaltyProgram"("currencyCode");
CREATE INDEX "LoyaltyProgram_isActive_idx" ON "LoyaltyProgram"("isActive");

CREATE UNIQUE INDEX "LoyaltyEligibleProduct_programId_productId_key" ON "LoyaltyEligibleProduct"("programId", "productId");
CREATE INDEX "LoyaltyEligibleProduct_productId_idx" ON "LoyaltyEligibleProduct"("productId");
CREATE INDEX "LoyaltyEligibleProduct_programId_isActive_idx" ON "LoyaltyEligibleProduct"("programId", "isActive");

CREATE UNIQUE INDEX "LoyaltyPointsLedgerEntry_idempotencyKey_key" ON "LoyaltyPointsLedgerEntry"("idempotencyKey");
CREATE INDEX "LoyaltyPointsLedgerEntry_clientId_happenedAt_idx" ON "LoyaltyPointsLedgerEntry"("clientId", "happenedAt");
CREATE INDEX "LoyaltyPointsLedgerEntry_clientId_entryType_happenedAt_idx" ON "LoyaltyPointsLedgerEntry"("clientId", "entryType", "happenedAt");
CREATE INDEX "LoyaltyPointsLedgerEntry_orderId_idx" ON "LoyaltyPointsLedgerEntry"("orderId");
CREATE INDEX "LoyaltyPointsLedgerEntry_paymentId_idx" ON "LoyaltyPointsLedgerEntry"("paymentId");
CREATE INDEX "LoyaltyPointsLedgerEntry_sourceEntryId_idx" ON "LoyaltyPointsLedgerEntry"("sourceEntryId");
CREATE INDEX "LoyaltyPointsLedgerEntry_expiresAt_idx" ON "LoyaltyPointsLedgerEntry"("expiresAt");

ALTER TABLE "LoyaltyEligibleProduct"
ADD CONSTRAINT "LoyaltyEligibleProduct_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoyaltyEligibleProduct"
ADD CONSTRAINT "LoyaltyEligibleProduct_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LoyaltyPointsLedgerEntry"
ADD CONSTRAINT "LoyaltyPointsLedgerEntry_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LoyaltyPointsLedgerEntry"
ADD CONSTRAINT "LoyaltyPointsLedgerEntry_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LoyaltyPointsLedgerEntry"
ADD CONSTRAINT "LoyaltyPointsLedgerEntry_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LoyaltyPointsLedgerEntry"
ADD CONSTRAINT "LoyaltyPointsLedgerEntry_sourceEntryId_fkey"
FOREIGN KEY ("sourceEntryId") REFERENCES "LoyaltyPointsLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LoyaltyPointsLedgerEntry"
ADD CONSTRAINT "LoyaltyPointsLedgerEntry_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LoyaltyProgram"
ADD CONSTRAINT "LoyaltyProgram_positive_settings"
CHECK (
    "earningPoints" > 0
    AND "earningAmountMinor" > 0
    AND "pointsExpireAfterDays" > 0
    AND "maxManualGrantPoints" > 0
);

ALTER TABLE "LoyaltyProgram"
ADD CONSTRAINT "LoyaltyProgram_valid_expiration_reminder"
CHECK (
    "expirationReminderDays" IS NULL
    OR (
        "expirationReminderDays" > 0
        AND "expirationReminderDays" < "pointsExpireAfterDays"
    )
);

ALTER TABLE "LoyaltyPointsLedgerEntry"
ADD CONSTRAINT "LoyaltyPointsLedgerEntry_non_zero_amount"
CHECK ("amountPoints" <> 0);

ALTER TABLE "LoyaltyPointsLedgerEntry"
ADD CONSTRAINT "LoyaltyPointsLedgerEntry_entry_shape"
CHECK (
    (
        "entryType" = 'EARN'
        AND "amountPoints" > 0
        AND "sourceEntryId" IS NULL
        AND "expiresAt" IS NOT NULL
    )
    OR (
        "entryType" = 'MANUAL_GRANT'
        AND "amountPoints" > 0
        AND "sourceEntryId" IS NULL
        AND "expiresAt" IS NOT NULL
        AND "createdById" IS NOT NULL
        AND "reason" IS NOT NULL
        AND length(btrim("reason")) > 0
        AND "metadata" IS NOT NULL
        AND jsonb_typeof("metadata") = 'object'
        AND "metadata" <> '{}'::jsonb
    )
    OR (
        "entryType" = 'REVERSAL'
        AND "amountPoints" < 0
        AND "sourceEntryId" IS NOT NULL
        AND "expiresAt" IS NULL
    )
    OR (
        "entryType" = 'EXPIRE'
        AND "amountPoints" < 0
        AND "sourceEntryId" IS NOT NULL
        AND "expiresAt" IS NULL
    )
);
