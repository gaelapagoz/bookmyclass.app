-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "StudioSessionStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "ClassCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassType" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "defaultDurationMinutes" INTEGER NOT NULL,
    "defaultCapacity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassTemplate" (
    "id" TEXT NOT NULL,
    "classTypeId" TEXT NOT NULL,
    "defaultTeacherId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "defaultCapacity" INTEGER NOT NULL,
    "defaultDurationMinutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringRule" (
    "id" TEXT NOT NULL,
    "classTemplateId" TEXT NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "startTime" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioSession" (
    "id" TEXT NOT NULL,
    "classTemplateId" TEXT NOT NULL,
    "recurringRuleId" TEXT,
    "classTypeId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "StudioSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "cancelledById" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassCategory_slug_key" ON "ClassCategory"("slug");

-- CreateIndex
CREATE INDEX "ClassCategory_isActive_sortOrder_idx" ON "ClassCategory"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ClassType_slug_key" ON "ClassType"("slug");

-- CreateIndex
CREATE INDEX "ClassType_categoryId_isActive_sortOrder_idx" ON "ClassType"("categoryId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ClassTemplate_slug_key" ON "ClassTemplate"("slug");

-- CreateIndex
CREATE INDEX "ClassTemplate_classTypeId_isActive_isPublished_idx" ON "ClassTemplate"("classTypeId", "isActive", "isPublished");

-- CreateIndex
CREATE INDEX "ClassTemplate_defaultTeacherId_idx" ON "ClassTemplate"("defaultTeacherId");

-- CreateIndex
CREATE INDEX "RecurringRule_classTemplateId_isActive_idx" ON "RecurringRule"("classTemplateId", "isActive");

-- CreateIndex
CREATE INDEX "RecurringRule_weekday_startDate_endDate_idx" ON "RecurringRule"("weekday", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringRule_classTemplateId_weekday_startTime_startDate_key" ON "RecurringRule"("classTemplateId", "weekday", "startTime", "startDate");

-- CreateIndex
CREATE INDEX "StudioSession_startsAt_status_isPublished_idx" ON "StudioSession"("startsAt", "status", "isPublished");

-- CreateIndex
CREATE INDEX "StudioSession_teacherId_startsAt_idx" ON "StudioSession"("teacherId", "startsAt");

-- CreateIndex
CREATE INDEX "StudioSession_classTypeId_startsAt_idx" ON "StudioSession"("classTypeId", "startsAt");

-- CreateIndex
CREATE INDEX "StudioSession_classTemplateId_startsAt_idx" ON "StudioSession"("classTemplateId", "startsAt");

-- CreateIndex
CREATE INDEX "StudioSession_recurringRuleId_startsAt_idx" ON "StudioSession"("recurringRuleId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudioSession_classTemplateId_startsAt_key" ON "StudioSession"("classTemplateId", "startsAt");

-- AddForeignKey
ALTER TABLE "ClassType" ADD CONSTRAINT "ClassType_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ClassCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTemplate" ADD CONSTRAINT "ClassTemplate_classTypeId_fkey" FOREIGN KEY ("classTypeId") REFERENCES "ClassType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTemplate" ADD CONSTRAINT "ClassTemplate_defaultTeacherId_fkey" FOREIGN KEY ("defaultTeacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_classTemplateId_fkey" FOREIGN KEY ("classTemplateId") REFERENCES "ClassTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioSession" ADD CONSTRAINT "StudioSession_classTemplateId_fkey" FOREIGN KEY ("classTemplateId") REFERENCES "ClassTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioSession" ADD CONSTRAINT "StudioSession_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "RecurringRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioSession" ADD CONSTRAINT "StudioSession_classTypeId_fkey" FOREIGN KEY ("classTypeId") REFERENCES "ClassType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioSession" ADD CONSTRAINT "StudioSession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioSession" ADD CONSTRAINT "StudioSession_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
