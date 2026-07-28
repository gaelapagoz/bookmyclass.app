import { PriceType, Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";

const loyaltyProgramSettingsSchema = z.object({
  currencyCode: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  isActive: z.boolean(),
  earningPoints: z.number().int().positive(),
  earningAmountMinor: z.number().int().positive(),
  pointsExpireAfterDays: z.number().int().positive(),
  expirationReminderDays: z.number().int().positive().nullable(),
  eligibleProductIds: z.array(z.string().trim().min(1)).max(250),
}).superRefine((input, ctx) => {
  if (input.isActive && input.eligibleProductIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "LOYALTY_ELIGIBLE_PRODUCTS_REQUIRED",
      path: ["eligibleProductIds"],
    });
  }

  if (
    input.expirationReminderDays !== null
    && input.expirationReminderDays >= input.pointsExpireAfterDays
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "LOYALTY_EXPIRATION_REMINDER_INVALID",
      path: ["expirationReminderDays"],
    });
  }
});

export class LoyaltyProgramServiceError extends Error {
  constructor(
    public readonly code:
      | "LOYALTY_PROGRAM_NOT_FOUND"
      | "LOYALTY_PROGRAM_NOT_ACTIVE"
      | "LOYALTY_PROGRAM_INPUT_INVALID"
      | "LOYALTY_ELIGIBLE_PRODUCTS_INVALID"
      | "LOYALTY_REWARD_INPUT_INVALID"
      | "LOYALTY_REWARD_NOT_FOUND",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LoyaltyProgramServiceError";
  }
}

export type LoyaltyProgramRecord = Prisma.LoyaltyProgramGetPayload<{
  include: {
    eligibleProducts: {
      include: {
        product: {
          select: {
            id: true;
            name: true;
            slug: true;
            productType: true;
            isActive: true;
            isArchived: true;
          };
        };
      };
    };
    rewardDefinitions: true;
  };
}>;

export type LoyaltyProgramSummary = Pick<
  LoyaltyProgramRecord,
  | "id"
  | "currencyCode"
  | "isActive"
  | "earningPoints"
  | "earningAmountMinor"
  | "pointsExpireAfterDays"
  | "expirationReminderDays"
>;

type LoyaltyProgramDbClient = Prisma.TransactionClient | typeof prisma;

export type UpsertLoyaltyProgramSettingsInput = {
  currencyCode: string;
  isActive: boolean;
  earningPoints: number;
  earningAmountMinor: number;
  pointsExpireAfterDays: number;
  expirationReminderDays: number | null;
  eligibleProductIds: string[];
  prismaClient?: LoyaltyProgramDbClient;
};

export type UpsertLoyaltyRewardDefinitionInput = {
  programId: string;
  rewardDefinitionId?: string;
  name: string;
  pointsRequired: number;
  amountMinor: number;
  isActive?: boolean;
  prismaClient?: LoyaltyProgramDbClient;
};

export type LoyaltyEligibleProductOption = {
  id: string;
  name: string;
  slug: string;
  productType: Prisma.ProductGetPayload<{ select: { productType: true } }>["productType"];
  priceId: string;
  priceName: string;
  unitAmountMinor: number;
  currencyCode: string;
};

function isMissingTableError(error: unknown, tableName?: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2021"
    && (
      !tableName
      || error.message.includes(`table \`public.${tableName}\``)
      || error.message.includes(`table "public.${tableName}"`)
    );
}

