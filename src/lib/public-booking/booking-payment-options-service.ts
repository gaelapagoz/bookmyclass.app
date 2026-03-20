import {
  BookingPaymentSelection,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  PriceType,
  ProductType,
  type BillingInterval,
} from "@prisma/client";
import { prisma } from "../db";

type PlanBalance = {
  credits: number | null;
  isUsable: boolean;
  reason: string | null;
};

type ExistingPlanOption = {
  entitlementId: string;
  entitlementScope: EntitlementScope;
  entitlementType: EntitlementType;
  expiresAt: string | null;
  isUsable: boolean;
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
  currencyCode: string;
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
  currencyCode: string;
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
  bookingIntent: "SINGLE_BOOKING" | "USE_PLAN";
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
  bookingIntent: "SINGLE_BOOKING" | "USE_PLAN";
  existingPlans: ExistingPlanOption[];
  newPlanOptions: NewPlanOption[];
  singleSession: SingleSessionOption;
  ux: {
    recommended: BookingPaymentRecommended;
    requiresChoice: boolean;
  };
};

type PlanSummary = {
  entitlementId: string;
  expiresAt: string | null;
  isUsable: boolean;
  priceName: string | null;
  productId: string;
  productName: string;
  reason: string | null;
  remainingCredits: number | null;
};

type BookingForOptions = {
  bookingIntent: "SINGLE_BOOKING" | "USE_PLAN";
  classType: {
    categorySlug: string;
    serviceSlug: string;
  };
  draftAmountMinor: number | null;
  draftCurrencyCode: string | null;
  id: string;
  paymentSelection: BookingPaymentSelection | null;
  selectedEntitlementId: string | null;
  selectedPriceId: string | null;
  status: BookingStatus;
};

