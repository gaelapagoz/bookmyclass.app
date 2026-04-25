-- Part 0: Remove deprecated product types INTRO_OFFER, WORKSHOP_PASS, GIFT_CARD
-- Data safety: remap all existing records to valid fallbacks before altering the enum.

-- INTRO_OFFER had the same entitlement as DROP_IN_CLASS (SINGLE_USE, COLLECTIVE_CLASSES)
UPDATE "Product" SET "productType" = 'DROP_IN_CLASS' WHERE "productType" = 'INTRO_OFFER';

-- WORKSHOP_PASS and GIFT_CARD map to CLASS_PACK as the nearest general-purpose fallback
UPDATE "Product" SET "productType" = 'CLASS_PACK' WHERE "productType" = 'WORKSHOP_PASS';
UPDATE "Product" SET "productType" = 'CLASS_PACK' WHERE "productType" = 'GIFT_CARD';

-- Recreate the enum without the removed values (PostgreSQL requires this approach)
CREATE TYPE "ProductType_new" AS ENUM ('DROP_IN_CLASS', 'CLASS_PACK', 'UNLIMITED_MEMBERSHIP', 'PRIVATE_CLASS');

ALTER TABLE "Product" ALTER COLUMN "productType" TYPE "ProductType_new" USING "productType"::text::"ProductType_new";

DROP TYPE "ProductType";
ALTER TYPE "ProductType_new" RENAME TO "ProductType";
