-- Rename PRIVATE_CLASS product type to PRIVATE_PACK
ALTER TYPE "ProductType" RENAME VALUE 'PRIVATE_CLASS' TO 'PRIVATE_PACK';

-- Migrate legacy private packs previously modeled as CLASS_PACK + PRIVATE_CLASSES scope.
UPDATE "Product" p
SET "productType" = 'PRIVATE_PACK'
FROM "EntitlementRule" er
WHERE p.id = er."productId"
  AND p."productType" = 'CLASS_PACK'
  AND er."isActive" = true
  AND er."entitlementScope" = 'PRIVATE_CLASSES';

-- Normalize any legacy single-use private products to PRIVATE_PACK credit-pack semantics.
UPDATE "EntitlementRule" er
SET
  "entitlementType" = 'CREDIT_PACK',
  "quantity" = COALESCE(er."quantity", 1)
FROM "Product" p
WHERE er."productId" = p.id
  AND p."productType" = 'PRIVATE_PACK'
  AND er."isActive" = true
  AND er."entitlementScope" = 'PRIVATE_CLASSES'
  AND er."entitlementType" = 'SINGLE_USE';
