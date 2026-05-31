import {
  BillingInterval,
  BookingStatus,
  OrderStatus,
  PaymentProvider,
  PriceType,
  ProductType,
  Role,
  StudioSessionStatus,
  SubscriptionStatus,
  StripeSyncStatus,
  Weekday,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { getSiteDateKey, getSiteTimeLabel } from "@/lib/public-catalogue/timezone";
import { resolveEntitlementScopeFromCategorySlug } from "@/lib/booking/entitlement-scope";
import { generatePlanSlug } from "@/lib/admin/plan-slug";
import { ensureEntitlementRuleForProduct } from "@/lib/admin/plan-entitlement-rules";
import { provisionPlanOnStripe, resolveStripeProductIdFromPrice } from "@/lib/admin/plan-provisioning";
import { isAdminRole } from "@/lib/auth/admin-access";
import { normalizeBookingCancellationWindowHours } from "@/lib/booking/cancellation-policy";
import { assertLearningImagePath } from "@/lib/learning/image-paths";
import {
  assertCanonicalMediaPublicPath,
  getCanonicalMediaRenderState,
  listLearningMediaLibraryImages,
} from "@/lib/media";
import { getSiteTimeZone, updateSiteTimeZone } from "@/lib/site-settings/site-settings-service";
import { isCatalogPriceCheckoutReady } from "@/lib/catalog/checkout-readiness";
import { PLAN_PRODUCT_TYPES } from "@/lib/catalog/product-scopes";

export type AdminDashboardData = {
  upcomingSessions: Array<{
    id: string;
    title: string;
    startsAt: string;
    bookedSpots: number;
    capacity: number;
  }>;
};

export type AdminSiteWeeklyScheduleEntry = {
  id: string;
  dayOfWeek: Weekday;
  startTime: string;
  endTime: string;
  serviceId: string | null;
  label: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminSiteScheduleServiceOption = {
  id: string;
  name: string;
};

export async function resolveAdminActorUser(input: { actorUserId: string }) {
  const actor = await prisma.user.findUnique({
    where: { id: input.actorUserId },
    select: {
      id: true,
      role: true,
    },
  });

  if (!actor || (actor.role !== Role.ADMIN && actor.role !== Role.MASTER_ADMIN)) {
    throw new Error("ADMIN_USER_NOT_FOUND");
  }

  return actor;
}

export type AdminClassItem = {
  id: string;
  name: string;
  categoryName: string;
  defaultTeacherName: string | null;
  defaultCapacity: number;
  isActive: boolean;
  isVisible: boolean;
  sortOrder: number;
};

export type AdminClassCategoryItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  serviceCount: number;
};

export type AdminClassScheduleConfig = {
  defaultTeacherId: string;
  startTime: string;
  endTime: string;
  isRecurring: boolean;
  date: string | null;
  weekdays: Weekday[];
  endDate: string | null;
};

export type AdminPlanItem = {
  id: string;
  name: string;
  productType: ProductType;
  isActive: boolean;
  sortOrder: number;
  activeEntitlementQuantity: number | null;
  currentPriceAmountMinor: number | null;
  currentPriceCurrencyCode: string | null;
  currentPriceType: PriceType | null;
  currentBillingInterval: BillingInterval | null;
  currentBillingIntervalCount: number | null;
  isCheckoutReady: boolean;
};

type AdminCheckoutReadinessPrice = {
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  stripePriceId: string | null;
  stripeSyncStatus: StripeSyncStatus;
};

export type AdminSubscriptionItem = {
  id: string;
  clientName: string;
  clientEmail: string;
  productName: string;
  priceName: string;
  status: SubscriptionStatus;
  startsAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  endedAt: string | null;
  provider: PaymentProvider;
};

export type AdminOrderDateFilter = "all" | "last7Days" | "last30Days" | "last90Days";
export type AdminSubscriptionStatusFilter =
  | "all"
  | "pending"
  | "active"
  | "cancelled"
  | "expired"
  | "pastDue";

export type AdminOrdersPageItem = {
  id: string;
  orderId: string;
  purchasedAt: string;
  clientName: string;
  clientEmail: string;
  productName: string;
  priceName: string;
  quantity: number;
  lineTotalAmountMinor: number;
  currencyCode: string;
};

export type AdminOrdersPageData = {
  filter: AdminOrderDateFilter;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  items: AdminOrdersPageItem[];
};

export type AdminSubscriptionsPageData = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  items: AdminSubscriptionItem[];
};

export type AdminLearningProgramItem = {
  id: string;
  courseType: string;
  updatedAt: string;
};

export type AdminLearningVideoItem = {
  id: string;
  title: string;
  category: string;
  priority: number;
  updatedAt: string;
};

export type AdminRecurringSessionScheduleInput = {
  startsOn: Date;
  startTime: string;
  endTime: string;
  repeatEveryWeeks: number;
  weekdays: Weekday[];
  endMode: "never" | "on_date" | "after_occurrences";
  endDate?: Date | null;
  occurrences?: number;
};

function toNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
type CatalogMutationActor = {
  actorId: string;
  actorRole: Role;
};

function assertCatalogMutationActor(actor: CatalogMutationActor) {
  if (!isAdminRole(actor.actorRole)) {
    throw new Error("ADMIN_ROLE_REQUIRED");
  }
}

async function createCatalogAuditLog(
  tx: Prisma.TransactionClient | typeof prisma,
  input: {
    actionType:
      | "CATALOG_PRODUCT_CREATE"
      | "CATALOG_PRODUCT_UPDATE"
      | "CATALOG_PRODUCT_ACTIVATE"
      | "CATALOG_PRODUCT_DEACTIVATE"
      | "CATALOG_PRICE_STRIPE_LINK"
      | "CATALOG_PRICE_SYNC_FAIL";
    actorId: string | null;
    entityType: "Product" | "Price";
    entityId: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
    },
  });
}

function assertAdminPlanPriceInput(input: {
  productType: ProductType;
  priceType?: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval?: BillingInterval;
  billingIntervalCount?: number;
}): {
  derivedPriceType: PriceType;
  derivedBillingInterval: BillingInterval | null;
  derivedBillingIntervalCount: number | null;
} {
  // Phase 1 invariant guard for admin catalog price writes.
  if (!/^[A-Z]{3}$/.test(input.currencyCode)) {
    throw new Error("INVALID_CURRENCY_CODE");
  }

  if (!Number.isInteger(input.unitAmountMinor) || input.unitAmountMinor <= 0) {
    throw new Error("INVALID_UNIT_AMOUNT");
  }

  const derivedPriceType =
    input.productType === ProductType.UNLIMITED_MEMBERSHIP
      ? PriceType.RECURRING
      : PriceType.ONE_TIME;

  if (input.priceType !== undefined && input.priceType !== derivedPriceType) {
    throw new Error("PRICE_TYPE_DERIVATION_MISMATCH");
  }

  if (derivedPriceType === PriceType.RECURRING) {
    if (!input.billingInterval) {
      throw new Error("RECURRING_INTERVAL_REQUIRED");
    }

    if (input.billingInterval !== BillingInterval.MONTH && input.billingInterval !== BillingInterval.YEAR) {
      throw new Error("BILLING_INTERVAL_INVALID_FOR_MEMBERSHIP");
    }

    if (input.billingIntervalCount !== undefined && input.billingIntervalCount !== 1) {
      throw new Error("INVALID_BILLING_INTERVAL_COUNT");
    }

    return {
      derivedPriceType,
      derivedBillingInterval: input.billingInterval,
      derivedBillingIntervalCount: 1,
    };
  }

  if (input.billingInterval !== undefined || input.billingIntervalCount !== undefined) {
    throw new Error("ONE_TIME_INTERVAL_FORBIDDEN");
  }

  return {
    derivedPriceType,
    derivedBillingInterval: null,
    derivedBillingIntervalCount: null,
  };
}

function isPackProductType(productType: ProductType): boolean {
  return productType === ProductType.CLASS_PACK || productType === ProductType.PRIVATE_PACK;
}

