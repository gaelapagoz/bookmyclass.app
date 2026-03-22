import {
  BillingInterval,
  BookingStatus,
  ClientEntitlementStatus,
  PaymentProvider,
  PriceType,
  ProductType,
  Role,
  StudioSessionStatus,
  SubscriptionStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";

import { prisma } from "@/lib/db";
import { generatePlanSlug } from "@/lib/admin/plan-slug";
import { ensureEntitlementRuleForProduct } from "@/lib/admin/plan-entitlement-rules";
import { provisionPlanOnStripe, resolveStripeProductIdFromPrice } from "@/lib/admin/plan-provisioning";

export type AdminDashboardData = {
  upcomingSessionsCount: number;
  bookingsCount: number;
  activePlansCount: number;
  activeEntitlementsCount: number;
  recentBookings: Array<{
    id: string;
    status: BookingStatus;
    bookedAt: string;
    clientName: string;
    clientEmail: string;
    sessionTitle: string;
    startsAt: string;
  }>;
};

export type AdminClassItem = {
  id: string;
  name: string;
  slug: string;
  categoryName: string;
  defaultDurationMinutes: number;
  defaultCapacity: number;
  isActive: boolean;
  isVisible: boolean;
  sortOrder: number;
};

export type AdminSessionItem = {
  id: string;
  title: string;
  className: string;
  teacherName: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  bookedCount: number;
  status: StudioSessionStatus;
  isPublished: boolean;
  location: string | null;
};

export type AdminPlanItem = {
  id: string;
  name: string;
  productType: ProductType;
  isActive: boolean;
  sortOrder: number;
  currentPriceAmountMinor: number | null;
  currentPriceCurrencyCode: string | null;
  currentPriceType: PriceType | null;
  currentBillingInterval: BillingInterval | null;
  currentBillingIntervalCount: number | null;
  isCheckoutReady: boolean;
};

export type AdminBookingItem = {
  id: string;
  status: BookingStatus;
  paymentSelection: string | null;
  bookedAt: string;
  customerName: string;
  customerEmail: string;
  sessionTitle: string;
  startsAt: string;
};

export type AdminUserItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
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

export type AdminLearningProgramItem = {
  id: string;
  legacyId: string;
  courseType: string;
  mainTitle: string;
  title: string;
  updatedAt: string;
};

export type AdminLearningVideoItem = {
  id: string;
  legacyId: string;
  title: string;
  category: string;
  categoryType: string | null;
  categoryLevel: string | null;
  priority: number;
  updatedAt: string;
};

function toNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const now = new Date();

  const [upcomingSessionsCount, bookingsCount, activePlansCount, activeEntitlementsCount, recentBookings] =
    await prisma.$transaction([
      prisma.studioSession.count({
        where: {
          startsAt: { gte: now },
          status: StudioSessionStatus.SCHEDULED,
        },
      }),
      prisma.booking.count(),
      prisma.subscriptionContract.count({
        where: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: { gt: now },
        },
      }),
      prisma.clientEntitlement.count({
        where: { status: ClientEntitlementStatus.ACTIVE },
      }),
      prisma.booking.findMany({
        orderBy: { bookedAt: "desc" },
        take: 8,
        select: {
          id: true,
          status: true,
          bookedAt: true,
          customerName: true,
          customerEmail: true,
          client: {
            select: {
              name: true,
              email: true,
            },
          },
          studioSession: {
            select: {
              title: true,
              startsAt: true,
            },
          },
        },
      }),
    ]);

  return {
    upcomingSessionsCount,
    bookingsCount,
    activePlansCount,
    activeEntitlementsCount,
    recentBookings: recentBookings.map((booking) => ({
      id: booking.id,
      status: booking.status,
      bookedAt: booking.bookedAt.toISOString(),
      clientName: booking.customerName ?? booking.client?.name ?? "Guest",
      clientEmail: booking.customerEmail ?? booking.client?.email ?? "-",
      sessionTitle: booking.studioSession.title,
      startsAt: booking.studioSession.startsAt.toISOString(),
    })),
  };
}

export async function getAdminClassesData(): Promise<AdminClassItem[]> {
  const classes = await prisma.classType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      defaultDurationMinutes: true,
      defaultCapacity: true,
      isActive: true,
      isVisible: true,
      sortOrder: true,
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
    slug: item.slug,
    categoryName: item.category.name,
    defaultDurationMinutes: item.defaultDurationMinutes,
    defaultCapacity: item.defaultCapacity,
    isActive: item.isActive,
    isVisible: item.isVisible,
    sortOrder: item.sortOrder,
  }));
}

