CREATE TYPE "ClientMessageContactStatus" AS ENUM ('INBOX', 'SPAM');

ALTER TABLE "ClientMessage"
ADD COLUMN "contactStatus" "ClientMessageContactStatus" NOT NULL DEFAULT 'INBOX',
ADD COLUMN "spamReason" TEXT;

CREATE INDEX "ClientMessage_type_contactStatus_createdAt_idx"
ON "ClientMessage"("type", "contactStatus", "createdAt");

CREATE TABLE "ContactMessageRateLimit" (
    "id" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactMessageRateLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactMessageRateLimit_ipHash_key" ON "ContactMessageRateLimit"("ipHash");
CREATE INDEX "ContactMessageRateLimit_windowStartedAt_idx" ON "ContactMessageRateLimit"("windowStartedAt");
