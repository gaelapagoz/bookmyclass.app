import {
  BookingPaymentSelection,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  PriceType,
  ProductType,
  SubscriptionStatus,
  type BillingInterval,
  StudioSessionStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { resolveEntitlementScope } from "../booking/entitlement-scope";
import { bookingDraftActiveBookingFilter } from "./booking-draft-service";

type PlanBalance = {
  credits: number | null;
  isUsable: boolean;
  reason: string | null;
};

type ExistingPlanOption = {
  bookingLabel: string;
  createdAt: string;
  displayName: string;
  entitlementId: string;
  entitlementScope: EntitlementScope;
  entitlementType: EntitlementType;
  expiresAt: string | null;
  isUsable: boolean;
  planSource: "CREDITS" | "SUBSCRIPTION";
  priceName: string | null;
  productId: string;
  productName: string;
  reason: string | null;
  remainingCredits: number | null;
};

type NewPlanOption = {
  amountMinor: number;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  bookingLabel: string;
  currencyCode: string;
  displayName: string;
  entitlementScope: EntitlementScope;
  entitlementType: EntitlementType;
  priceId: string;
  priceName: string;
  priceType: PriceType;
  productId: string;
  productName: string;
};

type SingleSessionOption = {
  amountMinor: number;
  bookingLabel: string;
  currencyCode: string;
  displayName: string;
  priceId: string;
  priceName: string;
} | null;

export type BookingPaymentRecommended = {
  entitlementId: string | null;
  mode: BookingPaymentSelection | null;
  priceId: string | null;
  reason: string;
};

export type BookingPaymentOptions = {
  bookingId: string;
  bookingIntent: "SINGLE_BOOKING" | "USE_ENTITLEMENT";
  existingPlans: ExistingPlanOption[];
  newPlanOptions: NewPlanOption[];
  selected: {
    draftAmountMinor: number | null;
    draftCurrencyCode: string | null;
    paymentSelection: BookingPaymentSelection | null;
    selectedEntitlementId: string | null;
    selectedPriceId: string | null;
  };
  singleSession: SingleSessionOption;
  ux: {
    recommended: BookingPaymentRecommended;
    requiresChoice: boolean;
  };
};

export type BookingPaymentOptionsPreview = {
  bookingIntent: "SINGLE_BOOKING" | "USE_ENTITLEMENT";
  existingPlans: ExistingPlanOption[];
  newPlanOptions: NewPlanOption[];
  singleSession: SingleSessionOption;
  ux: {
    recommended: BookingPaymentRecommended;
    requiresChoice: boolean;
  };
};

type PlanSummary = {
  createdAt: string;
  entitlementId: string;
  expiresAt: string | null;
  isUsable: boolean;
  planSource: "CREDITS" | "SUBSCRIPTION";
  priceName: string | null;
  productId: string;
  productName: string;
  reason: string | null;
  remainingCredits: number | null;
};

type BookingForOptions = {
  bookingIntent: "SINGLE_BOOKING" | "USE_ENTITLEMENT";
  clientId: string | null;
  classType: {
    categorySlug: string;
    serviceSlug: string;
    serviceScope: EntitlementScope | null;
  };
  draftAmountMinor: number | null;
  draftCurrencyCode: string | null;
  id: string;
  paymentSelection: BookingPaymentSelection | null;
  selectedEntitlementId: string | null;
  selectedPriceId: string | null;
  status: BookingStatus;
  session: {
    capacity: number;
    startsAt: Date;
    status: StudioSessionStatus;
    isPublished: boolean;
    activeBookingCount: number;
  };
};

type PlanOptionRecord = {
  amountMinor: number;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  bookingLabel: string;
  currencyCode: string;
  displayName: string;
  entitlementScope: EntitlementScope;
  entitlementType: EntitlementType;
  priceId: string;
  priceName: string;
  priceType: PriceType;
  productId: string;
  productName: string;
  productType: ProductType;
};

type SelectPaymentInput =
  | {
      bookingId: string;
      entitlementId: string;
      mode: "EXISTING_PLAN";
      userId: string;
    }
  | {
      bookingId: string;
      mode: "NEW_PLAN_PURCHASE" | "SINGLE_SESSION";
      priceId: string;
      userId: string | null;
    };

type SelectPaymentResult = {
  bookingId: string;
  bookingStatus: BookingStatus;
  draftAmountMinor: number;
  draftCurrencyCode: string;
  paymentSelection: BookingPaymentSelection;
  selectedEntitlementId: string | null;
  selectedPriceId: string | null;
};

type OptionsErrorCode =
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_PENDING"
  | "SESSION_NOT_BOOKABLE"
  | "NOT_AUTHENTICATED"
  | "BOOKING_NOT_OWNED"
  | "PLAN_NOT_FOUND"
  | "PLAN_NOT_USABLE"
  | "PRICE_NOT_ELIGIBLE";

export class BookingPaymentOptionsError extends Error {
  constructor(
    public readonly code: OptionsErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function formatPurchaseOptionDisplayName(input: { productName: string }): string {
  return input.productName;
}

function formatBookingOptionLabel(input: {
  displayName: string;
  mode: "EXISTING_PLAN" | "NEW_PLAN_PURCHASE" | "SINGLE_SESSION";
  amountMinor?: number;
  currencyCode?: string;
}): string {
  if (input.mode === "EXISTING_PLAN") {
    return `Use Existing Plan - ${input.displayName}`;
  }

  if (input.mode === "NEW_PLAN_PURCHASE") {
    const hasPrice = typeof input.amountMinor === "number" && Boolean(input.currencyCode);
    if (hasPrice) {
      const formattedPrice = new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: input.currencyCode!,
        minimumFractionDigits: 2,
      }).format(input.amountMinor! / 100);

      return `Buy a Plan - ${input.displayName} (${formattedPrice})`;
    }

    return `Buy a Plan - ${input.displayName}`;
  }

  if (input.mode === "SINGLE_SESSION") {
    const hasPrice = typeof input.amountMinor === "number" && Boolean(input.currencyCode);
    if (hasPrice) {
      const formattedPrice = new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: input.currencyCode!,
        minimumFractionDigits: 2,
      }).format(input.amountMinor! / 100);

      return `Single Session - ${input.displayName} (${formattedPrice})`;
    }

    return `Single Session - ${input.displayName}`;
  }

  return input.displayName;
}

