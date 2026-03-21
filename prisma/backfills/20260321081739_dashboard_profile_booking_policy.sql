-- Backfill for migration: 20260321081739_dashboard_profile_booking_policy
-- Safe to run multiple times.

BEGIN;

-- 1) Ensure one default GLOBAL booking policy row exists.
INSERT INTO "BookingPolicy" (
  "id",
  "scope",
  "cancellationCutoffHours",
  "createdAt",
  "updatedAt"
)
VALUES (
  'global-policy',
  'GLOBAL',
  24,
  NOW(),
  NOW()
)
ON CONFLICT ("scope") DO NOTHING;

-- 2) Best-effort split of User.name into firstName and lastName
UPDATE "User"
SET
  "firstName" = CASE
    WHEN "firstName" IS NULL OR BTRIM("firstName") = ''
      THEN NULLIF(SPLIT_PART(BTRIM("name"), ' ', 1), '')
    ELSE "firstName"
  END,
  "lastName" = CASE
    WHEN "lastName" IS NULL OR BTRIM("lastName") = ''
      THEN NULLIF(BTRIM(REGEXP_REPLACE(BTRIM("name"), '^\\S+\\s*', '')), '')
    ELSE "lastName"
  END,
  "updatedAt" = NOW()
WHERE "name" IS NOT NULL
  AND BTRIM("name") <> '';

-- 3) Backfill cancellationEligibleUntilAt for future bookings
UPDATE "Booking" b
SET
  "cancellationEligibleUntilAt" = s."startsAt" - (p."cancellationCutoffHours" || ' hours')::INTERVAL,
  "updatedAt" = NOW()
FROM "StudioSession" s
JOIN "BookingPolicy" p ON p."scope" = 'GLOBAL'
WHERE b."studioSessionId" = s."id"
  AND b."cancellationEligibleUntilAt" IS NULL
  AND s."startsAt" > NOW();

COMMIT;
