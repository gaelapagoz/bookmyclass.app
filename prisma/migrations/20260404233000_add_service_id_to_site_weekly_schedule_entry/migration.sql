-- AlterTable
ALTER TABLE "SiteWeeklyScheduleEntry" ADD COLUMN "serviceId" TEXT;

-- CreateIndex
CREATE INDEX "SiteWeeklyScheduleEntry_serviceId_idx" ON "SiteWeeklyScheduleEntry"("serviceId");