function isScopeCompatible(params: {
  entitlementScope: EntitlementScope;
  requiredScope: EntitlementScope;
}) {
  const { entitlementScope, requiredScope } = params;

  if (entitlementScope === EntitlementScope.ALL_CLASSES) {
    return true;
  }

  return entitlementScope === requiredScope;
}

async function getBookingForOptions(bookingId: string): Promise<BookingForOptions | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      clientId: true,
      status: true,
      bookingIntent: true,
      paymentSelection: true,
      selectedEntitlementId: true,
      selectedPriceId: true,
      draftAmountMinor: true,
      draftCurrencyCode: true,
      studioSession: {
        select: {
          capacity: true,
          startsAt: true,
          status: true,
          isPublished: true,
          bookings: {
            where: bookingDraftActiveBookingFilter(),
            select: { id: true },
          },
          classType: {
            select: {
              slug: true,
              serviceScope: true,
              category: {
                select: {
                  slug: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!booking) {
    return null;
  }

  return {
    id: booking.id,
    clientId: booking.clientId,
    status: booking.status,
    bookingIntent: booking.bookingIntent,
    paymentSelection: booking.paymentSelection,
    selectedEntitlementId: booking.selectedEntitlementId,
    selectedPriceId: booking.selectedPriceId,
    draftAmountMinor: booking.draftAmountMinor,
    draftCurrencyCode: booking.draftCurrencyCode,
    session: {
      capacity: booking.studioSession.capacity,
      startsAt: booking.studioSession.startsAt,
      status: booking.studioSession.status,
      isPublished: booking.studioSession.isPublished,
      activeBookingCount: booking.studioSession.bookings.length,
    },
    classType: {
      serviceSlug: booking.studioSession.classType.slug,
      categorySlug: booking.studioSession.classType.category.slug,
      serviceScope: booking.studioSession.classType.serviceScope,
    },
  };
}

async function getServiceScopeInfo(
  serviceSlug: string,
): Promise<{ categorySlug: string; serviceScope: EntitlementScope | null } | null> {
  const classType = await prisma.classType.findUnique({
    where: { slug: serviceSlug },
    select: {
      serviceScope: true,
      category: {
        select: {
          slug: true,
        },
      },
    },
  });

  if (!classType) return null;
  return { categorySlug: classType.category.slug, serviceScope: classType.serviceScope };
}

function isEntitlementActive(expiresAt: Date | null): boolean {
  return !expiresAt || expiresAt > new Date();
}

async function getCreditBalancesByEntitlementIds(entitlementIds: string[]): Promise<Map<string, number>> {
  const uniqueEntitlementIds = Array.from(new Set(entitlementIds.filter((entitlementId) => entitlementId.length > 0)));
  if (uniqueEntitlementIds.length === 0) {
    return new Map();
  }

  const groupedBalances = await prisma.creditLedgerEntry.groupBy({
    by: ["entitlementId"],
    where: {
      entitlementId: {
        in: uniqueEntitlementIds,
      },
    },
    _sum: {
      amount: true,
    },
  });

  return new Map(
    groupedBalances
      .filter((entry): entry is typeof entry & { entitlementId: string } => Boolean(entry.entitlementId))
      .map((entry) => [entry.entitlementId, entry._sum.amount ?? 0]),
  );
}

async function getPlanBalance(input: {
  entitlementId: string;
  entitlementType: EntitlementType;
  isActive: boolean;
  creditBalancesByEntitlementId?: Map<string, number>;
}): Promise<PlanBalance> {
  if (!input.isActive) {
    return {
      credits: null,
      isUsable: false,
      reason: "Plan is expired.",
    };
  }

  if (
    input.entitlementType === EntitlementType.CREDIT_PACK ||
    input.entitlementType === EntitlementType.SINGLE_USE
  ) {
    const balance = input.creditBalancesByEntitlementId?.get(input.entitlementId) ?? 0;

    if (balance <= 0) {
      return {
        credits: balance,
        isUsable: false,
        reason: "Insufficient credits.",
      };
    }

    return {
      credits: balance,
      isUsable: true,
      reason: null,
    };
  }

  return {
    credits: null,
    isUsable: true,
    reason: null,
  };
}

function planPriority(option: ExistingPlanOption): number {
  if (option.planSource === "SUBSCRIPTION") {
    return 2;
  }

  if (option.entitlementType === EntitlementType.CREDIT_PACK || option.entitlementType === EntitlementType.SINGLE_USE) {
    return 0;
  }

  return 1;
}

function sortExistingPlans(options: ExistingPlanOption[]): ExistingPlanOption[] {
  return [...options].sort((a, b) => {
    const priorityDelta = planPriority(a) - planPriority(b);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const aIsCreditPlan =
      a.entitlementType === EntitlementType.CREDIT_PACK || a.entitlementType === EntitlementType.SINGLE_USE;
    const bIsCreditPlan =
      b.entitlementType === EntitlementType.CREDIT_PACK || b.entitlementType === EntitlementType.SINGLE_USE;

    if (aIsCreditPlan && bIsCreditPlan) {
      const aExpiry = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
      const bExpiry = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
      if (aExpiry !== bExpiry) {
        return aExpiry - bExpiry;
      }

      const createdAtDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (createdAtDelta !== 0) {
        return createdAtDelta;
      }

      return a.entitlementId.localeCompare(b.entitlementId);
    }

    if (a.expiresAt && b.expiresAt) {
      return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
    }

    if (a.expiresAt && !b.expiresAt) {
      return -1;
    }

    if (!a.expiresAt && b.expiresAt) {
      return 1;
    }

    return a.productName.localeCompare(b.productName);
  });
}

async function getExistingPlansByUserAndScope(params: {
  requiredScope: EntitlementScope;
  userId: string;
}): Promise<ExistingPlanOption[]> {
  const entitlements = await prisma.clientEntitlement.findMany({
    where: {
      clientId: params.userId,
      status: ClientEntitlementStatus.ACTIVE,
      entitlementScope: {
        in: [params.requiredScope, EntitlementScope.ALL_CLASSES],
      },
    },
    select: {
      id: true,
      createdAt: true,
      entitlementType: true,
      entitlementScope: true,
      expiresAt: true,
      subscriptionContractId: true,
      product: {
        select: {
          id: true,
          name: true,
          prices: {
            where: { isActive: true, isArchived: false },
            orderBy: { updatedAt: "desc" },
            select: { name: true },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ expiresAt: "asc" }, { updatedAt: "desc" }],
  });

  const creditBalancesByEntitlementId = await getCreditBalancesByEntitlementIds(
    entitlements
      .filter(
        (entitlement) =>
          entitlement.entitlementType === EntitlementType.CREDIT_PACK ||
          entitlement.entitlementType === EntitlementType.SINGLE_USE,
      )
      .map((entitlement) => entitlement.id),
  );

  const options = await Promise.all(
    entitlements.map(async (entitlement) => {
      const active = isEntitlementActive(entitlement.expiresAt);
      const balance = await getPlanBalance({
        entitlementId: entitlement.id,
        entitlementType: entitlement.entitlementType,
        isActive: active,
        creditBalancesByEntitlementId,
      });

      return {
        bookingLabel: formatBookingOptionLabel({
          mode: "EXISTING_PLAN",
          displayName: formatPurchaseOptionDisplayName({ productName: entitlement.product.name }),
        }),
        createdAt: entitlement.createdAt.toISOString(),
        displayName: formatPurchaseOptionDisplayName({ productName: entitlement.product.name }),
        entitlementId: entitlement.id,
        entitlementType: entitlement.entitlementType,
        entitlementScope: entitlement.entitlementScope,
        planSource:
          entitlement.entitlementType === EntitlementType.CREDIT_PACK ||
          entitlement.entitlementType === EntitlementType.SINGLE_USE
            ? "CREDITS"
            : "SUBSCRIPTION",
        productId: entitlement.product.id,
        productName: entitlement.product.name,
        priceName: entitlement.product.prices[0]?.name ?? null,
        expiresAt: entitlement.expiresAt?.toISOString() ?? null,
        remainingCredits: balance.credits,
        isUsable: balance.isUsable,
        reason: balance.reason,
      } satisfies ExistingPlanOption;
    }),
  );

  const usableEntitlementOptions = options.filter((option) => option.isUsable);
  const coveredSubscriptionIds = new Set(
    entitlements
      .map((entitlement) => entitlement.subscriptionContractId)
      .filter((subscriptionContractId): subscriptionContractId is string => Boolean(subscriptionContractId)),
  );

  const now = new Date();
  const activeSubscriptions = await prisma.subscriptionContract.findMany({
    where: {
      clientId: params.userId,
      status: SubscriptionStatus.ACTIVE,
      startsAt: { lte: now },
      currentPeriodStart: { lte: now },
      currentPeriodEnd: { gt: now },
      OR: [{ endedAt: null }, { endedAt: { gt: now } }],
      product: {
        entitlementRules: {
          some: {
            isActive: true,
            entitlementScope: {
              in: [params.requiredScope, EntitlementScope.ALL_CLASSES],
            },
            entitlementType: EntitlementType.UNLIMITED_ACCESS,
          },
        },
      },
    },
    select: {
      id: true,
      createdAt: true,
      currentPeriodEnd: true,
      product: {
        select: {
          id: true,
          name: true,
        },
      },
      price: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ currentPeriodEnd: "asc" }, { updatedAt: "desc" }],
  });

  const subscriptionOptions: ExistingPlanOption[] = activeSubscriptions
    .filter((subscription) => !coveredSubscriptionIds.has(subscription.id))
    .map((subscription) => ({
      bookingLabel: formatBookingOptionLabel({
        mode: "EXISTING_PLAN",
        displayName: formatPurchaseOptionDisplayName({ productName: subscription.product.name }),
      }),
      createdAt: subscription.createdAt.toISOString(),
      displayName: formatPurchaseOptionDisplayName({ productName: subscription.product.name }),
      entitlementId: `subscription:${subscription.id}`,
      entitlementType: EntitlementType.UNLIMITED_ACCESS,
      entitlementScope: EntitlementScope.ALL_CLASSES,
      planSource: "SUBSCRIPTION",
      productId: subscription.product.id,
      productName: subscription.product.name,
      priceName: subscription.price.name,
      expiresAt: subscription.currentPeriodEnd.toISOString(),
      remainingCredits: null,
      isUsable: true,
      reason: null,
    }));

  return sortExistingPlans([...usableEntitlementOptions, ...subscriptionOptions]);
}

type ConsumableCreditEntitlement = {
  id: string;
  entitlementType: EntitlementType;
  entitlementScope: EntitlementScope;
  expiresAt: Date | null;
  createdAt: Date;
  balance: number;
};

async function getNextConsumableCreditEntitlement(input: {
  requiredScope: EntitlementScope;
  userId: string;
}): Promise<ConsumableCreditEntitlement | null> {
  const now = new Date();
  const entitlements = await prisma.clientEntitlement.findMany({
    where: {
      clientId: input.userId,
      status: ClientEntitlementStatus.ACTIVE,
      entitlementType: {
        in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
      },
      entitlementScope: {
        in: [input.requiredScope, EntitlementScope.ALL_CLASSES],
      },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      id: true,
      createdAt: true,
      entitlementType: true,
      entitlementScope: true,
      expiresAt: true,
    },
  });

  const creditBalancesByEntitlementId = await getCreditBalancesByEntitlementIds(
    entitlements.map((entitlement) => entitlement.id),
  );
  const withBalance = entitlements.map((entitlement) => ({
    ...entitlement,
    balance: creditBalancesByEntitlementId.get(entitlement.id) ?? 0,
  }));

  const eligible = withBalance.filter((entitlement) => entitlement.balance > 0);
  if (eligible.length === 0) {
    return null;
  }

  eligible.sort((a, b) => {
    const aExpiry = a.expiresAt ? a.expiresAt.getTime() : Number.POSITIVE_INFINITY;
    const bExpiry = b.expiresAt ? b.expiresAt.getTime() : Number.POSITIVE_INFINITY;
    if (aExpiry !== bExpiry) {
      return aExpiry - bExpiry;
    }

    const createdAtDelta = a.createdAt.getTime() - b.createdAt.getTime();
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }

    return a.id.localeCompare(b.id);
  });

  return eligible[0] ?? null;
}

async function getPlanPurchaseOptions(requiredScope: EntitlementScope): Promise<PlanOptionRecord[]> {
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      isArchived: false,
      productType: {
        in: [
          ProductType.CLASS_PACK,
          ProductType.PRIVATE_PACK,
          ProductType.UNLIMITED_MEMBERSHIP,
          ProductType.DROP_IN_CLASS,
        ],
      },
      entitlementRules: {
        some: {
          isActive: true,
          entitlementScope: {
            in: [requiredScope, EntitlementScope.ALL_CLASSES],
          },
          entitlementType: {
            in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE, EntitlementType.UNLIMITED_ACCESS],
          },
        },
      },
      prices: {
        some: {
          isActive: true,
          isArchived: false,
        },
      },
    },
    select: {
      id: true,
      name: true,
      productType: true,
      entitlementRules: {
        where: {
          isActive: true,
          entitlementScope: {
            in: [requiredScope, EntitlementScope.ALL_CLASSES],
          },
          entitlementType: {
            in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE, EntitlementType.UNLIMITED_ACCESS],
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          entitlementType: true,
          entitlementScope: true,
        },
      },
      prices: {
        where: {
          isActive: true,
          isArchived: false,
        },
        orderBy: [{ priceType: "asc" }, { unitAmountMinor: "asc" }],
        select: {
          id: true,
          name: true,
          priceType: true,
          unitAmountMinor: true,
          currencyCode: true,
          billingInterval: true,
          billingIntervalCount: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return products.flatMap((product) => {
    const rule = product.entitlementRules[0];

    if (!rule) {
      return [];
    }

    return product.prices.map((price) => ({
      bookingLabel: formatBookingOptionLabel({
        mode: "NEW_PLAN_PURCHASE",
        displayName: formatPurchaseOptionDisplayName({ productName: product.name }),
        amountMinor: price.unitAmountMinor,
        currencyCode: price.currencyCode,
      }),
      displayName: formatPurchaseOptionDisplayName({ productName: product.name }),
      productId: product.id,
      productName: product.name,
      productType: product.productType,
      priceId: price.id,
      priceName: price.name,
      priceType: price.priceType,
      amountMinor: price.unitAmountMinor,
      currencyCode: price.currencyCode,
      billingInterval: price.billingInterval,
      billingIntervalCount: price.billingIntervalCount,
      entitlementType: rule.entitlementType,
      entitlementScope: rule.entitlementScope,
    }));
  });
}

async function getSingleSessionOptionByScope(requiredScope: EntitlementScope): Promise<SingleSessionOption> {
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      isArchived: false,
      productType: ProductType.DROP_IN_CLASS,
      entitlementRules: {
        some: {
          isActive: true,
          entitlementScope: {
            in: [requiredScope, EntitlementScope.ALL_CLASSES],
          },
          entitlementType: {
            in: [EntitlementType.SINGLE_USE, EntitlementType.CREDIT_PACK],
          },
        },
      },
      prices: {
        some: {
          isActive: true,
          isArchived: false,
          priceType: PriceType.ONE_TIME,
        },
      },
    },
    select: {
      name: true,
      prices: {
        where: {
          isActive: true,
          isArchived: false,
          priceType: PriceType.ONE_TIME,
        },
        orderBy: [{ unitAmountMinor: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          unitAmountMinor: true,
          currencyCode: true,
        },
        take: 1,
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 1,
  });

  const product = products[0];
  const price = product?.prices[0];
  if (!product || !price) {
    return null;
  }

  return {
    bookingLabel: formatBookingOptionLabel({
      mode: "SINGLE_SESSION",
      displayName: formatPurchaseOptionDisplayName({ productName: product.name }),
      amountMinor: price.unitAmountMinor,
      currencyCode: price.currencyCode,
    }),
    priceId: price.id,
    displayName: formatPurchaseOptionDisplayName({ productName: product.name }),
    priceName: price.name,
    amountMinor: price.unitAmountMinor,
    currencyCode: price.currencyCode,
  };
}

function assertPendingBooking(booking: BookingForOptions | null): asserts booking is BookingForOptions {
  if (!booking) {
    throw new BookingPaymentOptionsError("BOOKING_NOT_FOUND", "Booking draft not found.");
  }

  if (booking.status !== BookingStatus.PENDING) {
    throw new BookingPaymentOptionsError("BOOKING_NOT_PENDING", "Booking draft is not pending.");
  }
}

function assertSessionStillBookable(booking: BookingForOptions) {
  if (
    booking.session.status !== StudioSessionStatus.SCHEDULED ||
    !booking.session.isPublished ||
    booking.session.startsAt <= new Date()
  ) {
    throw new BookingPaymentOptionsError("SESSION_NOT_BOOKABLE", "This session is no longer bookable.");
  }

  if (booking.session.activeBookingCount > booking.session.capacity) {
    throw new BookingPaymentOptionsError("SESSION_NOT_BOOKABLE", "This session is no longer available.");
  }
}

function assertBookingOwnedByUser(booking: BookingForOptions, userId: string | null) {
  if (!userId) {
    throw new BookingPaymentOptionsError("NOT_AUTHENTICATED", "Authentication required.");
  }

  if (!booking.clientId || booking.clientId !== userId) {
    throw new BookingPaymentOptionsError("BOOKING_NOT_OWNED", "This booking does not belong to the signed-in user.");
  }
}

function toPlanSummary(plan: ExistingPlanOption): PlanSummary {
  return {
    createdAt: plan.createdAt,
    entitlementId: plan.entitlementId,
    productId: plan.productId,
    productName: plan.productName,
    priceName: plan.priceName,
    expiresAt: plan.expiresAt,
    remainingCredits: plan.remainingCredits,
    isUsable: plan.isUsable,
    planSource: plan.planSource,
    reason: plan.reason,
  };
}

function computeRecommendedSelection(input: {
  booking: BookingForOptions;
  existingPlans: ExistingPlanOption[];
  newPlanOptions: NewPlanOption[];
  singleSession: SingleSessionOption;
}): { recommended: BookingPaymentRecommended; requiresChoice: boolean } {
  const { booking, existingPlans, newPlanOptions, singleSession } = input;

  if (booking.paymentSelection === BookingPaymentSelection.EXISTING_PLAN && booking.selectedEntitlementId) {
    return {
      recommended: {
        mode: BookingPaymentSelection.EXISTING_PLAN,
        entitlementId: booking.selectedEntitlementId,
        priceId: null,
        reason: "Using the plan already selected on this booking draft.",
      },
      requiresChoice: false,
    };
  }

  if (
    (booking.paymentSelection === BookingPaymentSelection.SINGLE_SESSION ||
      booking.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE) &&
    booking.selectedPriceId
  ) {
    return {
      recommended: {
        mode: booking.paymentSelection,
        entitlementId: null,
        priceId: booking.selectedPriceId,
        reason: "Using the payment option already selected on this booking draft.",
      },
      requiresChoice: false,
    };
  }

  if (existingPlans.length > 0) {
    const preferredPlan = existingPlans[0];
    return {
      recommended: {
        mode: BookingPaymentSelection.EXISTING_PLAN,
        entitlementId: preferredPlan?.entitlementId ?? null,
        priceId: null,
        reason:
          preferredPlan?.planSource === "CREDITS"
            ? "An eligible credit plan is preselected."
            : "An active membership is preselected.",
      },
      requiresChoice: existingPlans.length > 1,
    };
  }

  if (newPlanOptions.length > 0) {
    return {
      recommended: {
        mode: BookingPaymentSelection.NEW_PLAN_PURCHASE,
        entitlementId: null,
        priceId: newPlanOptions[0]?.priceId ?? null,
        reason: "No eligible active plan found; a plan purchase is preselected.",
      },
      requiresChoice: false,
    };
  }

  if (singleSession) {
    return {
      recommended: {
        mode: BookingPaymentSelection.SINGLE_SESSION,
        entitlementId: null,
        priceId: singleSession.priceId,
        reason: "No eligible active plan found; single-session payment is preselected.",
      },
      requiresChoice: false,
    };
  }

  return {
    recommended: {
      mode: null,
      entitlementId: null,
      priceId: null,
      reason: "No valid payment path is currently available.",
    },
    requiresChoice: true,
  };
}

function buildBookingCreditLedgerIdempotencyKey(input: {
  type: "CONSUME";
  clientId: string;
  entitlementId: string;
  bookingId: string;
}): string {
  return ["booking-existing-plan", input.type, input.clientId, input.entitlementId, input.bookingId].join(":");
}

export async function getMyActivePlans(userId: string): Promise<PlanSummary[]> {
  const entitlements = await prisma.clientEntitlement.findMany({
    where: {
      clientId: userId,
      status: ClientEntitlementStatus.ACTIVE,
    },
    select: {
      id: true,
      createdAt: true,
      entitlementType: true,
      entitlementScope: true,
      expiresAt: true,
      product: {
        select: {
          id: true,
          name: true,
          prices: {
            where: { isActive: true, isArchived: false },
            orderBy: { updatedAt: "desc" },
            select: { name: true },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ expiresAt: "asc" }, { updatedAt: "desc" }],
  });

  const creditBalancesByEntitlementId = await getCreditBalancesByEntitlementIds(
    entitlements
      .filter(
        (entitlement) =>
          entitlement.entitlementType === EntitlementType.CREDIT_PACK ||
          entitlement.entitlementType === EntitlementType.SINGLE_USE,
      )
      .map((entitlement) => entitlement.id),
  );

  const plans = await Promise.all(
    entitlements.map(async (entitlement) => {
      const balance = await getPlanBalance({
        entitlementId: entitlement.id,
        entitlementType: entitlement.entitlementType,
        isActive: isEntitlementActive(entitlement.expiresAt),
        creditBalancesByEntitlementId,
      });

      return {
        bookingLabel: formatBookingOptionLabel({
          mode: "EXISTING_PLAN",
          displayName: formatPurchaseOptionDisplayName({ productName: entitlement.product.name }),
        }),
        createdAt: entitlement.createdAt.toISOString(),
        displayName: formatPurchaseOptionDisplayName({ productName: entitlement.product.name }),
        entitlementId: entitlement.id,
        entitlementType: entitlement.entitlementType,
        entitlementScope: entitlement.entitlementScope,
        planSource:
          entitlement.entitlementType === EntitlementType.CREDIT_PACK ||
          entitlement.entitlementType === EntitlementType.SINGLE_USE
            ? "CREDITS"
            : "SUBSCRIPTION",
        productId: entitlement.product.id,
        productName: entitlement.product.name,
        priceName: entitlement.product.prices[0]?.name ?? null,
        expiresAt: entitlement.expiresAt?.toISOString() ?? null,
        remainingCredits: balance.credits,
        isUsable: balance.isUsable,
        reason: balance.reason,
      } satisfies ExistingPlanOption;
    }),
  );

  return plans.filter((plan) => plan.isUsable).map(toPlanSummary);
}

export async function getBookingPaymentOptions(params: {
  bookingId: string;
  userId: string | null;
}): Promise<BookingPaymentOptions> {
  const booking = await getBookingForOptions(params.bookingId);
  assertPendingBooking(booking);
  assertBookingOwnedByUser(booking, params.userId);
  assertSessionStillBookable(booking);

  const requiredScope = resolveEntitlementScope({ serviceScope: booking.classType.serviceScope, categorySlug: booking.classType.categorySlug });
  const [singleSession, newPlanOptions, existingPlans] = await Promise.all([
    getSingleSessionOptionByScope(requiredScope),
    getPlanPurchaseOptions(requiredScope),
    params.userId
      ? getExistingPlansByUserAndScope({
          userId: params.userId,
          requiredScope,
        })
      : Promise.resolve([]),
  ]);

  const ux = computeRecommendedSelection({
    booking,
    existingPlans,
    newPlanOptions,
    singleSession,
  });

  return {
    bookingId: booking.id,
    bookingIntent: booking.bookingIntent,
    singleSession,
    newPlanOptions,
    existingPlans,
    selected: {
      paymentSelection: booking.paymentSelection,
      selectedEntitlementId: booking.selectedEntitlementId,
      selectedPriceId: booking.selectedPriceId,
      draftAmountMinor: booking.draftAmountMinor,
      draftCurrencyCode: booking.draftCurrencyCode,
    },
    ux,
  };
}

export async function getBookingPaymentOptionsPreview(params: {
  bookingIntent?: "SINGLE_BOOKING" | "USE_ENTITLEMENT";
  serviceSlug: string;
  userId: string | null;
}): Promise<BookingPaymentOptionsPreview> {
  const bookingIntent = params.bookingIntent ?? "USE_ENTITLEMENT";
  const scopeInfo = await getServiceScopeInfo(params.serviceSlug);
  if (!scopeInfo) {
    throw new BookingPaymentOptionsError("BOOKING_NOT_FOUND", "Service was not found.");
  }

  const requiredScope = resolveEntitlementScope({ serviceScope: scopeInfo.serviceScope, categorySlug: scopeInfo.categorySlug });
  const [singleSession, newPlanOptions, existingPlans] = await Promise.all([
    getSingleSessionOptionByScope(requiredScope),
    getPlanPurchaseOptions(requiredScope),
    params.userId
      ? getExistingPlansByUserAndScope({
          userId: params.userId,
          requiredScope,
        })
      : Promise.resolve([]),
  ]);

  const ux = computeRecommendedSelection({
    booking: {
      id: "preview",
      clientId: null,
      status: BookingStatus.PENDING,
      bookingIntent,
      paymentSelection: null,
      selectedEntitlementId: null,
      selectedPriceId: null,
      draftAmountMinor: null,
      draftCurrencyCode: null,
      session: {
        capacity: 0,
        startsAt: new Date(),
        status: StudioSessionStatus.SCHEDULED,
        isPublished: true,
        activeBookingCount: 0,
      },
      classType: {
        serviceSlug: params.serviceSlug,
        categorySlug: scopeInfo.categorySlug,
        serviceScope: scopeInfo.serviceScope,
      },
    },
    existingPlans,
    newPlanOptions,
    singleSession,
  });

  return {
    bookingIntent,
    singleSession,
    newPlanOptions,
    existingPlans,
    ux,
  };
}

async function applyExistingPlanSelection(input: {
  bookingId: string;
  entitlementId: string;
  requiredScope: EntitlementScope;
  userId: string;
}): Promise<SelectPaymentResult> {
  if (input.entitlementId.startsWith("subscription:")) {
    const subscriptionId = input.entitlementId.replace("subscription:", "");
    const now = new Date();
    const subscription = await prisma.subscriptionContract.findFirst({
      where: {
        id: subscriptionId,
        clientId: input.userId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: { lte: now },
        currentPeriodStart: { lte: now },
        currentPeriodEnd: { gt: now },
        OR: [{ endedAt: null }, { endedAt: { gt: now } }],
        product: {
          entitlementRules: {
            some: {
              isActive: true,
              entitlementScope: {
                in: [input.requiredScope, EntitlementScope.ALL_CLASSES],
              },
              entitlementType: EntitlementType.UNLIMITED_ACCESS,
            },
          },
        },
      },
      select: {
        id: true,
        price: {
          select: {
            currencyCode: true,
          },
        },
      },
    });

    if (!subscription) {
      throw new BookingPaymentOptionsError("PLAN_NOT_USABLE", "Selected membership is not usable.");
    }

    const booking = await prisma.booking.update({
      where: { id: input.bookingId },
      data: {
        status: BookingStatus.CONFIRMED,
        paymentSelection: BookingPaymentSelection.EXISTING_PLAN,
        selectedEntitlementId: null,
        selectedPriceId: null,
        draftAmountMinor: 0,
        draftCurrencyCode: subscription.price.currencyCode,
      },
      select: {
        id: true,
        status: true,
        paymentSelection: true,
        selectedEntitlementId: true,
        selectedPriceId: true,
        draftAmountMinor: true,
        draftCurrencyCode: true,
      },
    });

    return {
      bookingId: booking.id,
      bookingStatus: booking.status,
      paymentSelection: booking.paymentSelection ?? BookingPaymentSelection.EXISTING_PLAN,
      selectedEntitlementId: booking.selectedEntitlementId,
      selectedPriceId: booking.selectedPriceId,
      draftAmountMinor: booking.draftAmountMinor ?? 0,
      draftCurrencyCode: booking.draftCurrencyCode ?? "EUR",
    };
  }

  const entitlement = await prisma.clientEntitlement.findFirst({
    where: {
      id: input.entitlementId,
      clientId: input.userId,
      status: ClientEntitlementStatus.ACTIVE,
      entitlementScope: {
        in: [input.requiredScope, EntitlementScope.ALL_CLASSES],
      },
    },
    select: {
      id: true,
      createdAt: true,
      entitlementType: true,
      entitlementScope: true,
      expiresAt: true,
    },
  });

  if (!entitlement) {
    throw new BookingPaymentOptionsError("PLAN_NOT_FOUND", "Selected plan was not found.");
  }

  if (!isScopeCompatible({ entitlementScope: entitlement.entitlementScope, requiredScope: input.requiredScope })) {
    throw new BookingPaymentOptionsError("PLAN_NOT_USABLE", "Selected plan is not eligible for this booking.");
  }

  let effectiveEntitlement = entitlement;
  let balance: PlanBalance;

  if (
    entitlement.entitlementType === EntitlementType.CREDIT_PACK ||
    entitlement.entitlementType === EntitlementType.SINGLE_USE
  ) {
    const nextCreditEntitlement = await getNextConsumableCreditEntitlement({
      requiredScope: input.requiredScope,
      userId: input.userId,
    });

    if (!nextCreditEntitlement) {
      throw new BookingPaymentOptionsError("PLAN_NOT_USABLE", "No usable credits available.");
    }

    effectiveEntitlement = {
      id: nextCreditEntitlement.id,
      createdAt: nextCreditEntitlement.createdAt,
      entitlementType: nextCreditEntitlement.entitlementType,
      entitlementScope: nextCreditEntitlement.entitlementScope,
      expiresAt: nextCreditEntitlement.expiresAt,
    };
    balance = {
      credits: nextCreditEntitlement.balance,
      isUsable: true,
      reason: null,
    };
  } else {
    balance = await getPlanBalance({
      entitlementId: entitlement.id,
      entitlementType: entitlement.entitlementType,
      isActive: isEntitlementActive(entitlement.expiresAt),
    });
  }

  if (!balance.isUsable) {
    throw new BookingPaymentOptionsError("PLAN_NOT_USABLE", balance.reason ?? "Selected plan is not usable.");
  }

  const booking = await prisma.$transaction(async (tx) => {
    if (
      effectiveEntitlement.entitlementType === EntitlementType.CREDIT_PACK ||
      effectiveEntitlement.entitlementType === EntitlementType.SINGLE_USE
    ) {
      await tx.creditLedgerEntry.createMany({
        data: {
          clientId: input.userId,
          entitlementId: effectiveEntitlement.id,
          bookingId: input.bookingId,
          entryType: CreditLedgerEntryType.CONSUME,
          amount: -1,
          idempotencyKey: buildBookingCreditLedgerIdempotencyKey({
            type: "CONSUME",
            clientId: input.userId,
            entitlementId: effectiveEntitlement.id,
            bookingId: input.bookingId,
          }),
          notes: "Credit consumed by existing-plan booking confirmation.",
        },
        skipDuplicates: true,
      });
    }

    return tx.booking.update({
      where: { id: input.bookingId },
      data: {
        status: BookingStatus.CONFIRMED,
        paymentSelection: BookingPaymentSelection.EXISTING_PLAN,
        selectedEntitlementId: effectiveEntitlement.id,
        selectedPriceId: null,
        draftAmountMinor: 0,
        draftCurrencyCode: "EUR",
      },
      select: {
        id: true,
        status: true,
        paymentSelection: true,
        selectedEntitlementId: true,
        selectedPriceId: true,
        draftAmountMinor: true,
        draftCurrencyCode: true,
      },
    });
  });

  return {
    bookingId: booking.id,
    bookingStatus: booking.status,
    paymentSelection: booking.paymentSelection ?? BookingPaymentSelection.EXISTING_PLAN,
    selectedEntitlementId: booking.selectedEntitlementId,
    selectedPriceId: booking.selectedPriceId,
    draftAmountMinor: booking.draftAmountMinor ?? 0,
    draftCurrencyCode: booking.draftCurrencyCode ?? "EUR",
  };
}

async function applyPriceSelection(input: {
  bookingId: string;
  mode: "NEW_PLAN_PURCHASE" | "SINGLE_SESSION";
  priceId: string;
  requiredScope: EntitlementScope;
}): Promise<SelectPaymentResult> {
  const price = await prisma.price.findFirst({
    where: {
      id: input.priceId,
      isActive: true,
      isArchived: false,
      product: {
        isActive: true,
        isArchived: false,
        entitlementRules: {
          some: {
            isActive: true,
            entitlementScope: {
              in: [input.requiredScope, EntitlementScope.ALL_CLASSES],
            },
          },
        },
        ...(input.mode === "SINGLE_SESSION"
          ? { productType: ProductType.DROP_IN_CLASS }
          : {
              productType: {
                in: [
                  ProductType.CLASS_PACK,
                  ProductType.PRIVATE_PACK,
                  ProductType.UNLIMITED_MEMBERSHIP,
                  ProductType.DROP_IN_CLASS,
                ],
              },
            }),
      },
    },
    select: {
      id: true,
      unitAmountMinor: true,
      currencyCode: true,
    },
  });

  if (!price) {
    throw new BookingPaymentOptionsError("PRICE_NOT_ELIGIBLE", "Selected price is not eligible.");
  }

  const booking = await prisma.booking.update({
    where: { id: input.bookingId },
    data: {
      status: BookingStatus.PENDING,
      paymentSelection:
        input.mode === "SINGLE_SESSION"
          ? BookingPaymentSelection.SINGLE_SESSION
          : BookingPaymentSelection.NEW_PLAN_PURCHASE,
      selectedPriceId: price.id,
      selectedEntitlementId: null,
      draftAmountMinor: price.unitAmountMinor,
      draftCurrencyCode: price.currencyCode,
    },
    select: {
      id: true,
      status: true,
      paymentSelection: true,
      selectedEntitlementId: true,
      selectedPriceId: true,
      draftAmountMinor: true,
      draftCurrencyCode: true,
    },
  });

  return {
    bookingId: booking.id,
    bookingStatus: booking.status,
    paymentSelection: booking.paymentSelection ?? BookingPaymentSelection.SINGLE_SESSION,
    selectedEntitlementId: booking.selectedEntitlementId,
    selectedPriceId: booking.selectedPriceId,
    draftAmountMinor: booking.draftAmountMinor ?? 0,
    draftCurrencyCode: booking.draftCurrencyCode ?? "EUR",
  };
}

export async function selectBookingPaymentOption(input: SelectPaymentInput): Promise<SelectPaymentResult> {
  const booking = await getBookingForOptions(input.bookingId);
  assertPendingBooking(booking);
  assertBookingOwnedByUser(booking, input.userId);
  assertSessionStillBookable(booking);

  const requiredScope = resolveEntitlementScope({ serviceScope: booking.classType.serviceScope, categorySlug: booking.classType.categorySlug });

  if (input.mode === "EXISTING_PLAN") {
    if (!input.userId) {
      throw new BookingPaymentOptionsError("NOT_AUTHENTICATED", "Sign in to use an existing plan.");
    }

    return applyExistingPlanSelection({
      bookingId: booking.id,
      entitlementId: input.entitlementId,
      requiredScope,
      userId: input.userId,
    });
  }

  return applyPriceSelection({
    bookingId: booking.id,
    mode: input.mode,
    priceId: input.priceId,
    requiredScope,
  });
}