function assertAdminPlanEntitlementInput(input: {
  productType: ProductType;
  classPackCreditQuantity?: number;
}) {
  if (isPackProductType(input.productType)) {
    if (
      input.classPackCreditQuantity !== undefined &&
      (!Number.isInteger(input.classPackCreditQuantity) || input.classPackCreditQuantity < 1)
    ) {
      throw new Error("CLASS_PACK_QUANTITY_INVALID");
    }
    return;
  }

  if (input.classPackCreditQuantity !== undefined) {
    throw new Error("CLASS_PACK_QUANTITY_NOT_ALLOWED");
  }
}

function buildDeterministicCorrelation(prefix: "admin-create" | "admin-update", parts: string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 24);

  return `${prefix}-${digest}`;
}

function buildDeterministicPriceLookupKey(input: {
  productKey: string;
  slug: string;
  priceName: string;
  correlationKey: string;
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
}) {
  const digest = createHash("sha256")
    .update(
      [
        input.productKey,
        input.slug,
        input.priceName,
        input.correlationKey,
        input.priceType,
        input.currencyCode,
        String(input.unitAmountMinor),
        input.billingInterval ?? "none",
        String(input.billingIntervalCount ?? 0),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 18);

  return `admin-${input.slug}-${digest}`;
}

function isCheckoutReadyCatalogPrice(price: AdminCheckoutReadinessPrice | null): boolean {
  return isCatalogPriceCheckoutReady(price);
}

export async function applyStripeProvisionResultToPrice(input: {
  priceId: string;
  productId: string;
  actorId: string | null;
  syncCorrelation: string;
  provisionResult: Awaited<ReturnType<typeof provisionPlanOnStripe>>;
}) {
  const now = new Date();
  const provisionResult = input.provisionResult;

  if (provisionResult.ok) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.price.updateMany({
        where: {
          id: input.priceId,
          stripePriceId: null,
        },
        data: {
          stripePriceId: provisionResult.stripePriceId,
          stripeSyncStatus: StripeSyncStatus.SYNCED,
          stripeSyncLastAttempt: now,
          stripeSyncLastSuccess: now,
          stripeSyncErrorCode: null,
          stripeSyncError: null,
          stripeSyncCorrelation: input.syncCorrelation,
        },
      });

      if (updated.count === 0) {
        const existing = await tx.price.findUnique({
          where: { id: input.priceId },
          select: { stripePriceId: true },
        });

        if (!existing) {
          throw new Error("PRICE_NOT_FOUND");
        }

        if (existing.stripePriceId && existing.stripePriceId !== provisionResult.stripePriceId) {
          throw new Error("STRIPE_PRICE_ID_IMMUTABLE");
        }

        await tx.price.update({
          where: { id: input.priceId },
          data: {
            stripeSyncStatus: StripeSyncStatus.SYNCED,
            stripeSyncLastAttempt: now,
            stripeSyncLastSuccess: now,
            stripeSyncErrorCode: null,
            stripeSyncError: null,
            stripeSyncCorrelation: input.syncCorrelation,
          },
        });
      }

      await createCatalogAuditLog(tx, {
        actorId: input.actorId,
        actionType: "CATALOG_PRICE_STRIPE_LINK",
        entityType: "Price",
        entityId: input.priceId,
        metadata: {
          productId: input.productId,
          stripePriceId: provisionResult.stripePriceId,
          syncCorrelation: input.syncCorrelation,
          ownershipScopeKey: "GLOBAL_CATALOG",
        },
      });
    });

    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.price.update({
      where: { id: input.priceId },
      data: {
        stripeSyncStatus: StripeSyncStatus.FAILED,
        stripeSyncLastAttempt: now,
        stripeSyncErrorCode: provisionResult.stripeErrorCode ?? "STRIPE_PROVISION_FAILED",
        stripeSyncError: provisionResult.reason,
        stripeSyncCorrelation: input.syncCorrelation,
      },
    });

    await createCatalogAuditLog(tx, {
      actorId: input.actorId,
      actionType: "CATALOG_PRICE_SYNC_FAIL",
      entityType: "Price",
      entityId: input.priceId,
      metadata: {
        productId: input.productId,
        syncCorrelation: input.syncCorrelation,
        stripeErrorCode: provisionResult.stripeErrorCode ?? "STRIPE_PROVISION_FAILED",
        stripeError: provisionResult.reason,
        ownershipScopeKey: "GLOBAL_CATALOG",
      },
    });
  });
}

export async function remediatePriceStripeId(input: {
  actor: CatalogMutationActor;
  priceId: string;
  stripePriceId: string;
  reason?: string;
}) {
  assertCatalogMutationActor(input.actor);

  await prisma.$transaction(async (tx) => {
    const actorRecord = await tx.user.findUnique({
      where: { id: input.actor.actorId },
      select: { role: true },
    });

    if (!actorRecord || !isAdminRole(actorRecord.role)) {
      throw new Error("ADMIN_ROLE_REQUIRED");
    }

    const price = await tx.price.findUnique({
      where: { id: input.priceId },
      select: { id: true, stripePriceId: true },
    });

    if (!price) {
      throw new Error("PRICE_NOT_FOUND");
    }

    const newStripePriceId = input.stripePriceId?.trim();
    if (!newStripePriceId) {
      throw new Error("INVALID_STRIPE_PRICE_ID");
    }

    if (price.stripePriceId === newStripePriceId) {
      throw new Error("STRIPE_PRICE_ID_UNCHANGED");
    }

    const correlation = `remediation-${randomUUID()}`;
    const now = new Date();

    await tx.$executeRaw`SET LOCAL "catalog.skip_stripe_id_immutability" = 'on'`;

    await tx.price.update({
      where: { id: input.priceId },
      data: {
        stripePriceId: newStripePriceId,
        stripeSyncStatus: StripeSyncStatus.SYNCED,
        stripeSyncLastAttempt: now,
        stripeSyncLastSuccess: now,
        stripeSyncErrorCode: null,
        stripeSyncError: null,
        stripeSyncCorrelation: correlation,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.actor.actorId,
        actionType: "CATALOG_PRICE_STRIPE_REMEDIATION",
        entityType: "Price",
        entityId: input.priceId,
        metadata: {
          oldStripePriceId: price.stripePriceId,
          newStripePriceId,
          reason: input.reason?.trim() || null,
          ownershipScopeKey: "GLOBAL_CATALOG",
        },
      },
    });
  });
}

export async function getAdminPlansData(): Promise<AdminPlanItem[]> {
  const products = await prisma.product.findMany({
    where: { isArchived: false, productType: { in: PLAN_PRODUCT_TYPES as ProductType[] } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      productType: true,
      isActive: true,
      sortOrder: true,
      entitlementRules: {
        where: { isActive: true },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
        select: { quantity: true },
      },
      prices: {
        where: { isActive: true, isArchived: false },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
        select: {
          unitAmountMinor: true,
          currencyCode: true,
          priceType: true,
          billingInterval: true,
          billingIntervalCount: true,
          stripePriceId: true,
          stripeSyncStatus: true,
        },
      },
    },
  });

  return products.map((item) => {
    const currentPrice = item.prices[0] ?? null;
    return {
      id: item.id,
      name: item.name,
      productType: item.productType,
      isActive: item.isActive,
      sortOrder: item.sortOrder,
      activeEntitlementQuantity: item.entitlementRules[0]?.quantity ?? null,
      currentPriceAmountMinor: currentPrice?.unitAmountMinor ?? null,
      currentPriceCurrencyCode: currentPrice?.currencyCode ?? null,
      currentPriceType: currentPrice?.priceType ?? null,
      currentBillingInterval: currentPrice?.billingInterval ?? null,
      currentBillingIntervalCount: currentPrice?.billingIntervalCount ?? null,
      isCheckoutReady: isCheckoutReadyCatalogPrice(currentPrice),
    };
  });
}

