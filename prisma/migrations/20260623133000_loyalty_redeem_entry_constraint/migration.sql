ALTER TABLE "LoyaltyPointsLedgerEntry"
DROP CONSTRAINT "LoyaltyPointsLedgerEntry_entry_shape";

ALTER TABLE "LoyaltyPointsLedgerEntry"
ADD CONSTRAINT "LoyaltyPointsLedgerEntry_entry_shape"
CHECK (
    (
        "entryType" = 'EARN'
        AND "amountPoints" > 0
        AND "sourceEntryId" IS NULL
        AND "rewardRedemptionId" IS NULL
        AND "expiresAt" IS NOT NULL
    )
    OR (
        "entryType" = 'MANUAL_GRANT'
        AND "amountPoints" > 0
        AND "sourceEntryId" IS NULL
        AND "rewardRedemptionId" IS NULL
        AND "expiresAt" IS NOT NULL
        AND "createdById" IS NOT NULL
        AND "reason" IS NOT NULL
        AND length(btrim("reason")) > 0
        AND "metadata" IS NOT NULL
        AND jsonb_typeof("metadata") = 'object'
        AND "metadata" <> '{}'::jsonb
    )
    OR (
        "entryType" = 'REDEEM'
        AND "amountPoints" < 0
        AND "sourceEntryId" IS NOT NULL
        AND "rewardRedemptionId" IS NOT NULL
        AND "expiresAt" IS NULL
    )
    OR (
        "entryType" = 'REVERSAL'
        AND "amountPoints" < 0
        AND "sourceEntryId" IS NOT NULL
        AND "rewardRedemptionId" IS NULL
        AND "expiresAt" IS NULL
    )
    OR (
        "entryType" = 'EXPIRE'
        AND "amountPoints" < 0
        AND "sourceEntryId" IS NOT NULL
        AND "rewardRedemptionId" IS NULL
        AND "expiresAt" IS NULL
    )
);