export async function getAdminClassById(id: string) {
  return prisma.classType.findUnique({
    where: { id },
    select: {
      id: true,
      categoryId: true,
      name: true,
      slug: true,
      description: true,
      defaultDurationMinutes: true,
      defaultCapacity: true,
      isActive: true,
      isVisible: true,
      sortOrder: true,
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

export async function createAdminClass(input: {
  categoryId: string;
  name: string;
  slug: string;
  description?: string;
  defaultDurationMinutes: number;
  defaultCapacity: number;
  isActive: boolean;
  isVisible: boolean;
  sortOrder: number;
}) {
  return prisma.classType.create({
    data: {
      categoryId: input.categoryId,
      name: input.name.trim(),
      slug: input.slug.trim(),
      description: toNullable(input.description),
      defaultDurationMinutes: input.defaultDurationMinutes,
      defaultCapacity: input.defaultCapacity,
      isActive: input.isActive,
      isVisible: input.isVisible,
      sortOrder: input.sortOrder,
    },
  });
}

export async function updateAdminClass(
  id: string,
  input: {
    categoryId: string;
    name: string;
    slug: string;
    description?: string;
    defaultDurationMinutes: number;
    defaultCapacity: number;
    isActive: boolean;
    isVisible: boolean;
    sortOrder: number;
  },
) {
  return prisma.classType.update({
    where: { id },
    data: {
      categoryId: input.categoryId,
      name: input.name.trim(),
      slug: input.slug.trim(),
      description: toNullable(input.description),
      defaultDurationMinutes: input.defaultDurationMinutes,
      defaultCapacity: input.defaultCapacity,
      isActive: input.isActive,
      isVisible: input.isVisible,
      sortOrder: input.sortOrder,
    },
  });
}

export async function getAdminSessionsData(input?: {
  weekStart?: Date;
  weekEnd?: Date;
}): Promise<AdminSessionItem[]> {
  const sessions = await prisma.studioSession.findMany({
    where:
      input?.weekStart && input.weekEnd
        ? {
            startsAt: {
              gte: input.weekStart,
              lt: input.weekEnd,
            },
          }
        : undefined,
    orderBy: [{ startsAt: "asc" }, { title: "asc" }],
    take: 200,
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      location: true,
      capacity: true,
      status: true,
      isPublished: true,
      classType: {
        select: {
          name: true,
        },
      },
      teacher: {
        select: {
          name: true,
        },
      },
      bookings: {
        where: {
          status: {
            in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
          },
        },
        select: {
          id: true,
        },
      },
    },
  });

  return sessions.map((item) => ({
    id: item.id,
    title: item.title,
    className: item.classType.name,
    teacherName: item.teacher.name,
    startsAt: item.startsAt.toISOString(),
    endsAt: item.endsAt.toISOString(),
    location: item.location,
    capacity: item.capacity,
    bookedCount: item.bookings.length,
    status: item.status,
    isPublished: item.isPublished,
  }));
}

export async function getAdminSessionById(id: string) {
  return prisma.studioSession.findUnique({
    where: { id },
    select: {
      id: true,
      classTemplateId: true,
      teacherId: true,
      title: true,
      description: true,
      location: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      status: true,
      isPublished: true,
    },
  });
}

export async function getAdminSessionOptions() {
  const [templates, teachers] = await prisma.$transaction([
    prisma.classTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ title: "asc" }],
      select: {
        id: true,
        title: true,
        classTypeId: true,
      },
    }),
    prisma.user.findMany({
      where: {
        role: {
          in: [Role.TEACHER, Role.ADMIN, Role.MASTER_ADMIN],
        },
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
      },
    }),
  ]);

  return { templates, teachers };
}

export async function createAdminSession(input: {
  classTemplateId: string;
  teacherId: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  status: StudioSessionStatus;
  isPublished: boolean;
}) {
  const template = await prisma.classTemplate.findUnique({
    where: { id: input.classTemplateId },
    select: {
      id: true,
      classTypeId: true,
    },
  });

  if (!template) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  return prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: template.classTypeId,
      teacherId: input.teacherId,
      title: input.title.trim(),
      description: toNullable(input.description),
      location: toNullable(input.location),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacity: input.capacity,
      status: input.status,
      isPublished: input.isPublished,
    },
  });
}