export async function getAdminPlanById(id: string) {
  const record = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      productType: true,
      isActive: true,
      sortOrder: true,
      entitlementRules: {
        where: { isActive: true },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
        select: {
          entitlementType: true,
          entitlementScope: true,
          quantity: true,
        },
      },
      prices: {
        where: { isActive: true, isArchived: false },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
        select: {
          id: true,
          name: true,
          priceType: true,
          currencyCode: true,
          unitAmountMinor: true,
          billingInterval: true,
          billingIntervalCount: true,
          stripePriceId: true,
          stripeSyncStatus: true,
        },
      },
    },
  });

  if (!record) {
    return null;
  }

  return {
    ...record,
    isCheckoutReady: isCheckoutReadyCatalogPrice(record.prices[0] ?? null),
  };
}

export async function createAdminPlan(input: {
  actor: CatalogMutationActor;
  name: string;
  description?: string;
  productType: ProductType;
  classPackCreditQuantity?: number;
  isActive: boolean;
  sortOrder: number;
  priceName?: string;
  priceType?: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval?: BillingInterval;
  billingIntervalCount?: number;
}) {
  assertCatalogMutationActor(input.actor);
  const name = input.name.trim();
  const slugBase = generatePlanSlug(name);
  const slug = slugBase || `plan-${Date.now()}`;
  const priceName = input.priceName?.trim() || `${name} Price`;
  const normalizedDescription = toNullable(input.description);
  const normalizedCurrencyCode = input.currencyCode.trim().toUpperCase();
  const pricingShape = assertAdminPlanPriceInput({
    productType: input.productType,
    priceType: input.priceType,
    currencyCode: normalizedCurrencyCode,
    unitAmountMinor: input.unitAmountMinor,
    billingInterval: input.billingInterval,
    billingIntervalCount: input.billingIntervalCount,
  });
  const syncCorrelation = buildDeterministicCorrelation("admin-create", [
    slug,
    name,
    normalizedDescription ?? "",
    input.productType,
    String(input.isActive),
    String(input.sortOrder),
    priceName,
    pricingShape.derivedPriceType,
    normalizedCurrencyCode,
    String(input.unitAmountMinor),
    pricingShape.derivedBillingInterval ?? "none",
    String(pricingShape.derivedBillingIntervalCount ?? 0),
  ]);
  const syncAttemptAt = new Date();

  assertAdminPlanEntitlementInput({
    productType: input.productType,
    classPackCreditQuantity: input.classPackCreditQuantity,
  });

  const created = await prisma.$transaction(
    async (tx) => {
      const createdProduct = await tx.product.create({
        data: {
          name,
          slug,
          description: normalizedDescription,
          productType: input.productType,
          isActive: input.isActive,
          isArchived: false,
          sortOrder: input.sortOrder,
          prices: {
            create: {
              lookupKey: buildDeterministicPriceLookupKey({
                productKey: slug,
                slug,
                priceName,
                correlationKey: syncCorrelation,
                priceType: pricingShape.derivedPriceType,
                currencyCode: normalizedCurrencyCode,
                unitAmountMinor: input.unitAmountMinor,
                billingInterval: pricingShape.derivedBillingInterval,
                billingIntervalCount: pricingShape.derivedBillingIntervalCount,
              }),
              name: priceName,
              priceType: pricingShape.derivedPriceType,
              currencyCode: normalizedCurrencyCode,
              unitAmountMinor: input.unitAmountMinor,
              billingInterval: pricingShape.derivedBillingInterval,
              billingIntervalCount: pricingShape.derivedBillingIntervalCount,
              isActive: true,
              isArchived: false,
              stripeSyncStatus: StripeSyncStatus.PENDING,
              stripeSyncLastAttempt: syncAttemptAt,
              stripeSyncCorrelation: syncCorrelation,
            },
          },
        },
        select: {
          id: true,
          prices: {
            where: { isActive: true, isArchived: false },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true },
          },
        },
      });

      await ensureEntitlementRuleForProduct({
        productId: createdProduct.id,
        productType: input.productType,
        packCreditQuantity: input.classPackCreditQuantity,
        prismaClient: tx,
      });

      await createCatalogAuditLog(tx, {
        actorId: input.actor.actorId,
        actionType: "CATALOG_PRODUCT_CREATE",
        entityType: "Product",
        entityId: createdProduct.id,
        metadata: {
          productType: input.productType,
          isActive: input.isActive,
          ownershipScopeKey: "GLOBAL_CATALOG",
        },
      });

      return createdProduct;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  const activePriceId = created.prices[0]?.id;
  if (activePriceId) {
    const stripeProvision = await provisionPlanOnStripe({
      existingStripeProductId: null,
      productName: name,
      productDescription: normalizedDescription,
      priceName,
      priceType: pricingShape.derivedPriceType,
      currencyCode: normalizedCurrencyCode,
      unitAmountMinor: input.unitAmountMinor,
      billingInterval: pricingShape.derivedBillingInterval,
      billingIntervalCount: pricingShape.derivedBillingIntervalCount,
      syncCorrelation,
    });

    await applyStripeProvisionResultToPrice({
      priceId: activePriceId,
      productId: created.id,
      actorId: input.actor.actorId,
      syncCorrelation,
      provisionResult: stripeProvision,
    });
  }

  return prisma.product.findUnique({ where: { id: created.id } });
}

export async function updateAdminPlan(
  id: string,
  input: {
    actor: CatalogMutationActor;
    name: string;
    description?: string;
    productType: ProductType;
    classPackCreditQuantity?: number;
    isActive: boolean;
    sortOrder: number;
    priceName?: string;
    priceType?: PriceType;
    currencyCode: string;
    unitAmountMinor: number;
    billingInterval?: BillingInterval;
    billingIntervalCount?: number;
  },
) {
  assertCatalogMutationActor(input.actor);
  const name = input.name.trim();
  const slugBase = generatePlanSlug(name);
  const slug = slugBase || `plan-${Date.now()}`;
  const priceName = input.priceName?.trim() || `${name} Price`;
  const normalizedDescription = toNullable(input.description);
  const normalizedCurrencyCode = input.currencyCode.trim().toUpperCase();
  const pricingShape = assertAdminPlanPriceInput({
    productType: input.productType,
    priceType: input.priceType,
    currencyCode: normalizedCurrencyCode,
    unitAmountMinor: input.unitAmountMinor,
    billingInterval: input.billingInterval,
    billingIntervalCount: input.billingIntervalCount,
  });
  const normalizedClassPackCreditQuantity =
    isPackProductType(input.productType) ? input.classPackCreditQuantity ?? 10 : null;
  const syncCorrelation = buildDeterministicCorrelation("admin-update", [
    id,
    slug,
    name,
    normalizedDescription ?? "",
    input.productType,
    String(input.isActive),
    String(input.sortOrder),
    priceName,
    pricingShape.derivedPriceType,
    normalizedCurrencyCode,
    String(input.unitAmountMinor),
    pricingShape.derivedBillingInterval ?? "none",
    String(pricingShape.derivedBillingIntervalCount ?? 0),
  ]);
  const syncAttemptAt = new Date();

  assertAdminPlanEntitlementInput({
    productType: input.productType,
    classPackCreditQuantity: input.classPackCreditQuantity,
  });

  const currentState = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      productType: true,
      isActive: true,
      sortOrder: true,
      entitlementRules: {
        where: { isActive: true },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
        select: { quantity: true },
      },
      prices: {
        where: { isActive: true, isArchived: false },
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          name: true,
          priceType: true,
          currencyCode: true,
          unitAmountMinor: true,
          billingInterval: true,
          billingIntervalCount: true,
          stripePriceId: true,
          stripeSyncStatus: true,
        },
      },
    },
  });

  if (!currentState) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  const activePrice = currentState.prices[0];
  const activeEntitlementRule = currentState.entitlementRules[0] ?? null;
  const isRetryOnSameUnsyncedPrice =
    currentState.name === name &&
    currentState.slug === slug &&
    currentState.description === normalizedDescription &&
    currentState.productType === input.productType &&
    currentState.isActive === input.isActive &&
    currentState.sortOrder === input.sortOrder &&
    activePrice !== undefined &&
    activePrice.name === priceName &&
    activePrice.priceType === pricingShape.derivedPriceType &&
    activePrice.currencyCode === normalizedCurrencyCode &&
    activePrice.unitAmountMinor === input.unitAmountMinor &&
    activePrice.billingInterval === pricingShape.derivedBillingInterval &&
    activePrice.billingIntervalCount === pricingShape.derivedBillingIntervalCount &&
    (activeEntitlementRule?.quantity ?? null) === normalizedClassPackCreditQuantity &&
    activePrice.stripePriceId === null &&
    (activePrice.stripeSyncStatus === StripeSyncStatus.PENDING ||
      activePrice.stripeSyncStatus === StripeSyncStatus.FAILED);
  const isNoopOnSameSyncedPrice =
    currentState.name === name &&
    currentState.slug === slug &&
    currentState.description === normalizedDescription &&
    currentState.productType === input.productType &&
    currentState.isActive === input.isActive &&
    currentState.sortOrder === input.sortOrder &&
    activePrice !== undefined &&
    activePrice.name === priceName &&
    activePrice.priceType === pricingShape.derivedPriceType &&
    activePrice.currencyCode === normalizedCurrencyCode &&
    activePrice.unitAmountMinor === input.unitAmountMinor &&
    activePrice.billingInterval === pricingShape.derivedBillingInterval &&
    activePrice.billingIntervalCount === pricingShape.derivedBillingIntervalCount &&
    (activeEntitlementRule?.quantity ?? null) === normalizedClassPackCreditQuantity &&
    activePrice.stripePriceId !== null &&
    activePrice.stripeSyncStatus === StripeSyncStatus.SYNCED;

  if (isNoopOnSameSyncedPrice) {
    return prisma.product.findUnique({ where: { id } });
  }

  const latestStripePrice = await prisma.price.findFirst({
    where: {
      productId: id,
      stripePriceId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { stripePriceId: true },
  });

  const existingStripeProductId = latestStripePrice?.stripePriceId
    ? await resolveStripeProductIdFromPrice(latestStripePrice.stripePriceId)
    : null;

  const result = isRetryOnSameUnsyncedPrice
    ? await prisma.price.update({
        where: { id: activePrice!.id },
        data: {
          stripeSyncStatus: StripeSyncStatus.PENDING,
          stripeSyncLastAttempt: syncAttemptAt,
          stripeSyncCorrelation: syncCorrelation,
          stripeSyncErrorCode: null,
          stripeSyncError: null,
        },
        select: { id: true },
      })
    : await prisma.$transaction(
        async (tx) => {
          const wasActive = currentState.isActive;
          await tx.product.update({
            where: { id },
            data: {
              name,
              slug,
              description: normalizedDescription,
              productType: input.productType,
              isActive: input.isActive,
              sortOrder: input.sortOrder,
            },
          });

          await tx.price.updateMany({
            where: {
              productId: id,
              isActive: true,
              isArchived: false,
            },
            data: {
              isActive: false,
            },
          });

          const lookupKey = buildDeterministicPriceLookupKey({
            productKey: id,
            slug,
            priceName,
            correlationKey: syncCorrelation,
            priceType: pricingShape.derivedPriceType,
            currencyCode: normalizedCurrencyCode,
            unitAmountMinor: input.unitAmountMinor,
            billingInterval: pricingShape.derivedBillingInterval,
            billingIntervalCount: pricingShape.derivedBillingIntervalCount,
          });

          const buildPriceCreateInput = (nextLookupKey: string) => ({
            productId: id,
            lookupKey: nextLookupKey,
            name: priceName,
            priceType: pricingShape.derivedPriceType,
            currencyCode: normalizedCurrencyCode,
            unitAmountMinor: input.unitAmountMinor,
            billingInterval: pricingShape.derivedBillingInterval,
            billingIntervalCount: pricingShape.derivedBillingIntervalCount,
            isActive: true,
            isArchived: false,
            stripeSyncStatus: StripeSyncStatus.PENDING,
            stripeSyncLastAttempt: syncAttemptAt,
            stripeSyncCorrelation: syncCorrelation,
          });
          const existingLookup = await tx.price.findFirst({
            where: { lookupKey, productId: id },
            select: { id: true, stripePriceId: true },
          });

          const createdPrice =
            existingLookup && existingLookup.stripePriceId === null
              ? await tx.price.update({
                  where: { id: existingLookup.id },
                  data: {
                    ...buildPriceCreateInput(lookupKey),
                    stripeSyncErrorCode: null,
                    stripeSyncError: null,
                  },
                  select: { id: true },
                })
              : await tx.price.create({
                  data: buildPriceCreateInput(
                    existingLookup ? `${lookupKey}-${randomUUID().slice(0, 8)}` : lookupKey,
                  ),
                  select: { id: true },
                });

          await ensureEntitlementRuleForProduct({
            productId: id,
            productType: input.productType,
            packCreditQuantity: input.classPackCreditQuantity,
            prismaClient: tx,
          });

          await createCatalogAuditLog(tx, {
            actorId: input.actor.actorId,
            actionType: "CATALOG_PRODUCT_UPDATE",
            entityType: "Product",
            entityId: id,
            metadata: {
              previousIsActive: wasActive,
              nextIsActive: input.isActive,
              productType: input.productType,
              ownershipScopeKey: "GLOBAL_CATALOG",
            },
          });

          if (!wasActive && input.isActive) {
            await createCatalogAuditLog(tx, {
              actorId: input.actor.actorId,
              actionType: "CATALOG_PRODUCT_ACTIVATE",
              entityType: "Product",
              entityId: id,
              metadata: {
                ownershipScopeKey: "GLOBAL_CATALOG",
              },
            });
          } else if (wasActive && !input.isActive) {
            await createCatalogAuditLog(tx, {
              actorId: input.actor.actorId,
              actionType: "CATALOG_PRODUCT_DEACTIVATE",
              entityType: "Product",
              entityId: id,
              metadata: {
                ownershipScopeKey: "GLOBAL_CATALOG",
              },
            });
          }

          return createdPrice;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

  const stripeProvision = await provisionPlanOnStripe({
    existingStripeProductId,
    productName: name,
    productDescription: normalizedDescription,
    priceName,
    priceType: pricingShape.derivedPriceType,
    currencyCode: normalizedCurrencyCode,
    unitAmountMinor: input.unitAmountMinor,
    billingInterval: pricingShape.derivedBillingInterval,
    billingIntervalCount: pricingShape.derivedBillingIntervalCount,
    syncCorrelation,
  });

  await applyStripeProvisionResultToPrice({
    priceId: result.id,
    productId: id,
    actorId: input.actor.actorId,
    syncCorrelation,
    provisionResult: stripeProvision,
  });

  return prisma.product.findUnique({ where: { id } });
}
function parseTimeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hour * 60 + minute;
}
const UPCOMING_BOOKED_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
];

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const now = new Date();
  const upcomingSessions = await prisma.studioSession.findMany({
    where: {
      startsAt: { gt: now },
      status: StudioSessionStatus.SCHEDULED,
    },
    orderBy: [{ startsAt: "asc" }],
    take: 20,
    select: {
      id: true,
      title: true,
      startsAt: true,
      capacity: true,
      bookings: {
        where: {
          status: {
            in: UPCOMING_BOOKED_STATUSES,
          },
        },
        select: {
          id: true,
        },
      },
    },
  });

  return {
    upcomingSessions: upcomingSessions.map((session) => ({
      id: session.id,
      title: session.title,
      startsAt: session.startsAt.toISOString(),
      bookedSpots: session.bookings.length,
      capacity: session.capacity,
    })),
  };
}

