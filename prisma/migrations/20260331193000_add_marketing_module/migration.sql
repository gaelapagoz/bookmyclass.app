-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT');

-- CreateEnum
CREATE TYPE "MarketingAudienceType" AS ENUM ('ALL_USERS', 'ACTIVE_USERS', 'PAYING_SUBSCRIBERS', 'MANUAL');

-- CreateEnum
CREATE TYPE "MarketingRecipientStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED');

-- CreateTable
CREATE TABLE "MarketingCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "categoryId" TEXT,
    "audienceType" "MarketingAudienceType" NOT NULL,
    "manualAudienceJson" JSONB,
    "subject" TEXT NOT NULL,
    "previewText" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "replyTo" TEXT,
    "contentJson" JSONB NOT NULL,
    "htmlSnapshot" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "status" "MarketingRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaignLink" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaignLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaignLinkClick" (
    "id" TEXT NOT NULL,
    "campaignLinkId" TEXT NOT NULL,
    "recipientId" TEXT,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "MarketingCampaignLinkClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingUnsubscribe" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "unsubscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingUnsubscribe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCategory_slug_key" ON "MarketingCategory"("slug");

-- CreateIndex
CREATE INDEX "MarketingCampaign_status_updatedAt_idx" ON "MarketingCampaign"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MarketingCampaign_categoryId_idx" ON "MarketingCampaign"("categoryId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_sentAt_idx" ON "MarketingCampaign"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaignRecipient_campaignId_email_key" ON "MarketingCampaignRecipient"("campaignId", "email");

-- CreateIndex
CREATE INDEX "MarketingCampaignRecipient_campaignId_status_idx" ON "MarketingCampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "MarketingCampaignRecipient_email_idx" ON "MarketingCampaignRecipient"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaignLink_token_key" ON "MarketingCampaignLink"("token");

-- CreateIndex
CREATE INDEX "MarketingCampaignLink_campaignId_idx" ON "MarketingCampaignLink"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingCampaignLinkClick_campaignLinkId_clickedAt_idx" ON "MarketingCampaignLinkClick"("campaignLinkId", "clickedAt");

-- CreateIndex
CREATE INDEX "MarketingCampaignLinkClick_recipientId_idx" ON "MarketingCampaignLinkClick"("recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingUnsubscribe_email_key" ON "MarketingUnsubscribe"("email");

-- CreateIndex
CREATE INDEX "MarketingUnsubscribe_userId_idx" ON "MarketingUnsubscribe"("userId");

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MarketingCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignRecipient" ADD CONSTRAINT "MarketingCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignRecipient" ADD CONSTRAINT "MarketingCampaignRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignLink" ADD CONSTRAINT "MarketingCampaignLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignLinkClick" ADD CONSTRAINT "MarketingCampaignLinkClick_campaignLinkId_fkey" FOREIGN KEY ("campaignLinkId") REFERENCES "MarketingCampaignLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignLinkClick" ADD CONSTRAINT "MarketingCampaignLinkClick_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "MarketingCampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingUnsubscribe" ADD CONSTRAINT "MarketingUnsubscribe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