export async function updateAdminSession(
  id: string,
  input: {
    classTemplateId: string;
    teacherId: string;
    title: string;
    description?: string;
    location?: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    status: StudioSessionStatus;
    isPublished: boolean;
  },
) {
  const template = await prisma.classTemplate.findUnique({
    where: { id: input.classTemplateId },
    select: {
      id: true,
      classTypeId: true,
    },
  });

  if (!template) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  return prisma.studioSession.update({
    where: { id },
    data: {
      classTemplateId: template.id,
      classTypeId: template.classTypeId,
      teacherId: input.teacherId,
      title: input.title.trim(),
      description: toNullable(input.description),
      location: toNullable(input.location),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacity: input.capacity,
      status: input.status,
      isPublished: input.isPublished,
    },
  });
}

export async function getAdminPlansData(): Promise<AdminPlanItem[]> {
  const products = await prisma.product.findMany({
    where: { isArchived: false },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      productType: true,
      isActive: true,
      sortOrder: true,
      prices: {
        where: {
          isActive: true,
          isArchived: false,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
        select: {
          unitAmountMinor: true,
          currencyCode: true,
          priceType: true,
          billingInterval: true,
          billingIntervalCount: true,
          stripePriceId: true,
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
      currentPriceAmountMinor: currentPrice?.unitAmountMinor ?? null,
      currentPriceCurrencyCode: currentPrice?.currencyCode ?? null,
      currentPriceType: currentPrice?.priceType ?? null,
      currentBillingInterval: currentPrice?.billingInterval ?? null,
      currentBillingIntervalCount: currentPrice?.billingIntervalCount ?? null,
      isCheckoutReady: Boolean(currentPrice?.stripePriceId),
    };
  });
}

export async function getAdminPlanById(id: string) {
  return prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      productType: true,
      isActive: true,
      sortOrder: true,
      prices: {
        where: {
          isActive: true,
          isArchived: false,
        },
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
        },
      },
    },
  });
}

export async function createAdminPlan(input: {
  name: string;
  description?: string;
  productType: ProductType;
  isActive: boolean;
  sortOrder: number;
  priceName?: string;
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval?: BillingInterval;
  billingIntervalCount?: number;
}) {
  const name = input.name.trim();
  const slugBase = generatePlanSlug(name);
  const slug = slugBase || `plan-${Date.now()}`;
  const priceName = input.priceName?.trim() || `${name} Price`;
  const normalizedDescription = toNullable(input.description);
  const normalizedCurrencyCode = input.currencyCode.trim().toUpperCase();

  const created = await prisma.product.create({
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
          lookupKey: `admin-${slug}-${Date.now()}`,
          name: priceName,
          priceType: input.priceType,
          currencyCode: normalizedCurrencyCode,
          unitAmountMinor: input.unitAmountMinor,
          billingInterval: input.priceType === PriceType.RECURRING ? input.billingInterval : null,
          billingIntervalCount: input.priceType === PriceType.RECURRING ? input.billingIntervalCount ?? 1 : null,
          isActive: true,
          isArchived: false,
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
    productId: created.id,
    productType: input.productType,
    prismaClient: prisma,
  });

  const activePriceId = created.prices[0]?.id;
  if (activePriceId) {
    const stripeProvision = await provisionPlanOnStripe({
      existingStripeProductId: null,
      productName: name,
      productDescription: normalizedDescription,
      priceName,
      priceType: input.priceType,
      currencyCode: normalizedCurrencyCode,
      unitAmountMinor: input.unitAmountMinor,
      billingInterval: input.priceType === PriceType.RECURRING ? input.billingInterval ?? null : null,
      billingIntervalCount: input.priceType === PriceType.RECURRING ? input.billingIntervalCount ?? 1 : null,
    });

    if (stripeProvision.ok) {
      await prisma.price.update({
        where: { id: activePriceId },
        data: { stripePriceId: stripeProvision.stripePriceId },
      });
    }
  }

  return prisma.product.findUnique({ where: { id: created.id } });
}

