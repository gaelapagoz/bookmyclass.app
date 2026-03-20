import {
  EntitlementScope,
  EntitlementType,
  PriceType,
  PrismaClient,
  ProductType,
  Role,
  ServicePricingMode,
} from "@prisma/client";

export async function createClient(prisma: PrismaClient) {
  const unique = Date.now().toString();

  return prisma.user.create({
    data: {
      name: `Test Client ${unique}`,
      email: `client.${unique}@example.test`,
      role: Role.CLIENT,
    },
  });
}

export async function createBasicProduct(prisma: PrismaClient) {
  const unique = Date.now().toString();

  return prisma.product.create({
    data: {
      name: `Basic Product ${unique}`,
      slug: `basic-product-${unique}`,
      productType: ProductType.DROP_IN_CLASS,
      isActive: true,
      isArchived: false,
      sortOrder: 0,
    },
  });
}

export async function createClassPackSetup(prisma: PrismaClient) {
  const unique = Date.now().toString();

  const product = await prisma.product.create({
    data: {
      name: `10-Class Pack ${unique}`,
      slug: `class-pack-${unique}`,
      description: "Ten-class package for collective classes.",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 0,
    },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `class-pack-${unique}-one-time`,
      name: "10-Class Pack One-Time",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 15000,
      isActive: true,
      isArchived: false,
    },
  });

  const entitlementRule = await prisma.entitlementRule.create({
    data: {
      productId: product.id,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: 10,
      isActive: true,
    },
  });

  return { product, price, entitlementRule };
}

export async function getCreditBalance(prisma: PrismaClient, clientId: string) {
  const result = await prisma.creditLedgerEntry.aggregate({
    where: { clientId },
    _sum: { amount: true },
  });

  return result._sum.amount ?? 0;
}

export async function createClassCategory(
  prisma: PrismaClient,
  input: {
    isActive?: boolean;
    name: string;
    slug: string;
    sortOrder?: number;
  },
) {
  return prisma.classCategory.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: `${input.name} description`,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
}

export async function createClassType(
  prisma: PrismaClient,
  input: {
    categoryId: string;
    defaultDurationMinutes?: number;
    isActive?: boolean;
    isVisible?: boolean;
    name: string;
    pricingMode?: ServicePricingMode;
    slug: string;
    sortOrder?: number;
  },
) {
  return prisma.classType.create({
    data: {
      categoryId: input.categoryId,
      name: input.name,
      slug: input.slug,
      description: `${input.name} full description`,
      imageUrl: "https://images.example.test/service.jpg",
      defaultDurationMinutes: input.defaultDurationMinutes ?? 60,
      defaultCapacity: 12,
      isActive: input.isActive ?? true,
      isVisible: input.isVisible ?? true,
      pricingMode: input.pricingMode ?? ServicePricingMode.SINGLE_OR_PLAN,
      sortOrder: input.sortOrder ?? 0,
    },
  });
}
