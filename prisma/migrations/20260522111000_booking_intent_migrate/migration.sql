UPDATE "Booking"
SET "bookingIntent" = 'USE_ENTITLEMENT'
WHERE "bookingIntent" = 'USE_PLAN';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Booking" WHERE "bookingIntent" = 'USE_PLAN'
  ) THEN
    RAISE EXCEPTION 'BookingIntent migration incomplete: USE_PLAN rows remain';
  END IF;
END $$;