export async function updateAdminPlan(
  id: string,
  input: {
    name: string;
    description?: string;
    productType: ProductType;
    isActive: boolean;
    sortOrder: number;
    priceName?: string;
    priceType: PriceType;
    currencyCode: string;
    unitAmountMinor: number;
    billingInterval?: BillingInterval;
    billingIntervalCount?: number;
  },
) {
  const name = input.name.trim();
  const slugBase = generatePlanSlug(name);
  const slug = slugBase || `plan-${Date.now()}`;
  const priceName = input.priceName?.trim() || `${name} Price`;
  const normalizedDescription = toNullable(input.description);
  const normalizedCurrencyCode = input.currencyCode.trim().toUpperCase();

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

  const result = await prisma.$transaction(async (tx) => {
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

    const createdPrice = await tx.price.create({
      data: {
        productId: id,
        lookupKey: `admin-${slug}-${Date.now()}`,
        name: priceName,
        priceType: input.priceType,
        currencyCode: normalizedCurrencyCode,
        unitAmountMinor: input.unitAmountMinor,
        billingInterval: input.priceType === PriceType.RECURRING ? input.billingInterval : null,
        billingIntervalCount: input.priceType === PriceType.RECURRING ? input.billingIntervalCount ?? 1 : null,
        isActive: true,
        isArchived: false,
      },
      select: { id: true },
    });

    await ensureEntitlementRuleForProduct({
      productId: id,
      productType: input.productType,
      prismaClient: tx,
    });

    return createdPrice;
  });

  const stripeProvision = await provisionPlanOnStripe({
    existingStripeProductId,
    productName: name,
    productDescription: normalizedDescription,
    priceName,
    priceType: input.priceType,
    currencyCode: normalizedCurrencyCode,
    unitAmountMinor: input.unitAmountMinor,
    billingInterval: input.priceType === PriceType.RECURRING ? input.billingInterval ?? null : null,
    billingIntervalCount: input.priceType === PriceType.RECURRING ? input.billingIntervalCount ?? 1 : null,
  });

  if (stripeProvision.ok) {
    await prisma.price.update({
      where: { id: result.id },
      data: { stripePriceId: stripeProvision.stripePriceId },
    });
  }

  return prisma.product.findUnique({ where: { id } });
}

export async function getAdminBookingsData(): Promise<AdminBookingItem[]> {
  const bookings = await prisma.booking.findMany({
    orderBy: [{ bookedAt: "desc" }],
    take: 100,
    select: {
      id: true,
      status: true,
      paymentSelection: true,
      bookedAt: true,
      customerName: true,
      customerEmail: true,
      client: {
        select: {
          name: true,
          email: true,
        },
      },
      studioSession: {
        select: {
          title: true,
          startsAt: true,
        },
      },
    },
  });

  return bookings.map((item) => ({
    id: item.id,
    status: item.status,
    paymentSelection: item.paymentSelection,
    bookedAt: item.bookedAt.toISOString(),
    customerName: item.customerName ?? item.client?.name ?? "Guest",
    customerEmail: item.customerEmail ?? item.client?.email ?? "-",
    sessionTitle: item.studioSession.title,
    startsAt: item.studioSession.startsAt.toISOString(),
  }));
}

export async function getAdminUsersData(): Promise<AdminUserItem[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  }));
}

export async function getAdminUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
    },
  });
}

export async function createAdminUser(input: {
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  password: string;
}) {
  const passwordHash = await hash(input.password, 12);

  return prisma.user.create({
    data: {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      role: input.role,
      isActive: input.isActive,
      isInactive: !input.isActive,
      passwordHash,
    },
  });
}

export async function updateAdminUser(
  id: string,
  input: {
    name: string;
    email: string;
    role: Role;
    isActive: boolean;
    password?: string;
  },
) {
  const passwordHash = input.password ? await hash(input.password, 12) : undefined;

  return prisma.user.update({
    where: { id },
    data: {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      role: input.role,
      isActive: input.isActive,
      isInactive: !input.isActive,
      ...(passwordHash ? { passwordHash } : {}),
    },
  });
}

export async function getAdminSubscriptionsData(): Promise<AdminSubscriptionItem[]> {
  const rows = await prisma.subscriptionContract.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 150,
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
  });

  return rows.map((row) => ({
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
  }));
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
  const price = await prisma.price.findUnique({
    where: { id: input.priceId },
    select: { productId: true },
  });

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
    orderBy: [{ legacyId: "asc" }],
    select: {
      id: true,
      legacyId: true,
      courseType: true,
      mainTitle: true,
      title: true,
      updatedAt: true,
    },
  });

  return programs.map((item) => ({
    ...item,
    updatedAt: item.updatedAt.toISOString(),
  }));
}

