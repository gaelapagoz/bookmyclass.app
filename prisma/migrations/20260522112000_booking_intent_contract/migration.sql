CREATE TYPE "BookingIntent_new" AS ENUM ('SINGLE_BOOKING', 'USE_ENTITLEMENT');

ALTER TABLE "Booking"
ALTER COLUMN "bookingIntent" DROP DEFAULT;

ALTER TABLE "Booking"
ALTER COLUMN "bookingIntent" TYPE "BookingIntent_new"
USING ("bookingIntent"::text::"BookingIntent_new");

ALTER TABLE "Booking"
ALTER COLUMN "bookingIntent" SET DEFAULT 'SINGLE_BOOKING';

DROP TYPE "BookingIntent";
ALTER TYPE "BookingIntent_new" RENAME TO "BookingIntent";
