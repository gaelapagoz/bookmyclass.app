import { ProductType } from "@prisma/client";

export const PLAN_PRODUCT_TYPES: readonly ProductType[] = [
  ProductType.DROP_IN_CLASS,
  ProductType.CLASS_PACK,
  ProductType.PRIVATE_PACK,
  ProductType.UNLIMITED_MEMBERSHIP,
];

export const STORE_PRODUCT_TYPES: readonly ProductType[] = [
  ProductType.MERCHANDISE,
  ProductType.GIFT_CARD,
];

export function isPlanProductType(productType: ProductType): boolean {
  return (PLAN_PRODUCT_TYPES as ProductType[]).includes(productType);
}

export function isStoreProductType(productType: ProductType): boolean {
  return (STORE_PRODUCT_TYPES as ProductType[]).includes(productType);
}
