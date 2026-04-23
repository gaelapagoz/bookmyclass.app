-- Phase 1 completion: immutable catalog fields after first activation (Stripe link) or first successful purchase.

CREATE TABLE IF NOT EXISTS "PriceStripeIdRemediationRequest" (
  "id" BIGSERIAL PRIMARY KEY,
  "priceId" TEXT NOT NULL,
  "fromStripePriceId" TEXT,
  "toStripePriceId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "PriceStripeIdRemediationRequest_price_fkey"
    FOREIGN KEY ("priceId") REFERENCES "Price"("id") ON DELETE CASCADE,
  CONSTRAINT "PriceStripeIdRemediationRequest_actor_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "PriceStripeIdRemediationRequest_priceId_consumedAt_idx"
  ON "PriceStripeIdRemediationRequest"("priceId", "consumedAt");

CREATE OR REPLACE FUNCTION "enforce_price_immutable_fields"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  has_successful_purchase BOOLEAN;
  is_activated BOOLEAN;
  has_authorized_remediation BOOLEAN;
  is_initial_activation BOOLEAN;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId"
    JOIN "Payment" p ON p."orderId" = o."id"
    WHERE oi."priceId" = OLD."id"
      AND p."status" = 'SUCCEEDED'
  )
  INTO has_successful_purchase;

  is_activated := OLD."stripePriceId" IS NOT NULL OR NEW."stripePriceId" IS NOT NULL;
  is_initial_activation := OLD."stripePriceId" IS NULL AND NEW."stripePriceId" IS NOT NULL AND NOT has_successful_purchase;

  IF (is_activated OR has_successful_purchase) THEN
    IF NEW."priceType" IS DISTINCT FROM OLD."priceType"
      OR NEW."unitAmountMinor" IS DISTINCT FROM OLD."unitAmountMinor"
      OR NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode"
      OR NEW."billingInterval" IS DISTINCT FROM OLD."billingInterval"
      OR NEW."billingIntervalCount" IS DISTINCT FROM OLD."billingIntervalCount"
      OR NEW."productId" IS DISTINCT FROM OLD."productId"
    THEN
      RAISE EXCEPTION 'Price immutable fields cannot change after activation/purchase for price %', OLD."id";
    END IF;
  END IF;

  IF NEW."stripePriceId" IS DISTINCT FROM OLD."stripePriceId" THEN
    IF is_initial_activation THEN
      RETURN NEW;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM "PriceStripeIdRemediationRequest" r
      JOIN "User" u ON u."id" = r."actorId"
      WHERE r."priceId" = OLD."id"
        AND r."fromStripePriceId" IS NOT DISTINCT FROM OLD."stripePriceId"
        AND r."toStripePriceId" = NEW."stripePriceId"
        AND r."consumedAt" IS NULL
        AND u."role" IN ('ADMIN', 'MASTER_ADMIN')
    )
    INTO has_authorized_remediation;

    IF NOT has_authorized_remediation THEN
      RAISE EXCEPTION 'stripePriceId is immutable after activation/purchase for price %', OLD."id";
    END IF;

    UPDATE "PriceStripeIdRemediationRequest"
    SET "consumedAt" = NOW()
    WHERE "priceId" = OLD."id"
      AND "fromStripePriceId" IS NOT DISTINCT FROM OLD."stripePriceId"
      AND "toStripePriceId" = NEW."stripePriceId"
      AND "consumedAt" IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'stripePriceId remediation token already consumed or missing for price %', OLD."id";
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION remediate_price_stripe_id(
  p_price_id TEXT,
  p_new_stripe_price_id TEXT,
  p_actor_id TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price RECORD;
  v_actor_role TEXT;
  v_request_id BIGINT;
  v_correlation TEXT;
BEGIN
  SELECT "id", "stripePriceId"
  INTO v_price
  FROM "Price"
  WHERE "id" = p_price_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRICE_NOT_FOUND';
  END IF;

  SELECT "role"
  INTO v_actor_role
  FROM "User"
  WHERE "id" = p_actor_id;

  IF v_actor_role IS NULL OR v_actor_role NOT IN ('ADMIN', 'MASTER_ADMIN') THEN
    RAISE EXCEPTION 'ADMIN_ROLE_REQUIRED';
  END IF;

  IF p_new_stripe_price_id IS NULL OR LENGTH(TRIM(p_new_stripe_price_id)) = 0 THEN
    RAISE EXCEPTION 'INVALID_STRIPE_PRICE_ID';
  END IF;

  IF v_price."stripePriceId" IS NOT DISTINCT FROM p_new_stripe_price_id THEN
    RAISE EXCEPTION 'STRIPE_PRICE_ID_UNCHANGED';
  END IF;

  INSERT INTO "PriceStripeIdRemediationRequest"(
    "priceId",
    "fromStripePriceId",
    "toStripePriceId",
    "actorId",
    "reason"
  )
  VALUES (
    p_price_id,
    v_price."stripePriceId",
    p_new_stripe_price_id,
    p_actor_id,
    NULLIF(TRIM(COALESCE(p_reason, '')), '')
  )
  RETURNING "id" INTO v_request_id;

  v_correlation := CONCAT('remediation-', v_request_id);

  UPDATE "Price"
  SET
    "stripePriceId" = p_new_stripe_price_id,
    "stripeSyncStatus" = 'SYNCED',
    "stripeSyncLastAttempt" = NOW(),
    "stripeSyncLastSuccess" = NOW(),
    "stripeSyncErrorCode" = NULL,
    "stripeSyncError" = NULL,
    "stripeSyncCorrelation" = v_correlation
  WHERE "id" = p_price_id;

  INSERT INTO "AuditLog"(
    "id",
    "actorId",
    "actionType",
    "entityType",
    "entityId",
    "metadata"
  )
  VALUES (
    CONCAT('audit_', md5(random()::text || clock_timestamp()::text)),
    p_actor_id,
    'CATALOG_PRICE_STRIPE_REMEDIATION',
    'Price',
    p_price_id,
    jsonb_build_object(
      'oldStripePriceId', v_price."stripePriceId",
      'newStripePriceId', p_new_stripe_price_id,
      'reason', NULLIF(TRIM(COALESCE(p_reason, '')), ''),
      'remediationRequestId', v_request_id,
      'ownershipScopeKey', 'GLOBAL_CATALOG'
    )
  );
END;
$$;

DROP TRIGGER IF EXISTS "Price_enforce_immutable_fields_trg" ON "Price";

CREATE TRIGGER "Price_enforce_immutable_fields_trg"
BEFORE UPDATE ON "Price"
FOR EACH ROW
EXECUTE FUNCTION "enforce_price_immutable_fields"();