type PlanOptionRecord = {
  amountMinor: number;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  currencyCode: string;
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
  | "NOT_AUTHENTICATED"
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

function toEntitlementScope(categorySlug: string): EntitlementScope {
  if (categorySlug.includes("private")) {
    return EntitlementScope.PRIVATE_CLASSES;
  }

  if (categorySlug.includes("workshop")) {
    return EntitlementScope.WORKSHOPS;
  }

  return EntitlementScope.COLLECTIVE_CLASSES;
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
      status: true,
      bookingIntent: true,
      paymentSelection: true,
      selectedEntitlementId: true,
      selectedPriceId: true,
      draftAmountMinor: true,
      draftCurrencyCode: true,
      studioSession: {
        select: {
          classType: {
            select: {
              slug: true,
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
    status: booking.status,
    bookingIntent: booking.bookingIntent,
    paymentSelection: booking.paymentSelection,
    selectedEntitlementId: booking.selectedEntitlementId,
    selectedPriceId: booking.selectedPriceId,
    draftAmountMinor: booking.draftAmountMinor,
    draftCurrencyCode: booking.draftCurrencyCode,
    classType: {
      serviceSlug: booking.studioSession.classType.slug,
      categorySlug: booking.studioSession.classType.category.slug,
    },
  };
}

async function getServiceCategorySlug(serviceSlug: string): Promise<string | null> {
  const classType = await prisma.classType.findUnique({
    where: { slug: serviceSlug },
    select: {
      category: {
        select: {
          slug: true,
        },
      },
    },
  });

  return classType?.category.slug ?? null;
}

function isEntitlementActive(expiresAt: Date | null): boolean {
  return !expiresAt || expiresAt > new Date();
}

async function getEntitlementCreditBalance(entitlementId: string): Promise<number> {
  const result = await prisma.creditLedgerEntry.aggregate({
    where: { entitlementId },
    _sum: { amount: true },
  });

  return result._sum.amount ?? 0;
}

async function getPlanBalance(input: {
  entitlementId: string;
  entitlementType: EntitlementType;
  isActive: boolean;
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
    const balance = await getEntitlementCreditBalance(input.entitlementId);

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

  const options = await Promise.all(
    entitlements.map(async (entitlement) => {
      const active = isEntitlementActive(entitlement.expiresAt);
      const balance = await getPlanBalance({
        entitlementId: entitlement.id,
        entitlementType: entitlement.entitlementType,
        isActive: active,
      });

      return {
        entitlementId: entitlement.id,
        entitlementType: entitlement.entitlementType,
        entitlementScope: entitlement.entitlementScope,
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

  return options.filter((option) => option.isUsable);
}

async function getPlanPurchaseOptions(requiredScope: EntitlementScope): Promise<PlanOptionRecord[]> {
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      isArchived: false,
      productType: {
        in: [ProductType.CLASS_PACK, ProductType.UNLIMITED_MEMBERSHIP, ProductType.INTRO_OFFER],
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
    priceId: price.id,
    priceName: `${product.name} - ${price.name}`,
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

function toPlanSummary(plan: ExistingPlanOption): PlanSummary {
  return {
    entitlementId: plan.entitlementId,
    productId: plan.productId,
    productName: plan.productName,
    priceName: plan.priceName,
    expiresAt: plan.expiresAt,
    remainingCredits: plan.remainingCredits,
    isUsable: plan.isUsable,
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

  if (booking.bookingIntent === "SINGLE_BOOKING") {
    if (singleSession) {
      return {
        recommended: {
          mode: BookingPaymentSelection.SINGLE_SESSION,
          entitlementId: null,
          priceId: singleSession.priceId,
          reason: "Booking intent is single-session; drop-in payment is preselected.",
        },
        requiresChoice: false,
      };
    }

    return {
      recommended: {
        mode: null,
        entitlementId: null,
        priceId: null,
        reason: "No single-session price is available for this class.",
      },
      requiresChoice: true,
    };
  }

  if (existingPlans.length === 1) {
    return {
      recommended: {
        mode: BookingPaymentSelection.EXISTING_PLAN,
        entitlementId: existingPlans[0]?.entitlementId ?? null,
        priceId: null,
        reason: "One eligible active plan found; it is preselected.",
      },
      requiresChoice: false,
    };
  }

  if (existingPlans.length > 1) {
    return {
      recommended: {
        mode: null,
        entitlementId: null,
        priceId: null,
        reason: "Multiple eligible plans found; choose which plan to use.",
      },
      requiresChoice: true,
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

export async function getMyActivePlans(userId: string): Promise<PlanSummary[]> {
  const entitlements = await prisma.clientEntitlement.findMany({
    where: {
      clientId: userId,
      status: ClientEntitlementStatus.ACTIVE,
    },
    select: {
      id: true,
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

  const plans = await Promise.all(
    entitlements.map(async (entitlement) => {
      const balance = await getPlanBalance({
        entitlementId: entitlement.id,
        entitlementType: entitlement.entitlementType,
        isActive: isEntitlementActive(entitlement.expiresAt),
      });

      return {
        entitlementId: entitlement.id,
        entitlementType: entitlement.entitlementType,
        entitlementScope: entitlement.entitlementScope,
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

  const requiredScope = toEntitlementScope(booking.classType.categorySlug);
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
  bookingIntent: "SINGLE_BOOKING" | "USE_PLAN";
  serviceSlug: string;
  userId: string | null;
}): Promise<BookingPaymentOptionsPreview> {
  const categorySlug = await getServiceCategorySlug(params.serviceSlug);
  if (!categorySlug) {
    throw new BookingPaymentOptionsError("BOOKING_NOT_FOUND", "Service was not found.");
  }

  const requiredScope = toEntitlementScope(categorySlug);
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
      status: BookingStatus.PENDING,
      bookingIntent: params.bookingIntent,
      paymentSelection: null,
      selectedEntitlementId: null,
      selectedPriceId: null,
      draftAmountMinor: null,
      draftCurrencyCode: null,
      classType: {
        serviceSlug: params.serviceSlug,
        categorySlug,
      },
    },
    existingPlans,
    newPlanOptions,
    singleSession,
  });

  return {
    bookingIntent: params.bookingIntent,
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

  const balance = await getPlanBalance({
    entitlementId: entitlement.id,
    entitlementType: entitlement.entitlementType,
    isActive: isEntitlementActive(entitlement.expiresAt),
  });

  if (!balance.isUsable) {
    throw new BookingPaymentOptionsError("PLAN_NOT_USABLE", balance.reason ?? "Selected plan is not usable.");
  }

  const booking = await prisma.$transaction(async (tx) => {
    if (
      entitlement.entitlementType === EntitlementType.CREDIT_PACK ||
      entitlement.entitlementType === EntitlementType.SINGLE_USE
    ) {
      const existingConsume = await tx.creditLedgerEntry.findFirst({
        where: {
          bookingId: input.bookingId,
          entitlementId: entitlement.id,
          entryType: CreditLedgerEntryType.CONSUME,
        },
        select: { id: true },
      });

      if (!existingConsume) {
        await tx.creditLedgerEntry.create({
          data: {
            clientId: input.userId,
            entitlementId: entitlement.id,
            bookingId: input.bookingId,
            entryType: CreditLedgerEntryType.CONSUME,
            amount: -1,
            notes: "Credit consumed by existing-plan booking confirmation.",
          },
        });
      }
    }

    return tx.booking.update({
      where: { id: input.bookingId },
      data: {
        status: BookingStatus.CONFIRMED,
        paymentSelection: BookingPaymentSelection.EXISTING_PLAN,
        selectedEntitlementId: entitlement.id,
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
                in: [ProductType.CLASS_PACK, ProductType.UNLIMITED_MEMBERSHIP, ProductType.INTRO_OFFER],
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

  const requiredScope = toEntitlementScope(booking.classType.categorySlug);

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
