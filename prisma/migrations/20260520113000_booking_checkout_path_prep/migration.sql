CREATE TYPE "BookingCheckoutPath" AS ENUM ('LEGACY_BOOKING', 'CANONICAL_CART');

ALTER TABLE "Booking"
ADD COLUMN "checkoutPath" "BookingCheckoutPath";