export async function getAdminClassesData(): Promise<AdminClassItem[]> {
  const classes = await prisma.classType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      defaultCapacity: true,
      isActive: true,
      isVisible: true,
      sortOrder: true,
      templates: {
        orderBy: [{ createdAt: "asc" }],
        take: 1,
        select: {
          defaultTeacher: {
            select: {
              name: true,
            },
          },
        },
      },
      category: {
        select: {
          name: true,
        },
      },
    },
  });

  return classes.map((item) => ({
    id: item.id,
    name: item.name,
    categoryName: item.category.name,
    defaultTeacherName: item.templates[0]?.defaultTeacher?.name ?? null,
    defaultCapacity: item.defaultCapacity,
    isActive: item.isActive,
    isVisible: item.isVisible,
    sortOrder: item.sortOrder,
  }));
}

export async function getAdminClassById(id: string) {
  const timeZone = await getSiteTimeZone();
  const classType = await prisma.classType.findUnique({
    where: { id },
    select: {
      id: true,
      categoryId: true,
      name: true,
      slug: true,
      imageUrl: true,
      description: true,
      defaultDurationMinutes: true,
      defaultCapacity: true,
      isActive: true,
      isVisible: true,
      sortOrder: true,
      templates: {
        orderBy: [{ createdAt: "asc" }],
        take: 1,
        select: {
          id: true,
          defaultTeacherId: true,
          defaultDurationMinutes: true,
          recurringRules: {
            where: { isActive: true },
            orderBy: [{ weekday: "asc" }],
            select: {
              weekday: true,
              startTime: true,
              startDate: true,
              endDate: true,
            },
          },
          studioSessions: {
            where: {
              status: StudioSessionStatus.SCHEDULED,
              startsAt: {
                gte: new Date(),
              },
            },
            orderBy: [{ startsAt: "asc" }],
            take: 1,
            select: {
              startsAt: true,
              endsAt: true,
            },
          },
        },
      },
    },
  });

  if (!classType) {
    return null;
  }

  const template = classType.templates[0] ?? null;
  const recurringRules = template?.recurringRules ?? [];
  const nextSession = template?.studioSessions[0] ?? null;
  const startTime = nextSession
    ? formatTimeString(nextSession.startsAt, timeZone)
    : (recurringRules[0]?.startTime ?? "18:00");
  const defaultDuration =
    template?.defaultDurationMinutes ?? classType.defaultDurationMinutes;
  const endTime = addMinutesToTimeString(startTime, defaultDuration);
  const isRecurring = recurringRules.length > 0;
  const defaultDate = nextSession?.startsAt
    ? getSiteDateKey(nextSession.startsAt, timeZone)
    : isRecurring
      ? (recurringRules[0]?.startDate ? getSiteDateKey(recurringRules[0].startDate, timeZone) : null)
      : null;

  const schedule: AdminClassScheduleConfig = {
    defaultTeacherId: template?.defaultTeacherId ?? "",
    startTime,
    endTime,
    isRecurring,
    date: defaultDate,
    weekdays: [...new Set(recurringRules.map((rule) => rule.weekday))],
    endDate: recurringRules[0]?.endDate ? getSiteDateKey(recurringRules[0].endDate, timeZone) : null,
  };
  const imageRenderState = await getClassImageRenderState(classType.imageUrl);

  return {
    id: classType.id,
    categoryId: classType.categoryId,
    name: classType.name,
    slug: classType.slug,
    imageUrl: imageRenderState.src,
    description: classType.description,
    defaultDurationMinutes: classType.defaultDurationMinutes,
    defaultCapacity: classType.defaultCapacity,
    isActive: classType.isActive,
    isVisible: classType.isVisible,
    sortOrder: classType.sortOrder,
    schedule,
  };
}

