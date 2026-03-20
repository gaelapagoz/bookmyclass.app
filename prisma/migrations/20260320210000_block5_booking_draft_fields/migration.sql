CREATE TYPE "BookingIntent" AS ENUM ('SINGLE_BOOKING', 'USE_PLAN');

ALTER TABLE "Booking"
ADD COLUMN "bookingIntent" "BookingIntent" NOT NULL DEFAULT 'SINGLE_BOOKING',
ADD COLUMN "consentTermsAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "consentPrivacyAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "consentAcceptedAt" TIMESTAMP(3);
