-- Replace enforce_price_immutable_fields to use a session-level GUC bypass
-- instead of the PriceStripeIdRemediationRequest table (dropped in gift_card_code migration).
-- Drop the remediate_price_stripe_id function that referenced the dropped table.

CREATE OR REPLACE FUNCTION "enforce_price_immutable_fields"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  has_successful_purchase BOOLEAN;
  is_activated BOOLEAN;
  is_initial_activation BOOLEAN;
  skip_immutability BOOLEAN;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  skip_immutability := current_setting('catalog.skip_stripe_id_immutability', TRUE) = 'on';

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
    IF is_initial_activation OR skip_immutability THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'stripePriceId is immutable after activation/purchase for price %', OLD."id";
  END IF;

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS remediate_price_stripe_id(TEXT, TEXT, TEXT, TEXT);
