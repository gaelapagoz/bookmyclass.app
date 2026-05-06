-- Phase 3.1: AuditLog.metadata already exists, so no audit metadata migration is required.
-- Rollback safety: do not drop AuditLog.metadata if override audit rows exist.

-- Phase 3.2: Prisma cannot fully represent this PostgreSQL partial unique index.
-- The active booking uniqueness index is migration-owned; do not reintroduce
-- broad @@unique([clientId, studioSessionId]) in prisma/schema.prisma.
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

DROP INDEX IF EXISTS "Booking_clientId_studioSessionId_key";

CREATE UNIQUE INDEX "Booking_active_client_session_unique"
ON "Booking" ("clientId", "studioSessionId")
WHERE "status" IN ('PENDING', 'CONFIRMED');
