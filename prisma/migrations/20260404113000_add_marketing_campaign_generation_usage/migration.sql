CREATE TABLE "MarketingCampaignGenerationUsage" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL,
  "outputTokens" INTEGER NOT NULL,
  "totalTokens" INTEGER NOT NULL,
  "estimatedInputCost" DECIMAL(14,6) NOT NULL,
  "estimatedOutputCost" DECIMAL(14,6) NOT NULL,
  "estimatedTotalCost" DECIMAL(14,6) NOT NULL,
  "pricingVersion" TEXT NOT NULL,
  "rateBasisJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketingCampaignGenerationUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketingCampaignGenerationUsage_campaignId_createdAt_idx"
  ON "MarketingCampaignGenerationUsage"("campaignId", "createdAt");

CREATE INDEX "MarketingCampaignGenerationUsage_createdAt_idx"
  ON "MarketingCampaignGenerationUsage"("createdAt");

ALTER TABLE "MarketingCampaignGenerationUsage"
  ADD CONSTRAINT "MarketingCampaignGenerationUsage_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;