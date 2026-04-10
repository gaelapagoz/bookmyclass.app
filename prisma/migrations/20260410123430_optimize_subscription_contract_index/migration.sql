-- CreateIndex
CREATE INDEX "SubscriptionContract_clientId_productId_status_currentPerio_idx" ON "SubscriptionContract"("clientId", "productId", "status", "currentPeriodEnd");
