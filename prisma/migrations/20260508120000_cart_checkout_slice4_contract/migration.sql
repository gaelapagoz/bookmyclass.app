CREATE TYPE "CartCheckoutResponseType" AS ENUM ('COMPLETED', 'STRIPE_REDIRECT');

ALTER TABLE "CartCheckoutIdempotency"
  ADD COLUMN "redemptionId"      TEXT,
  ADD COLUMN "giftCardPaymentId" TEXT,
  ADD COLUMN "stripePaymentId"   TEXT,
  ADD COLUMN "checkoutSessionId" TEXT,
  ADD COLUMN "responseType"      "CartCheckoutResponseType";
