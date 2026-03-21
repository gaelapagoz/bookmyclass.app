-- Phase 2: persist product-catalog Stripe checkout outcomes

CREATE TYPE "StripeCheckoutMode" AS ENUM ('PAYMENT', 'SUBSCRIPTION');

ALTER TABLE "Payment"
ADD COLUMN "stripeCheckoutSessionId" TEXT,
ADD COLUMN "stripeCustomerId" TEXT,
ADD COLUMN "stripeCheckoutMode" "StripeCheckoutMode";

CREATE UNIQUE INDEX "Payment_stripeCheckoutSessionId_key" ON "Payment"("stripeCheckoutSessionId");

CREATE UNIQUE INDEX "SubscriptionContract_provider_providerSubscriptionReference_key"
ON "SubscriptionContract"("provider", "providerSubscriptionReference");