function formatTimeString(date: Date, timeZone: string): string {
  return getSiteTimeLabel(date, timeZone);
}

function addMinutesToTimeString(time: string, amount: number): string {
  const [hour, minute] = time.split(":").map((item) => Number.parseInt(item, 10));
  const total = hour * 60 + minute + amount;
  const normalized = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const endHour = Math.floor(normalized / 60);
  const endMinute = normalized % 60;
  return `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
}

export async function getAdminClassScheduleOptions() {
  return prisma.user.findMany({
    where: {
      role: {
        in: [Role.TEACHER, Role.ADMIN, Role.MASTER_ADMIN],
      },
      isActive: true,
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
    },
  });
}

export async function getClassCategoryOptions() {
  return prisma.classCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

export async function getAdminClassCategoriesData(): Promise<AdminClassCategoryItem[]> {
  const categories = await prisma.classCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      isActive: true,
      sortOrder: true,
      _count: {
        select: {
          classTypes: true,
        },
      },
    },
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    isActive: category.isActive,
    sortOrder: category.sortOrder,
    serviceCount: category._count.classTypes,
  }));
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function normalizeClassImagePath(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return assertCanonicalMediaPublicPath(trimmed, ["classes"]);
}

export async function getAdminClassCategoryById(id: string) {
  return prisma.classCategory.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      sortOrder: true,
    },
  });
}

async function getClassImageRenderState(imageUrl: string | null) {
  const renderState = await getCanonicalMediaRenderState(imageUrl, { allowedFolders: ["classes"] });
  return renderState;
}

async function buildUniqueClassSlug(name: string, excludeClassTypeId?: string): Promise<string> {
  const base = generatePlanSlug(name) || "service";
  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = await prisma.classType.findFirst({
      where: {
        slug: candidate,
        ...(excludeClassTypeId ? { id: { not: excludeClassTypeId } } : {}),
      },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }

    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

export async function createAdminClassCategory(input: {
  name: string;
  description?: string;
  isActive: boolean;
  sortOrder: number;
}) {
  const name = input.name.trim();
  const base = generatePlanSlug(name) || "category";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      return await prisma.classCategory.create({
        data: {
          name,
          slug,
          description: toNullable(input.description),
          isActive: input.isActive,
          sortOrder: input.sortOrder,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }
  }

  throw new Error("CATEGORY_SLUG_UNAVAILABLE");
}

export async function createAdminClass(input: {
  categoryId: string;
  name: string;
  imageUrl?: string | null;
  description?: string;
  defaultDurationMinutes: number;
  defaultCapacity: number;
  isActive: boolean;
  isVisible: boolean;
  sortOrder: number;
}) {
  const category = await prisma.classCategory.findUniqueOrThrow({ where: { id: input.categoryId }, select: { slug: true } });

  const serviceScope = resolveEntitlementScopeFromCategorySlug(category.slug);
  const base = generatePlanSlug(input.name) || "service";
  const imageUrl = normalizeClassImagePath(input.imageUrl);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      return await prisma.classType.create({
        data: {
          categoryId: input.categoryId,
          name: input.name.trim(),
          slug,
          imageUrl,
          description: toNullable(input.description),
          defaultDurationMinutes: input.defaultDurationMinutes,
          defaultCapacity: input.defaultCapacity,
          isActive: input.isActive,
          isVisible: input.isVisible,
          sortOrder: input.sortOrder,
          serviceScope,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }
  }

  throw new Error("CLASS_SLUG_UNAVAILABLE");
}

export async function updateAdminClass(
  id: string,
  input: {
    categoryId: string;
    name: string;
    imageUrl?: string | null;
    description?: string;
    defaultDurationMinutes: number;
    defaultCapacity: number;
    isActive: boolean;
    isVisible: boolean;
    sortOrder: number;
  },
) {
  const [slug, category] = await Promise.all([
    buildUniqueClassSlug(input.name, id),
    prisma.classCategory.findUniqueOrThrow({ where: { id: input.categoryId }, select: { slug: true } }),
  ]);

  const serviceScope = resolveEntitlementScopeFromCategorySlug(category.slug);
  const imageUrl = input.imageUrl === undefined ? undefined : normalizeClassImagePath(input.imageUrl);

  return prisma.classType.update({
    where: { id },
    data: {
      categoryId: input.categoryId,
      name: input.name.trim(),
      slug,
      ...(imageUrl !== undefined ? { imageUrl } : {}),
      description: toNullable(input.description),
      defaultDurationMinutes: input.defaultDurationMinutes,
      defaultCapacity: input.defaultCapacity,
      isActive: input.isActive,
      isVisible: input.isVisible,
      sortOrder: input.sortOrder,
      serviceScope,
    },
  });
}

export async function cleanupAdminClassCreateFailure(classTypeId: string): Promise<void> {
  await prisma.classType.delete({ where: { id: classTypeId } });
}

export async function backfillClassTypeServiceScope(): Promise<{ updatedCount: number }> {
  const nullScopeTypes = await prisma.classType.findMany({
    where: { serviceScope: null },
    select: { id: true, category: { select: { slug: true } } },
  });

  if (nullScopeTypes.length === 0) {
    return { updatedCount: 0 };
  }

  await Promise.all(
    nullScopeTypes.map((ct) =>
      prisma.classType.update({
        where: { id: ct.id },
        data: { serviceScope: resolveEntitlementScopeFromCategorySlug(ct.category.slug) },
      }),
    ),
  );

  return { updatedCount: nullScopeTypes.length };
}

function mapAdminSiteWeeklyScheduleEntry(entry: {
  id: string;
  dayOfWeek: Weekday;
  startTime: string;
  endTime: string;
  serviceId: string | null;
  label: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): AdminSiteWeeklyScheduleEntry {
  return {
    id: entry.id,
    dayOfWeek: entry.dayOfWeek,
    startTime: entry.startTime,
    endTime: entry.endTime,
    serviceId: entry.serviceId,
    label: entry.label,
    displayOrder: entry.displayOrder,
    isActive: entry.isActive,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function normalizeScheduleTime(value: string): string {
  const normalized = value.trim();
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized)) {
    throw new Error("INVALID_SITE_SCHEDULE_TIME");
  }
  return normalized;
}

function validateScheduleTimeRange(startTime: string, endTime: string) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (endMinutes <= startMinutes) {
    throw new Error("INVALID_SITE_SCHEDULE_TIME_RANGE");
  }
}

async function resolveSiteScheduleService(serviceId: string): Promise<{ id: string; name: string }> {
  const normalizedServiceId = serviceId.trim();
  if (!normalizedServiceId) {
    throw new Error("INVALID_SITE_SCHEDULE_SERVICE");
  }

  const classType = await prisma.classType.findUnique({
    where: { id: normalizedServiceId },
    select: {
      id: true,
      name: true,
    },
  });

  if (!classType) {
    throw new Error("CLASS_NOT_FOUND");
  }

  return classType;
}

export async function listAdminSiteScheduleServiceOptions(): Promise<AdminSiteScheduleServiceOption[]> {
  const services = await prisma.classType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
    },
  });

  return services.map((service) => ({
    id: service.id,
    name: service.name,
  }));
}

export async function listAdminSiteWeeklyScheduleEntries(): Promise<AdminSiteWeeklyScheduleEntry[]> {
  const entries = await prisma.siteWeeklyScheduleEntry.findMany({
    orderBy: [{ dayOfWeek: "asc" }, { displayOrder: "asc" }, { startTime: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      dayOfWeek: true,
      startTime: true,
      endTime: true,
      serviceId: true,
      label: true,
      displayOrder: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return entries.map(mapAdminSiteWeeklyScheduleEntry);
}

export async function createAdminSiteWeeklyScheduleEntry(input: {
  dayOfWeek: Weekday;
  startTime: string;
  endTime: string;
  serviceId: string;
  displayOrder: number;
  isActive: boolean;
}): Promise<AdminSiteWeeklyScheduleEntry> {
  const startTime = normalizeScheduleTime(input.startTime);
  const endTime = normalizeScheduleTime(input.endTime);
  validateScheduleTimeRange(startTime, endTime);
  const service = await resolveSiteScheduleService(input.serviceId);

  const created = await prisma.siteWeeklyScheduleEntry.create({
    data: {
      dayOfWeek: input.dayOfWeek,
      startTime,
      endTime,
      serviceId: service.id,
      label: service.name,
      displayOrder: Math.max(0, Math.floor(input.displayOrder)),
      isActive: input.isActive,
    },
    select: {
      id: true,
      dayOfWeek: true,
      startTime: true,
      endTime: true,
      serviceId: true,
      label: true,
      displayOrder: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return mapAdminSiteWeeklyScheduleEntry(created);
}

export async function updateAdminSiteWeeklyScheduleEntry(
  id: string,
  input: {
    dayOfWeek: Weekday;
    startTime: string;
    endTime: string;
    serviceId: string;
    displayOrder: number;
    isActive: boolean;
  },
): Promise<AdminSiteWeeklyScheduleEntry> {
  const startTime = normalizeScheduleTime(input.startTime);
  const endTime = normalizeScheduleTime(input.endTime);
  validateScheduleTimeRange(startTime, endTime);
  const service = await resolveSiteScheduleService(input.serviceId);

  const updated = await prisma.siteWeeklyScheduleEntry.update({
    where: { id },
    data: {
      dayOfWeek: input.dayOfWeek,
      startTime,
      endTime,
      serviceId: service.id,
      label: service.name,
      displayOrder: Math.max(0, Math.floor(input.displayOrder)),
      isActive: input.isActive,
    },
    select: {
      id: true,
      dayOfWeek: true,
      startTime: true,
      endTime: true,
      serviceId: true,
      label: true,
      displayOrder: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return mapAdminSiteWeeklyScheduleEntry(updated);
}

export async function deleteAdminSiteWeeklyScheduleEntry(id: string): Promise<void> {
  await prisma.siteWeeklyScheduleEntry.delete({
    where: { id },
  });
}

export async function getAdminCancellationPeriodHours(): Promise<number> {
  const policy = await prisma.bookingPolicy.findFirst({
    where: {
      scope: "GLOBAL",
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      cancellationCutoffHours: true,
    },
  });

  return normalizeBookingCancellationWindowHours(policy?.cancellationCutoffHours ?? 24);
}

export async function updateAdminCancellationPeriodHours(hours: number): Promise<number> {
  const normalized = Number(hours);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error("INVALID_CANCELLATION_CUTOFF_HOURS");
  }

  const policy = await prisma.bookingPolicy.upsert({
    where: { scope: "GLOBAL" },
    create: {
      scope: "GLOBAL",
      cancellationCutoffHours: normalized,
    },
    update: {
      cancellationCutoffHours: normalized,
    },
    select: {
      cancellationCutoffHours: true,
    },
  });

  return normalizeBookingCancellationWindowHours(policy.cancellationCutoffHours);
}

export async function getAdminSiteTimeZone(): Promise<string> {
  return getSiteTimeZone();
}

export async function updateAdminSiteTimeZone(timeZone: string): Promise<string> {
  return updateSiteTimeZone(timeZone);
}

export type AdminAttendanceWindowPolicy = {
  checkInOpensMinutesBefore: number;
  checkInClosesMinutesAfter: number;
};

export async function getAdminAttendanceWindowPolicy(): Promise<AdminAttendanceWindowPolicy> {
  const policy = await prisma.bookingPolicy.findFirst({
    where: { scope: "GLOBAL" },
    orderBy: { createdAt: "asc" },
    select: {
      checkInOpensMinutesBefore: true,
      checkInClosesMinutesAfter: true,
    },
  });

  return {
    checkInOpensMinutesBefore: policy?.checkInOpensMinutesBefore ?? 15,
    checkInClosesMinutesAfter: policy?.checkInClosesMinutesAfter ?? 10,
  };
}

export async function updateAdminAttendanceWindowPolicy(input: {
  checkInOpensMinutesBefore: number;
  checkInClosesMinutesAfter: number;
}): Promise<AdminAttendanceWindowPolicy> {
  const opens = Number(input.checkInOpensMinutesBefore);
  const closes = Number(input.checkInClosesMinutesAfter);

  if (!Number.isInteger(opens) || opens < 0) {
    throw new Error("INVALID_CHECKIN_OPENS_MINUTES_BEFORE");
  }
  if (!Number.isInteger(closes) || closes < 0) {
    throw new Error("INVALID_CHECKIN_CLOSES_MINUTES_AFTER");
  }

  const policy = await prisma.bookingPolicy.upsert({
    where: { scope: "GLOBAL" },
    create: {
      scope: "GLOBAL",
      cancellationCutoffHours: 24,
      checkInOpensMinutesBefore: opens,
      checkInClosesMinutesAfter: closes,
    },
    update: {
      checkInOpensMinutesBefore: opens,
      checkInClosesMinutesAfter: closes,
    },
    select: {
      checkInOpensMinutesBefore: true,
      checkInClosesMinutesAfter: true,
    },
  });

  return {
    checkInOpensMinutesBefore: policy.checkInOpensMinutesBefore,
    checkInClosesMinutesAfter: policy.checkInClosesMinutesAfter,
  };
}

export async function updateAdminClassImage(input: {
  classTypeId: string;
  imagePath: string;
  adminUserId: string;
}) {
  const imagePath = normalizeClassImagePath(input.imagePath);
  const [classType, adminRecord] = await prisma.$transaction([
    prisma.classType.findUnique({
      where: { id: input.classTypeId },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: input.adminUserId },
      select: { id: true, role: true },
    }),
  ]);

  if (!classType) {
    throw new Error("CLASS_NOT_FOUND");
  }

  if (!adminRecord || (adminRecord.role !== Role.ADMIN && adminRecord.role !== Role.MASTER_ADMIN)) {
    throw new Error("ADMIN_USER_NOT_FOUND");
  }

  return prisma.classType.update({
    where: { id: classType.id },
    data: {
      imageUrl: imagePath,
    },
    select: {
      id: true,
      imageUrl: true,
    },
  });
}

export async function getAdminSubscriptionsData(): Promise<AdminSubscriptionItem[]> {
  const result = await getAdminSubscriptionsPageData({ page: 1, pageSize: 150 });
  return result.items;
}

function addDays(input: Date, amount: number): Date {
  const date = new Date(input);
  date.setDate(date.getDate() + amount);
  return date;
}

function getAdminOrderFilterStart(filter: AdminOrderDateFilter, now: Date): Date | null {
  if (filter === "last7Days") {
    return addDays(now, -7);
  }
  if (filter === "last30Days") {
    return addDays(now, -30);
  }
  if (filter === "last90Days") {
    return addDays(now, -90);
  }
  return null;
}

function getAdminSubscriptionStatus(filter: AdminSubscriptionStatusFilter): SubscriptionStatus | null {
  if (filter === "pending") {
    return SubscriptionStatus.PENDING;
  }
  if (filter === "active") {
    return SubscriptionStatus.ACTIVE;
  }
  if (filter === "cancelled") {
    return SubscriptionStatus.CANCELLED;
  }
  if (filter === "expired") {
    return SubscriptionStatus.EXPIRED;
  }
  if (filter === "pastDue") {
    return SubscriptionStatus.PAST_DUE;
  }
  return null;
}

export async function getAdminOrdersPageData(input: {
  page: number;
  pageSize?: number;
  filter: AdminOrderDateFilter;
  query?: string;
}): Promise<AdminOrdersPageData> {
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));
  const page = Math.max(1, Math.floor(input.page));
  const now = new Date();
  const start = getAdminOrderFilterStart(input.filter, now);
  const query = input.query?.trim() ?? "";
  const skip = (page - 1) * pageSize;

  const where: Prisma.OrderItemWhereInput = {
    order: {
      status: OrderStatus.PAID,
      ...(start ? { placedAt: { gte: start } } : {}),
    },
    ...(query
      ? {
          OR: [
            {
              productNameSnapshot: {
                contains: query,
                mode: "insensitive",
              },
            },
            {
              priceNameSnapshot: {
                contains: query,
                mode: "insensitive",
              },
            },
            {
              order: {
                id: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
            {
              order: {
                client: {
                  name: {
                    contains: query,
                    mode: "insensitive",
                  },
                },
              },
            },
            {
              order: {
                client: {
                  email: {
                    contains: query,
                    mode: "insensitive",
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [totalItems, rows] = await prisma.$transaction([
    prisma.orderItem.count({ where }),
    prisma.orderItem.findMany({
      where,
      orderBy: [{ order: { placedAt: "desc" } }, { createdAt: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        quantity: true,
        productNameSnapshot: true,
        priceNameSnapshot: true,
        lineTotalAmountMinor: true,
        currencyCode: true,
        order: {
          select: {
            id: true,
            placedAt: true,
            client: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    filter: input.filter,
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    items: rows.map((row) => ({
      id: row.id,
      orderId: row.order.id,
      purchasedAt: row.order.placedAt.toISOString(),
      clientName: row.order.client.name,
      clientEmail: row.order.client.email,
      productName: row.productNameSnapshot,
      priceName: row.priceNameSnapshot,
      quantity: row.quantity,
      lineTotalAmountMinor: row.lineTotalAmountMinor,
      currencyCode: row.currencyCode,
    })),
  };
}

export async function getAdminSubscriptionsPageData(input: {
  page: number;
  pageSize?: number;
  filter?: AdminSubscriptionStatusFilter;
  query?: string;
}): Promise<AdminSubscriptionsPageData> {
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));
  const page = Math.max(1, Math.floor(input.page));
  const query = input.query?.trim() ?? "";
  const skip = (page - 1) * pageSize;
  const status = getAdminSubscriptionStatus(input.filter ?? "all");

  const where: Prisma.SubscriptionContractWhereInput = {
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            {
              client: {
                name: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
            {
              client: {
                email: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
            {
              product: {
                name: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
            {
              price: {
                name: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
          ],
        }
      : {}),
  };

  const [totalItems, rows] = await prisma.$transaction([
    prisma.subscriptionContract.count({ where }),
    prisma.subscriptionContract.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        status: true,
        startsAt: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        cancelledAt: true,
        endedAt: true,
        provider: true,
        client: {
          select: {
            name: true,
            email: true,
          },
        },
        product: {
          select: {
            name: true,
          },
        },
        price: {
          select: {
            name: true,
          },
        },
      },
    }),
  ]);

  return {
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    items: rows.map((row) => ({
      id: row.id,
      clientName: row.client.name,
      clientEmail: row.client.email,
      productName: row.product.name,
      priceName: row.price.name,
      status: row.status,
      startsAt: row.startsAt.toISOString(),
      currentPeriodStart: row.currentPeriodStart.toISOString(),
      currentPeriodEnd: row.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      provider: row.provider,
    })),
  };
}

export async function getAdminSubscriptionById(id: string) {
  return prisma.subscriptionContract.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      productId: true,
      priceId: true,
      status: true,
      startsAt: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      cancelledAt: true,
      endedAt: true,
      provider: true,
      providerSubscriptionReference: true,
    },
  });
}

export async function getAdminSubscriptionOptions() {
  const [clients, products, prices] = await prisma.$transaction([
    prisma.user.findMany({
      where: { role: Role.CLIENT },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, email: true },
    }),
    prisma.product.findMany({
      where: { isArchived: false, isActive: true },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.price.findMany({
      where: { isArchived: false, isActive: true },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, productId: true },
    }),
  ]);

  return { clients, products, prices };
}

export async function createAdminSubscription(input: {
  clientId: string;
  productId: string;
  priceId: string;
  status: SubscriptionStatus;
  startsAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  provider: PaymentProvider;
  providerSubscriptionReference?: string;
}) {
  const [client, price] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.clientId }, select: { role: true } }),
    prisma.price.findUnique({ where: { id: input.priceId }, select: { productId: true } }),
  ]);

  if (!client || client.role !== Role.CLIENT) {
    throw new Error("SUBSCRIPTION_CLIENT_ROLE_MISMATCH");
  }

  if (!price || price.productId !== input.productId) {
    throw new Error("PRICE_PRODUCT_MISMATCH");
  }

  return prisma.subscriptionContract.create({
    data: {
      clientId: input.clientId,
      productId: input.productId,
      priceId: input.priceId,
      status: input.status,
      startsAt: input.startsAt,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      provider: input.provider,
      providerSubscriptionReference: toNullable(input.providerSubscriptionReference),
    },
  });
}

export async function updateAdminSubscription(
  id: string,
  input: {
    status: SubscriptionStatus;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    cancelledAt?: Date | null;
    endedAt?: Date | null;
    providerSubscriptionReference?: string;
  },
) {
  const existing = await prisma.subscriptionContract.findUnique({
    where: { id },
    select: { client: { select: { role: true } } },
  });

  if (!existing) {
    throw new Error("SUBSCRIPTION_NOT_FOUND");
  }
  if (existing.client.role !== Role.CLIENT) {
    throw new Error("SUBSCRIPTION_CLIENT_ROLE_MISMATCH");
  }

  return prisma.subscriptionContract.update({
    where: { id },
    data: {
      status: input.status,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      cancelledAt: input.cancelledAt ?? null,
      endedAt: input.endedAt ?? null,
      providerSubscriptionReference: toNullable(input.providerSubscriptionReference),
    },
  });
}

export async function getAdminLearningProgramsData(): Promise<AdminLearningProgramItem[]> {
  const programs = await prisma.learningProgram.findMany({
    orderBy: [{ courseType: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      courseType: true,
      updatedAt: true,
    },
  });

  return programs.map((item) => ({
    ...item,
    updatedAt: item.updatedAt.toISOString(),
  }));
}

export async function getAdminLearningProgramById(id: string) {
  const program = await prisma.learningProgram.findUnique({
    where: { id },
    select: {
      id: true,
      legacyId: true,
      mainDescription: true,
      courseType: true,
      description1: true,
      description2: true,
      description3: true,
      videoPromo: true,
      picture1: true,
      picture2: true,
      picture3: true,
    },
  });

  if (!program) {
    return null;
  }

  const [picture1, picture2, picture3] = await Promise.all([
    getLearningImageRenderPath(program.picture1),
    getLearningImageRenderPath(program.picture2),
    getLearningImageRenderPath(program.picture3),
  ]);

  return {
    ...program,
    picture1,
    picture2,
    picture3,
  };
}

export async function getLearningMediaLibraryOptions() {
  return listLearningMediaLibraryImages();
}

export async function getAdminLearningProgramCourseTypeOptions(): Promise<string[]> {
  const programs = await prisma.learningProgram.findMany({
    select: { courseType: true },
    orderBy: [{ courseType: "asc" }],
  });

  return programs.map((program) => program.courseType);
}

async function getLearningImageRenderPath(path: string | null): Promise<string | null> {
  const renderState = await getCanonicalMediaRenderState(path, { allowedFolders: ["learning"] });
  return renderState.src;
}

export async function updateAdminClassCategory(
  id: string,
  input: {
    name: string;
    description?: string;
    isActive: boolean;
    sortOrder: number;
  },
) {
  return prisma.classCategory.update({
    where: { id },
    data: {
      name: input.name.trim(),
      description: toNullable(input.description),
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
  });
}

export async function createAdminLearningProgram(input: {
  legacyId?: string;
  courseType: string;
  mainDescription?: string;
  description1?: string;
  description2?: string;
  description3?: string;
  videoPromo?: string;
  picture1?: string;
  picture2?: string;
  picture3?: string;
}) {
  const normalizedLegacyId = input.legacyId?.trim() || `program-${randomUUID().replace(/-/g, "")}`;
  return prisma.learningProgram.create({
    data: {
      legacyId: normalizedLegacyId,
      mainDescription: toNullable(input.mainDescription),
      courseType: input.courseType.trim(),
      description1: toNullable(input.description1),
      description2: toNullable(input.description2),
      description3: toNullable(input.description3),
      videoPromo: toNullable(input.videoPromo),
      picture1: assertLearningImagePath(input.picture1, "picture1"),
      picture2: assertLearningImagePath(input.picture2, "picture2"),
      picture3: assertLearningImagePath(input.picture3, "picture3"),
    },
  });
}

export async function updateAdminLearningProgram(
  id: string,
  input: {
    legacyId?: string;
    courseType: string;
    mainDescription?: string;
    description1?: string;
    description2?: string;
    description3?: string;
    videoPromo?: string;
    picture1?: string;
    picture2?: string;
    picture3?: string;
  },
) {
  const normalizedLegacyId = input.legacyId?.trim();
  const normalizedCourseType = input.courseType.trim();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.learningProgram.findUnique({
      where: { id },
      select: { courseType: true },
    });

    const updatedProgram = await tx.learningProgram.update({
      where: { id },
      data: {
        ...(normalizedLegacyId ? { legacyId: normalizedLegacyId } : {}),
        mainDescription: toNullable(input.mainDescription),
        courseType: normalizedCourseType,
        description1: toNullable(input.description1),
        description2: toNullable(input.description2),
        description3: toNullable(input.description3),
        videoPromo: toNullable(input.videoPromo),
        picture1: assertLearningImagePath(input.picture1, "picture1"),
        picture2: assertLearningImagePath(input.picture2, "picture2"),
        picture3: assertLearningImagePath(input.picture3, "picture3"),
      },
      select: { id: true },
    });

    if (existing && existing.courseType !== normalizedCourseType) {
      await tx.learningCourse.updateMany({
        where: { category: existing.courseType },
        data: { category: normalizedCourseType },
      });
    }

    return updatedProgram;
  });
}

export async function cleanupAdminLearningProgramCreateFailure(id: string): Promise<void> {
  await prisma.learningProgram.delete({ where: { id } });
}

export async function getAdminLearningVideosData(): Promise<AdminLearningVideoItem[]> {
  const videos = await prisma.learningCourse.findMany({
    orderBy: [{ category: "asc" }, { priority: "asc" }, { title: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      category: true,
      priority: true,
      updatedAt: true,
    },
  });

  return videos.map((item) => ({
    ...item,
    updatedAt: item.updatedAt.toISOString(),
  }));
}

export async function getAdminOnlineLearningData(): Promise<{
  programs: AdminLearningProgramItem[];
  videos: AdminLearningVideoItem[];
}> {
  const [programs, videos] = await Promise.all([
    getAdminLearningProgramsData(),
    getAdminLearningVideosData(),
  ]);
  return { programs, videos };
}

export async function getAdminLearningVideoById(id: string) {
  return prisma.learningCourse.findUnique({
    where: { id },
    select: {
      id: true,
      legacyId: true,
      title: true,
      description: true,
      shortDescription: true,
      category: true,
      thumbnail: true,
      videoUrl: true,
      priority: true,
    },
  });
}

export async function createAdminLearningVideo(input: {
  legacyId?: string;
  title: string;
  description?: string;
  shortDescription?: string;
  category: string;
  thumbnail?: string;
  videoUrl?: string;
  priority: number;
}) {
  const normalizedLegacyId = input.legacyId?.trim() || `course-${randomUUID().replace(/-/g, "")}`;
  return prisma.learningCourse.create({
    data: {
      legacyId: normalizedLegacyId,
      title: input.title.trim(),
      description: toNullable(input.description),
      shortDescription: toNullable(input.shortDescription),
      category: input.category.trim(),
      thumbnail: assertLearningImagePath(input.thumbnail, "thumbnail"),
      videoUrl: toNullable(input.videoUrl),
      priority: input.priority,
    },
  });
}

export async function updateAdminLearningVideo(
  id: string,
  input: {
    legacyId?: string;
    title: string;
    description?: string;
    shortDescription?: string;
    category: string;
    thumbnail?: string;
    videoUrl?: string;
    priority: number;
  },
) {
  const normalizedLegacyId = input.legacyId?.trim();
  return prisma.learningCourse.update({
    where: { id },
    data: {
      ...(normalizedLegacyId ? { legacyId: normalizedLegacyId } : {}),
      title: input.title.trim(),
      description: toNullable(input.description),
      shortDescription: toNullable(input.shortDescription),
      category: input.category.trim(),
      thumbnail: assertLearningImagePath(input.thumbnail, "thumbnail"),
      videoUrl: toNullable(input.videoUrl),
      priority: input.priority,
    },
  });
}
