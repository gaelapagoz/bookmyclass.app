CREATE TYPE "CouponStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');
CREATE TYPE "CouponRedemptionStatus" AS ENUM ('RESERVED', 'APPLIED', 'REJECTED', 'EXPIRED', 'REVERSED');

ALTER TABLE "Order"
ADD COLUMN "couponId" TEXT,
ADD COLUMN "couponCodeSnapshot" TEXT;

CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "status" "CouponStatus" NOT NULL DEFAULT 'ACTIVE',
    "discountType" "CouponDiscountType" NOT NULL,
    "discountPercentBps" INTEGER,
    "discountAmountMinor" INTEGER,
    "currencyCode" TEXT,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "minOrderAmountMinor" INTEGER,
    "maxTotalRedemptions" INTEGER,
    "maxRedemptionsPerClient" INTEGER,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CouponEligibility" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "productId" TEXT,
    "priceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CouponEligibility_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "status" "CouponRedemptionStatus" NOT NULL,
    "couponCodeSnapshot" TEXT NOT NULL,
    "subtotalBeforeMinor" INTEGER NOT NULL,
    "discountAmountMinor" INTEGER NOT NULL,
    "totalAfterMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "metadata" JSONB,
    "reservedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX "Coupon_status_expiresAt_idx" ON "Coupon"("status", "expiresAt");
CREATE INDEX "Coupon_createdAt_idx" ON "Coupon"("createdAt");

CREATE INDEX "CouponEligibility_couponId_idx" ON "CouponEligibility"("couponId");
CREATE INDEX "CouponEligibility_productId_idx" ON "CouponEligibility"("productId");
CREATE INDEX "CouponEligibility_priceId_idx" ON "CouponEligibility"("priceId");
CREATE UNIQUE INDEX "CouponEligibility_couponId_productId_unique_nonnull"
ON "CouponEligibility"("couponId", "productId") WHERE "productId" IS NOT NULL;
CREATE UNIQUE INDEX "CouponEligibility_couponId_priceId_unique_nonnull"
ON "CouponEligibility"("couponId", "priceId") WHERE "priceId" IS NOT NULL;

CREATE UNIQUE INDEX "CouponRedemption_idempotencyKey_key" ON "CouponRedemption"("idempotencyKey");
CREATE INDEX "CouponRedemption_couponId_status_idx" ON "CouponRedemption"("couponId", "status");
CREATE INDEX "CouponRedemption_clientId_createdAt_idx" ON "CouponRedemption"("clientId", "createdAt");
CREATE INDEX "CouponRedemption_orderId_idx" ON "CouponRedemption"("orderId");
CREATE INDEX "CouponRedemption_paymentId_idx" ON "CouponRedemption"("paymentId");
CREATE INDEX "CouponRedemption_stripeCheckoutSessionId_idx" ON "CouponRedemption"("stripeCheckoutSessionId");
CREATE INDEX "CouponRedemption_status_expiresAt_idx" ON "CouponRedemption"("status", "expiresAt");

CREATE INDEX "Order_couponId_idx" ON "Order"("couponId");

ALTER TABLE "Coupon"
ADD CONSTRAINT "Coupon_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Coupon"
ADD CONSTRAINT "Coupon_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CouponEligibility"
ADD CONSTRAINT "CouponEligibility_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CouponEligibility"
ADD CONSTRAINT "CouponEligibility_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CouponEligibility"
ADD CONSTRAINT "CouponEligibility_priceId_fkey" FOREIGN KEY ("priceId") REFERENCES "Price"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CouponRedemption"
ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouponRedemption"
ADD CONSTRAINT "CouponRedemption_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouponRedemption"
ADD CONSTRAINT "CouponRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CouponRedemption"
ADD CONSTRAINT "CouponRedemption_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order"
ADD CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CouponEligibility"
ADD CONSTRAINT "CouponEligibility_exactly_one_target_check"
CHECK (
  (CASE WHEN "productId" IS NULL THEN 0 ELSE 1 END) +
  (CASE WHEN "priceId" IS NULL THEN 0 ELSE 1 END) = 1
);

ALTER TABLE "Coupon"
ADD CONSTRAINT "Coupon_discount_type_integrity_check"
CHECK (
  (
    "discountType" = 'PERCENTAGE'
    AND "discountPercentBps" IS NOT NULL
    AND "discountPercentBps" > 0
    AND "discountPercentBps" <= 10000
    AND "discountAmountMinor" IS NULL
    AND "currencyCode" IS NULL
  )
  OR
  (
    "discountType" = 'FIXED_AMOUNT'
    AND "discountAmountMinor" IS NOT NULL
    AND "discountAmountMinor" > 0
    AND "currencyCode" IS NOT NULL
    AND length(trim("currencyCode")) > 0
    AND "discountPercentBps" IS NULL
  )
);
