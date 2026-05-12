ALTER TABLE "GiftCardLedgerEntry"
DROP CONSTRAINT "GiftCardLedgerEntry_orderItemId_fkey";

ALTER TABLE "GiftCardLedgerEntry"
ADD CONSTRAINT "GiftCardLedgerEntry_orderItemId_fkey"
FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiftCardLedgerEntry"
ADD CONSTRAINT "GiftCardLedgerEntry_activation_orderItem_required"
CHECK ("entryType" <> 'ACTIVATION' OR "orderItemId" IS NOT NULL);
