-- CreateEnum
CREATE TYPE "ClientMessageType" AS ENUM ('CONTACT', 'BOOKING_NOTE');

-- CreateEnum
CREATE TYPE "ClientMessageStatus" AS ENUM ('NEW', 'READ', 'ARCHIVED');

-- CreateTable
CREATE TABLE "ClientMessage" (
    "id" TEXT NOT NULL,
    "type" "ClientMessageType" NOT NULL,
    "userId" TEXT,
    "bookingId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "status" "ClientMessageStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicDocument" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientMessage_type_status_createdAt_idx" ON "ClientMessage"("type", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ClientMessage_bookingId_createdAt_idx" ON "ClientMessage"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientMessage_email_createdAt_idx" ON "ClientMessage"("email", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicDocument_key_key" ON "PublicDocument"("key");

-- CreateIndex
CREATE INDEX "PublicDocument_key_isActive_idx" ON "PublicDocument"("key", "isActive");

-- AddForeignKey
ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
