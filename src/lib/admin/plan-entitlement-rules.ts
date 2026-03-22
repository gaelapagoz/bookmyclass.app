import { EntitlementScope, EntitlementType, Prisma, ProductType } from "@prisma/client";

import { prisma } from "@/lib/db";

export type EntitlementRuleDraft = {
  entitlementType: EntitlementType;
  entitlementScope: EntitlementScope;
  quantity: number | null;
};

const ELIGIBLE_PRODUCT_TYPES: ProductType[] = [
  ProductType.CLASS_PACK,
  ProductType.UNLIMITED_MEMBERSHIP,
  ProductType.INTRO_OFFER,
  ProductType.DROP_IN_CLASS,
  ProductType.PRIVATE_CLASS,
  ProductType.WORKSHOP_PASS,
];

export function getDefaultEntitlementRuleForProductType(productType: ProductType): EntitlementRuleDraft | null {
  switch (productType) {
    case ProductType.CLASS_PACK:
      return {
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        quantity: 10,
      };
    case ProductType.UNLIMITED_MEMBERSHIP:
      return {
        entitlementType: EntitlementType.UNLIMITED_ACCESS,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        quantity: null,
      };
    case ProductType.INTRO_OFFER:
    case ProductType.DROP_IN_CLASS:
      return {
        entitlementType: EntitlementType.SINGLE_USE,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        quantity: 1,
      };
    case ProductType.PRIVATE_CLASS:
      return {
        entitlementType: EntitlementType.SINGLE_USE,
        entitlementScope: EntitlementScope.PRIVATE_CLASSES,
        quantity: 1,
      };
    case ProductType.WORKSHOP_PASS:
      return {
        entitlementType: EntitlementType.SINGLE_USE,
        entitlementScope: EntitlementScope.WORKSHOPS,
        quantity: 1,
      };
    default:
      return null;
  }
}

export async function ensureEntitlementRuleForProduct(params: {
  productId: string;
  productType: ProductType;
  prismaClient: Prisma.TransactionClient | typeof prisma;
}) {
  const rule = getDefaultEntitlementRuleForProductType(params.productType);

  await params.prismaClient.entitlementRule.updateMany({
    where: {
      productId: params.productId,
      isActive: true,
    },
    data: { isActive: false },
  });

  if (!rule) {
    return;
  }

  await params.prismaClient.entitlementRule.upsert({
    where: {
      productId_entitlementType_entitlementScope: {
        productId: params.productId,
        entitlementType: rule.entitlementType,
        entitlementScope: rule.entitlementScope,
      },
    },
    create: {
      productId: params.productId,
      entitlementType: rule.entitlementType,
      entitlementScope: rule.entitlementScope,
      quantity: rule.quantity,
      isActive: true,
    },
    update: {
      quantity: rule.quantity,
      isActive: true,
    },
  });
}

export async function backfillMissingPlanEntitlementRules(prismaClient: typeof prisma = prisma): Promise<number> {
  const candidates = await prismaClient.product.findMany({
    where: {
      isArchived: false,
      productType: { in: ELIGIBLE_PRODUCT_TYPES },
      entitlementRules: {
        none: {
          isActive: true,
        },
      },
    },
    select: {
      id: true,
      productType: true,
    },
  });

  for (const candidate of candidates) {
    await ensureEntitlementRuleForProduct({
      prismaClient,
      productId: candidate.id,
      productType: candidate.productType,
    });
  }

  return candidates.length;
}

