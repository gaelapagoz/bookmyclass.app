-- Add serviceScope to ClassType for explicit entitlement scope without slug-based fallback
ALTER TABLE "ClassType" ADD COLUMN "serviceScope" "EntitlementScope";

-- Backfill from the parent category slug using the same rules as
-- resolveEntitlementScopeFromCategorySlug() in src/lib/booking/entitlement-scope.ts
UPDATE "ClassType" ct
SET "serviceScope" = CASE
  WHEN lower(cc.slug) LIKE '%private%' THEN 'PRIVATE_CLASSES'::"EntitlementScope"
  WHEN lower(cc.slug) LIKE '%workshop%' THEN 'WORKSHOPS'::"EntitlementScope"
  ELSE 'COLLECTIVE_CLASSES'::"EntitlementScope"
END
FROM "ClassCategory" cc
WHERE cc.id = ct."categoryId";

-- Add RateLimitCounter table for DB-backed rate limiting (booking draft, etc.)
CREATE TABLE "RateLimitCounter" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RateLimitCounter_keyHash_key" ON "RateLimitCounter"("keyHash");
CREATE INDEX "RateLimitCounter_windowStartedAt_idx" ON "RateLimitCounter"("windowStartedAt");
