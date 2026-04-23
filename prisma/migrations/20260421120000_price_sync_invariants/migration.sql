-- Phase 1: price sync metadata + catalog invariants

CREATE TYPE "StripeSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

ALTER TABLE "Price"
ADD COLUMN "stripeSyncStatus" "StripeSyncStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "stripeSyncLastAttempt" TIMESTAMP(3),
ADD COLUMN "stripeSyncLastSuccess" TIMESTAMP(3),
ADD COLUMN "stripeSyncErrorCode" TEXT,
ADD COLUMN "stripeSyncError" TEXT,
ADD COLUMN "stripeSyncCorrelation" TEXT;

UPDATE "Price"
SET
  "stripeSyncStatus" = CASE
    WHEN "stripePriceId" IS NOT NULL THEN 'SYNCED'::"StripeSyncStatus"
    ELSE 'PENDING'::"StripeSyncStatus"
  END,
  "stripeSyncLastSuccess" = CASE
    WHEN "stripePriceId" IS NOT NULL THEN "updatedAt"
    ELSE NULL
  END;

DO $$
DECLARE
  invalid_currency_count INTEGER;
  invalid_billing_shape_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO invalid_currency_count
  FROM "Price"
  WHERE "currencyCode" !~ '^[A-Z]{3}$';

  IF invalid_currency_count > 0 THEN
    RAISE EXCEPTION
      'Price migration blocked: found % row(s) with invalid currencyCode format before Price_currencyCode_uppercase_3_chk.',
      invalid_currency_count;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO invalid_billing_shape_count
  FROM "Price"
  WHERE NOT (
    (
      "priceType" = 'RECURRING'
      AND "billingInterval" IS NOT NULL
      AND COALESCE("billingIntervalCount", 0) > 0
    )
    OR (
      "priceType" = 'ONE_TIME'
      AND "billingInterval" IS NULL
      AND "billingIntervalCount" IS NULL
    )
  );

  IF invalid_billing_shape_count > 0 THEN
    RAISE EXCEPTION
      'Price migration blocked: found % row(s) with invalid priceType/billingInterval/billingIntervalCount shape before Price_billing_shape_chk.',
      invalid_billing_shape_count;
  END IF;
END $$;

ALTER TABLE "Price"
ADD CONSTRAINT "Price_unitAmountMinor_positive_chk"
CHECK ("unitAmountMinor" > 0);

ALTER TABLE "Price"
ADD CONSTRAINT "Price_currencyCode_uppercase_3_chk"
CHECK ("currencyCode" ~ '^[A-Z]{3}$');

ALTER TABLE "Price"
ADD CONSTRAINT "Price_startsAt_before_endsAt_chk"
CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" <= "endsAt");

ALTER TABLE "Price"
ADD CONSTRAINT "Price_billing_shape_chk"
CHECK (
  (
    "priceType" = 'RECURRING'
    AND "billingInterval" IS NOT NULL
    AND COALESCE("billingIntervalCount", 0) > 0
  )
  OR (
    "priceType" = 'ONE_TIME'
    AND "billingInterval" IS NULL
    AND "billingIntervalCount" IS NULL
  )
);

CREATE INDEX "Price_stripeSyncStatus_idx" ON "Price"("stripeSyncStatus");

DO $$
DECLARE
  conflict_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO conflict_count
  FROM (
    SELECT "productId"
    FROM "Price"
    WHERE "isActive" = true AND "isArchived" = false
    GROUP BY "productId"
    HAVING COUNT(*) > 1
  ) conflicts;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION
      'Price migration blocked: found % product(s) with multiple active non-archived prices. Resolve conflicts before applying unique index Price_productId_single_active_unarchived_idx.',
      conflict_count;
  END IF;
END $$;

CREATE UNIQUE INDEX "Price_productId_single_active_unarchived_idx"
ON "Price"("productId")
WHERE "isActive" = true AND "isArchived" = false;
