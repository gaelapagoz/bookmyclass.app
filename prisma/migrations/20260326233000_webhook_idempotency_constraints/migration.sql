ALTER TABLE "CreditLedgerEntry"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "CreditLedgerEntry_idempotencyKey_key"
ON "CreditLedgerEntry"("idempotencyKey");

ALTER TABLE "ClientEntitlement"
ADD CONSTRAINT "ClientEntitlement_clientId_productId_orderId_key"
UNIQUE ("clientId", "productId", "orderId");