const loyaltyProgramInclude = {
  eligibleProducts: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          productType: true,
          isActive: true,
          isArchived: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  rewardDefinitions: {
    orderBy: [{ pointsRequired: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.LoyaltyProgramInclude;

function getDbClient(db?: LoyaltyProgramDbClient) {
  return db ?? prisma;
}

function normalizeProgramSettings(input: UpsertLoyaltyProgramSettingsInput) {
  const parsed = loyaltyProgramSettingsSchema.safeParse({
    ...input,
    eligibleProductIds: Array.from(new Set(input.eligibleProductIds.map((value) => value.trim()).filter(Boolean))),
  });

  if (!parsed.success) {
    throw new LoyaltyProgramServiceError(
      "LOYALTY_PROGRAM_INPUT_INVALID",
      "Loyalty program settings are invalid.",
      { issues: parsed.error.issues },
    );
  }

  return parsed.data;
}

async function assertEligibleProducts(
  db: LoyaltyProgramDbClient,
  input: { currencyCode: string; eligibleProductIds: string[] },
) {
  if (input.eligibleProductIds.length === 0) {
    return;
  }

  const products = await db.product.findMany({
    where: {
      id: { in: input.eligibleProductIds },
      isActive: true,
      isArchived: false,
      prices: {
        some: {
          currencyCode: input.currencyCode,
          priceType: PriceType.ONE_TIME,
          isActive: true,
          isArchived: false,
        },
      },
    },
    select: { id: true },
  });

  const validIds = new Set(products.map((product) => product.id));
  const invalidProductIds = input.eligibleProductIds.filter((productId) => !validIds.has(productId));
  if (invalidProductIds.length > 0) {
    throw new LoyaltyProgramServiceError(
      "LOYALTY_ELIGIBLE_PRODUCTS_INVALID",
      "Eligible loyalty products must be active catalog products with an active one-time price.",
      { invalidProductIds },
    );
  }
}

export function calculateLoyaltyPoints(input: {
  earningPoints: number;
  earningAmountMinor: number;
  eligibleAmountMinor: number;
}) {
  if (!Number.isInteger(input.eligibleAmountMinor) || input.eligibleAmountMinor < 0) {
    throw new LoyaltyProgramServiceError(
      "LOYALTY_PROGRAM_INPUT_INVALID",
      "Eligible loyalty amount must be a non-negative integer.",
    );
  }

  if (input.eligibleAmountMinor === 0) {
    return 0;
  }

  return Math.floor(input.eligibleAmountMinor / input.earningAmountMinor) * input.earningPoints;
}

export async function getLoyaltyProgramForCurrency(
  currencyCode: string,
  prismaClient?: LoyaltyProgramDbClient,
): Promise<LoyaltyProgramRecord | null> {
  try {
    return await getDbClient(prismaClient).loyaltyProgram.findUnique({
      where: { currencyCode: currencyCode.trim().toUpperCase() },
      include: loyaltyProgramInclude,
    });
  } catch (error) {
    if (isMissingTableError(error, "LoyaltyProgram")) {
      return null;
    }
    throw error;
  }
}

export async function getActiveLoyaltyProgram(
  currencyCode: string,
  prismaClient?: LoyaltyProgramDbClient,
): Promise<LoyaltyProgramRecord> {
  const program = await getLoyaltyProgramForCurrency(currencyCode, prismaClient);
  if (!program) {
    throw new LoyaltyProgramServiceError("LOYALTY_PROGRAM_NOT_FOUND", "No loyalty program exists for this currency.");
  }
  if (!program.isActive) {
    throw new LoyaltyProgramServiceError("LOYALTY_PROGRAM_NOT_ACTIVE", "The loyalty program is not active.");
  }
  return program;
}

export async function listLoyaltyPrograms(
  prismaClient?: LoyaltyProgramDbClient,
): Promise<LoyaltyProgramSummary[]> {
  try {
    return await getDbClient(prismaClient).loyaltyProgram.findMany({
      orderBy: [{ isActive: "desc" }, { currencyCode: "asc" }],
      select: {
        id: true,
        currencyCode: true,
        isActive: true,
        earningPoints: true,
        earningAmountMinor: true,
        pointsExpireAfterDays: true,
        expirationReminderDays: true,
      },
    });
  } catch (error) {
    if (isMissingTableError(error, "LoyaltyProgram")) {
      return [];
    }
    throw error;
  }
}

export async function resolvePrimaryLoyaltyCurrencyCode(
  prismaClient?: LoyaltyProgramDbClient,
): Promise<string> {
  const programs = await listLoyaltyPrograms(prismaClient);
  return programs[0]?.currencyCode ?? "EUR";
}

export async function listEligibleLoyaltyProductsForCurrency(
  currencyCode: string,
  prismaClient?: LoyaltyProgramDbClient,
): Promise<LoyaltyEligibleProductOption[]> {
  return getDbClient(prismaClient).product.findMany({
    where: {
      isActive: true,
      isArchived: false,
      prices: {
        some: {
          currencyCode: currencyCode.trim().toUpperCase(),
          priceType: PriceType.ONE_TIME,
          isActive: true,
          isArchived: false,
        },
      },
    },
    orderBy: [{ name: "asc" }, { slug: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      productType: true,
      prices: {
        where: {
          currencyCode: currencyCode.trim().toUpperCase(),
          priceType: PriceType.ONE_TIME,
          isActive: true,
          isArchived: false,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          name: true,
          unitAmountMinor: true,
          currencyCode: true,
        },
      },
    },
  }).then((products) =>
    products.flatMap((product) => {
      const price = product.prices[0];
      if (!price) {
        return [];
      }

      return [{
        id: product.id,
        name: product.name,
        slug: product.slug,
        productType: product.productType,
        priceId: price.id,
        priceName: price.name,
        unitAmountMinor: price.unitAmountMinor,
        currencyCode: price.currencyCode,
      }];
    }),
  );
}

export { isMissingTableError as isMissingLoyaltyTableError };

export async function upsertLoyaltyProgramSettings(
  input: UpsertLoyaltyProgramSettingsInput,
): Promise<LoyaltyProgramRecord> {
  const normalized = normalizeProgramSettings(input);
  const db = getDbClient(input.prismaClient);

  await assertEligibleProducts(db, normalized);

  const existing = await db.loyaltyProgram.findUnique({
    where: { currencyCode: normalized.currencyCode },
    select: { id: true },
  });

  if (existing) {
    await db.loyaltyProgram.update({
      where: { id: existing.id },
      data: {
        isActive: normalized.isActive,
        earningPoints: normalized.earningPoints,
        earningAmountMinor: normalized.earningAmountMinor,
        pointsExpireAfterDays: normalized.pointsExpireAfterDays,
        expirationReminderDays: normalized.expirationReminderDays,
      },
    });

    await db.loyaltyEligibleProduct.deleteMany({
      where: {
        programId: existing.id,
        productId: { notIn: normalized.eligibleProductIds },
      },
    });

    const existingEligibleProducts = await db.loyaltyEligibleProduct.findMany({
      where: { programId: existing.id },
      select: { productId: true },
    });
    const existingProductIdSet = new Set(existingEligibleProducts.map((entry) => entry.productId));
    const productIdsToCreate = normalized.eligibleProductIds.filter((productId) => !existingProductIdSet.has(productId));

    if (productIdsToCreate.length > 0) {
      await db.loyaltyEligibleProduct.createMany({
        data: productIdsToCreate.map((productId) => ({
          programId: existing.id,
          productId,
          isActive: true,
        })),
      });
    }

    if (normalized.eligibleProductIds.length > 0) {
      await db.loyaltyEligibleProduct.updateMany({
        where: {
          programId: existing.id,
          productId: { in: normalized.eligibleProductIds },
        },
        data: { isActive: true },
      });
    }
  } else {
    await db.loyaltyProgram.create({
      data: {
        currencyCode: normalized.currencyCode,
        isActive: normalized.isActive,
        earningPoints: normalized.earningPoints,
        earningAmountMinor: normalized.earningAmountMinor,
        pointsExpireAfterDays: normalized.pointsExpireAfterDays,
        expirationReminderDays: normalized.expirationReminderDays,
        maxManualGrantPoints: 5000,
        eligibleProducts: {
          create: normalized.eligibleProductIds.map((productId) => ({
            productId,
            isActive: true,
          })),
        },
      },
    });
  }

  return getActiveLoyaltyProgram(normalized.currencyCode, db).catch(async (error: unknown) => {
    if (
      normalized.isActive
      || !(error instanceof LoyaltyProgramServiceError)
      || error.code !== "LOYALTY_PROGRAM_NOT_ACTIVE"
    ) {
      throw error;
    }

    const program = await getLoyaltyProgramForCurrency(normalized.currencyCode, db);
    if (!program) {
      throw new LoyaltyProgramServiceError("LOYALTY_PROGRAM_NOT_FOUND", "No loyalty program exists for this currency.");
    }
    return program;
  });
}

const rewardDefinitionSchema = z.object({
  programId: z.string().trim().min(1),
  rewardDefinitionId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  pointsRequired: z.number().int().positive(),
  amountMinor: z.number().int().positive(),
  isActive: z.boolean().optional(),
});

function normalizeRewardDefinition(input: UpsertLoyaltyRewardDefinitionInput) {
  const parsed = rewardDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new LoyaltyProgramServiceError(
      "LOYALTY_REWARD_INPUT_INVALID",
      "Loyalty reward definition is invalid.",
      { issues: parsed.error.issues },
    );
  }

  return parsed.data;
}

export async function upsertLoyaltyRewardDefinition(
  input: UpsertLoyaltyRewardDefinitionInput,
) {
  const normalized = normalizeRewardDefinition(input);
  const db = getDbClient(input.prismaClient);

  const program = await db.loyaltyProgram.findUnique({
    where: { id: normalized.programId },
    select: { id: true },
  });
  if (!program) {
    throw new LoyaltyProgramServiceError(
      "LOYALTY_PROGRAM_NOT_FOUND",
      "No loyalty program exists for this reward.",
    );
  }

  if (normalized.rewardDefinitionId) {
    const existingReward = await db.loyaltyRewardDefinition.findFirst({
      where: {
        id: normalized.rewardDefinitionId,
        programId: normalized.programId,
      },
      select: { id: true },
    });
    if (!existingReward) {
      throw new LoyaltyProgramServiceError(
        "LOYALTY_REWARD_NOT_FOUND",
        "Loyalty reward definition was not found for this program.",
      );
    }

    return db.loyaltyRewardDefinition.update({
      where: { id: existingReward.id },
      data: {
        name: normalized.name,
        pointsRequired: normalized.pointsRequired,
        amountMinor: normalized.amountMinor,
        isActive: normalized.isActive ?? true,
      },
    });
  }

  return db.loyaltyRewardDefinition.create({
    data: {
      programId: normalized.programId,
      name: normalized.name,
      pointsRequired: normalized.pointsRequired,
      amountMinor: normalized.amountMinor,
      isActive: normalized.isActive ?? true,
    },
  });
}

export async function archiveLoyaltyRewardDefinition(input: {
  programId: string;
  rewardDefinitionId: string;
  prismaClient?: LoyaltyProgramDbClient;
}) {
  const db = getDbClient(input.prismaClient);
  const reward = await db.loyaltyRewardDefinition.findFirst({
    where: {
      id: input.rewardDefinitionId,
      programId: input.programId,
    },
    select: { id: true },
  });
  if (!reward) {
    throw new LoyaltyProgramServiceError(
      "LOYALTY_REWARD_NOT_FOUND",
      "Loyalty reward definition was not found for this program.",
    );
  }

  return db.loyaltyRewardDefinition.update({
    where: { id: input.rewardDefinitionId },
    data: { isActive: false },
  });
}
