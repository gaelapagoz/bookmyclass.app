CREATE TYPE "UserCreatedVia" AS ENUM ('PUBLIC_SIGNUP', 'ADMIN', 'BOOKING_FLOW', 'SUBSCRIPTION_FLOW', 'OAUTH', 'IMPORT');
CREATE TYPE "UserActivationStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

ALTER TABLE "User"
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "createdVia" "UserCreatedVia" NOT NULL DEFAULT 'IMPORT',
ADD COLUMN "createdByUserId" TEXT,
ADD COLUMN "createdIp" TEXT,
ADD COLUMN "activationStatus" "UserActivationStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "lastEmailChangeAt" TIMESTAMP(3),
ADD COLUMN "pendingEmail" TEXT,
ADD COLUMN "pendingEmailTokenHash" TEXT,
ADD COLUMN "pendingEmailTokenExpiresAt" TIMESTAMP(3);

UPDATE "User"
SET "emailVerifiedAt" = "emailVerified"
WHERE "emailVerified" IS NOT NULL;

CREATE UNIQUE INDEX "User_pendingEmailTokenHash_key" ON "User"("pendingEmailTokenHash");
CREATE INDEX "User_activationStatus_idx" ON "User"("activationStatus");
CREATE INDEX "User_createdVia_createdAt_idx" ON "User"("createdVia", "createdAt");
CREATE INDEX "User_createdByUserId_createdAt_idx" ON "User"("createdByUserId", "createdAt");
CREATE INDEX "User_pendingEmail_pendingEmailTokenExpiresAt_idx" ON "User"("pendingEmail", "pendingEmailTokenExpiresAt");

ALTER TABLE "User"
ADD CONSTRAINT "User_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PendingUserRegistration" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CLIENT',
    "createdVia" "UserCreatedVia" NOT NULL DEFAULT 'PUBLIC_SIGNUP',
    "createdIp" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingUserRegistration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingUserRegistration_email_key" ON "PendingUserRegistration"("email");
CREATE UNIQUE INDEX "PendingUserRegistration_tokenHash_key" ON "PendingUserRegistration"("tokenHash");
CREATE INDEX "PendingUserRegistration_email_tokenExpiresAt_idx" ON "PendingUserRegistration"("email", "tokenExpiresAt");

ALTER TABLE "PendingUserRegistration"
ADD CONSTRAINT "PendingUserRegistration_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PublicAuthRateLimit" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastRequestedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicAuthRateLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicAuthRateLimit_keyHash_key" ON "PublicAuthRateLimit"("keyHash");
CREATE INDEX "PublicAuthRateLimit_lastRequestedAt_idx" ON "PublicAuthRateLimit"("lastRequestedAt");