export async function getAdminLearningProgramById(id: string) {
  return prisma.learningProgram.findUnique({
    where: { id },
    select: {
      id: true,
      legacyId: true,
      mainTitle: true,
      mainDescription: true,
      courseType: true,
      title: true,
      description1: true,
      description2: true,
      description3: true,
      videoPromo: true,
      picture1: true,
      picture2: true,
      picture3: true,
    },
  });
}

export async function createAdminLearningProgram(input: {
  legacyId: string;
  mainTitle: string;
  mainDescription?: string;
  courseType: string;
  title: string;
  description1?: string;
  description2?: string;
  description3?: string;
  videoPromo?: string;
  picture1?: string;
  picture2?: string;
  picture3?: string;
}) {
  return prisma.learningProgram.create({
    data: {
      legacyId: input.legacyId.trim(),
      mainTitle: input.mainTitle.trim(),
      mainDescription: toNullable(input.mainDescription),
      courseType: input.courseType.trim(),
      title: input.title.trim(),
      description1: toNullable(input.description1),
      description2: toNullable(input.description2),
      description3: toNullable(input.description3),
      videoPromo: toNullable(input.videoPromo),
      picture1: toNullable(input.picture1),
      picture2: toNullable(input.picture2),
      picture3: toNullable(input.picture3),
    },
  });
}

export async function updateAdminLearningProgram(
  id: string,
  input: {
    legacyId: string;
    mainTitle: string;
    mainDescription?: string;
    courseType: string;
    title: string;
    description1?: string;
    description2?: string;
    description3?: string;
    videoPromo?: string;
    picture1?: string;
    picture2?: string;
    picture3?: string;
  },
) {
  return prisma.learningProgram.update({
    where: { id },
    data: {
      legacyId: input.legacyId.trim(),
      mainTitle: input.mainTitle.trim(),
      mainDescription: toNullable(input.mainDescription),
      courseType: input.courseType.trim(),
      title: input.title.trim(),
      description1: toNullable(input.description1),
      description2: toNullable(input.description2),
      description3: toNullable(input.description3),
      videoPromo: toNullable(input.videoPromo),
      picture1: toNullable(input.picture1),
      picture2: toNullable(input.picture2),
      picture3: toNullable(input.picture3),
    },
  });
}

export async function getAdminLearningVideosData(): Promise<AdminLearningVideoItem[]> {
  const videos = await prisma.learningCourse.findMany({
    orderBy: [{ priority: "asc" }, { title: "asc" }],
    select: {
      id: true,
      legacyId: true,
      title: true,
      category: true,
      categoryType: true,
      categoryLevel: true,
      priority: true,
      updatedAt: true,
    },
  });

  return videos.map((item) => ({
    ...item,
    updatedAt: item.updatedAt.toISOString(),
  }));
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
      categoryType: true,
      categoryLevel: true,
      thumbnail: true,
      videoUrl: true,
      priority: true,
    },
  });
}

export async function createAdminLearningVideo(input: {
  legacyId: string;
  title: string;
  description?: string;
  shortDescription?: string;
  category: string;
  categoryType?: string;
  categoryLevel?: string;
  thumbnail?: string;
  videoUrl?: string;
  priority: number;
}) {
  return prisma.learningCourse.create({
    data: {
      legacyId: input.legacyId.trim(),
      title: input.title.trim(),
      description: toNullable(input.description),
      shortDescription: toNullable(input.shortDescription),
      category: input.category.trim(),
      categoryType: toNullable(input.categoryType),
      categoryLevel: toNullable(input.categoryLevel),
      thumbnail: toNullable(input.thumbnail),
      videoUrl: toNullable(input.videoUrl),
      priority: input.priority,
    },
  });
}

export async function updateAdminLearningVideo(
  id: string,
  input: {
    legacyId: string;
    title: string;
    description?: string;
    shortDescription?: string;
    category: string;
    categoryType?: string;
    categoryLevel?: string;
    thumbnail?: string;
    videoUrl?: string;
    priority: number;
  },
) {
  return prisma.learningCourse.update({
    where: { id },
    data: {
      legacyId: input.legacyId.trim(),
      title: input.title.trim(),
      description: toNullable(input.description),
      shortDescription: toNullable(input.shortDescription),
      category: input.category.trim(),
      categoryType: toNullable(input.categoryType),
      categoryLevel: toNullable(input.categoryLevel),
      thumbnail: toNullable(input.thumbnail),
      videoUrl: toNullable(input.videoUrl),
      priority: input.priority,
    },
  });
}
















