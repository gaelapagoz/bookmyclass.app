-- Phase 8: dedicated site settings for timezone configuration.
-- StudioSession startsAt/endsAt remain UTC instants; labels/date keys use this timezone.
CREATE TABLE "SiteSettings" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Brussels',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteSettings_scope_key" ON "SiteSettings"("scope");
