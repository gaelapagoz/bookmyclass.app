-- CreateEnum
CREATE TYPE "EmailAutomationEventStatus" AS ENUM ('PENDING', 'LEASED', 'SENT', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "EmailAutomationAttemptStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailTemplateAuditAction" AS ENUM ('CREATED', 'UPDATED', 'ACTIVATED', 'DEACTIVATED');

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "contentSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "subjectTemplate" TEXT NOT NULL,
    "bodyTemplateJson" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAutomationEvent" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "EmailAutomationEventStatus" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leasedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "sentAt" TIMESTAMP(3),
    "deadLetteredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAutomationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAutomationAttempt" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "EmailAutomationAttemptStatus" NOT NULL,
    "leaseOwner" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAutomationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDispatcherHeartbeat" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
    "activeLeaseCount" INTEGER NOT NULL DEFAULT 0,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDispatcherHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplateAuditLog" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "action" "EmailTemplateAuditAction" NOT NULL,
    "actorId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailTemplateAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_templateKey_key" ON "EmailTemplate"("templateKey");

-- CreateIndex
CREATE INDEX "EmailTemplate_category_isActive_idx" ON "EmailTemplate"("category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAutomationEvent_idempotencyKey_key" ON "EmailAutomationEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailAutomationEvent_status_availableAt_idx" ON "EmailAutomationEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "EmailAutomationEvent_templateId_createdAt_idx" ON "EmailAutomationEvent"("templateId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailAutomationEvent_recipientEmail_createdAt_idx" ON "EmailAutomationEvent"("recipientEmail", "createdAt");

-- CreateIndex
CREATE INDEX "EmailAutomationEvent_leaseExpiresAt_idx" ON "EmailAutomationEvent"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "EmailAutomationAttempt_eventId_createdAt_idx" ON "EmailAutomationAttempt"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailAutomationAttempt_status_createdAt_idx" ON "EmailAutomationAttempt"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDispatcherHeartbeat_workerId_key" ON "EmailDispatcherHeartbeat"("workerId");

-- CreateIndex
CREATE INDEX "EmailDispatcherHeartbeat_lastHeartbeatAt_idx" ON "EmailDispatcherHeartbeat"("lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "EmailTemplateAuditLog_templateId_createdAt_idx" ON "EmailTemplateAuditLog"("templateId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailTemplateAuditLog_actorId_createdAt_idx" ON "EmailTemplateAuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailTemplateAuditLog_action_createdAt_idx" ON "EmailTemplateAuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomationEvent" ADD CONSTRAINT "EmailAutomationEvent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomationAttempt" ADD CONSTRAINT "EmailAutomationAttempt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "EmailAutomationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplateAuditLog" ADD CONSTRAINT "EmailTemplateAuditLog_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplateAuditLog" ADD CONSTRAINT "EmailTemplateAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
