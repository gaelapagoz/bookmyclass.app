-- CreateTable
CREATE TABLE "SiteWeeklyScheduleEntry" (
    "id" TEXT NOT NULL,
    "dayOfWeek" "Weekday" NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteWeeklyScheduleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteWeeklyScheduleEntry_dayOfWeek_displayOrder_startTime_idx" ON "SiteWeeklyScheduleEntry"("dayOfWeek", "displayOrder", "startTime");

-- CreateIndex
CREATE INDEX "SiteWeeklyScheduleEntry_isActive_dayOfWeek_idx" ON "SiteWeeklyScheduleEntry"("isActive", "dayOfWeek");
