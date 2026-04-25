import { EntitlementScope, EntitlementType, Prisma, ProductType } from "@prisma/client";

import { prisma } from "@/lib/db";

export type EntitlementRuleDraft = {
  entitlementType: EntitlementType;
  entitlementScope: EntitlementScope;
  quantity: number | null;
};

type EntitlementRuleOverrides = {
  packCreditQuantity?: number;
};

const ELIGIBLE_PRODUCT_TYPES: ProductType[] = [
  ProductType.CLASS_PACK,
  ProductType.PRIVATE_PACK,
  ProductType.UNLIMITED_MEMBERSHIP,
  ProductType.DROP_IN_CLASS,
];

function normalizePackCreditQuantity(input?: number): number {
  if (input === undefined) {
    return 10;
  }
  if (!Number.isInteger(input) || input < 1) {
    throw new Error("CLASS_PACK_QUANTITY_INVALID");
  }
  return input;
}

export function getDefaultEntitlementRuleForProductType(
  productType: ProductType,
  overrides?: EntitlementRuleOverrides,
): EntitlementRuleDraft | null {
  switch (productType) {
    case ProductType.CLASS_PACK:
      return {
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        quantity: normalizePackCreditQuantity(overrides?.packCreditQuantity),
      };
    case ProductType.PRIVATE_PACK:
      return {
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.PRIVATE_CLASSES,
        quantity: normalizePackCreditQuantity(overrides?.packCreditQuantity),
      };
    case ProductType.UNLIMITED_MEMBERSHIP:
      return {
        entitlementType: EntitlementType.UNLIMITED_ACCESS,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        quantity: null,
      };
    case ProductType.DROP_IN_CLASS:
      return {
        entitlementType: EntitlementType.SINGLE_USE,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
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
  packCreditQuantity?: number;
}) {
  const rule = getDefaultEntitlementRuleForProductType(params.productType, {
    packCreditQuantity: params.packCreditQuantity,
  });

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
