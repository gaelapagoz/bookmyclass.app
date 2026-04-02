-- CreateEnum
CREATE TYPE "AdminLoginAbuseKeyType" AS ENUM ('IP', 'EMAIL', 'IP_EMAIL');

-- CreateTable
CREATE TABLE "AdminLoginAbuseCounter" (
    "id" TEXT NOT NULL,
    "keyType" "AdminLoginAbuseKeyType" NOT NULL,
    "keyHash" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "firstFailedAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "captchaRequiredUntil" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminLoginAbuseCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminLoginAbuseCounter_keyType_keyHash_key" ON "AdminLoginAbuseCounter"("keyType", "keyHash");

-- CreateIndex
CREATE INDEX "AdminLoginAbuseCounter_lockedUntil_idx" ON "AdminLoginAbuseCounter"("lockedUntil");

-- CreateIndex
CREATE INDEX "AdminLoginAbuseCounter_captchaRequiredUntil_idx" ON "AdminLoginAbuseCounter"("captchaRequiredUntil");

-- CreateIndex
CREATE INDEX "AdminLoginAbuseCounter_lastFailedAt_idx" ON "AdminLoginAbuseCounter"("lastFailedAt");
