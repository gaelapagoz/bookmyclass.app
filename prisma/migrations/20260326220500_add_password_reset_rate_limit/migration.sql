-- CreateTable
CREATE TABLE "PasswordResetRateLimit" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "lastRequestedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordResetRateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetRateLimit_emailHash_key" ON "PasswordResetRateLimit"("emailHash");

-- CreateIndex
CREATE INDEX "PasswordResetRateLimit_lastRequestedAt_idx" ON "PasswordResetRateLimit"("lastRequestedAt");
