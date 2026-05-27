import {
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  MarketingSubscriptionStatus,
  OrderStatus,
  Prisma,
  ProductType,
  Role,
  SubscriptionStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";

import { prisma } from "@/lib/db";
import { resolveEntitlementScope } from "@/lib/booking/entitlement-scope";
import { applyTrustedAdminEmailChange, createUserFromTrustedFlow } from "@/lib/auth/user-identity-service";
import { assertCanonicalMediaPublicPath } from "@/lib/media";

export type AdminUserItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  marketingSubscriptionStatus: MarketingSubscriptionStatus;
  marketingSegmentNames: string[];
};

export type AdminUsersRolePageData = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  items: AdminUserItem[];
};

export type AdminClientStats = {
  totalClients: number;
  neverSubscribedClients: number;
  subscribedClients: number;
  unsubscribedClients: number;
  totalSubscriptions: number;
};

export type AdminUsersGroupedPageData = {
  query: string;
  masterAdmins: AdminUsersRolePageData;
  admins: AdminUsersRolePageData;
  teachers: AdminUsersRolePageData;
  clients: AdminUsersRolePageData;
};

export type AdminMarketingSegmentOption = {
  id: string;
  name: string;
  isActive: boolean;
};

export type AdminUserDetail = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  isActive: boolean;
  image: string;
  phone: string;
  notes: string;
  bio: string;
  specialties: string[];
  certifications: string[];
  hireDate: string | null;
  marketingSubscriptionStatus: MarketingSubscriptionStatus;
  marketingSegmentIds: string[];
};

export type AdminClientActivityData = {
  plansBought: Array<{
    orderId: string;
    productName: string;
    priceName: string;
    amountMinor: number;
    currencyCode: string;
    purchasedAt: string;
  }>;
  classesBooked: number;
  collectiveClassesBooked: number;
  privateClassesBooked: number;
  classesCancelled: number;
  outstandingMemberships: Array<{
    id: string;
    productName: string;
    status: SubscriptionStatus;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  }>;
  creditEntitlements: Array<{
    entitlementId: string;
    productName: string;
    status: ClientEntitlementStatus;
    expiresAt: string | null;
    remainingCredits: number;
  }>;
  creditsRemaining: number;
  nextCreditExpiration: string | null;
  eligibleCreditProducts: Array<{
    id: string;
    name: string;
  }>;
};

export type AdminClientRecoveryState =
  | { status: "HEALTHY"; contractId: string; productName: string }
  | { status: "PAST_DUE"; contractId: string; productName: string }
  | { status: "CANCELLED"; contractId: string; productName: string }
  | { status: "NONE" };
function toNullable(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const normalized = fullName.trim();
  if (!normalized) {
    return { firstName: "", lastName: "" };
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { firstName: normalized, lastName: "" };
  }

  const [firstName, ...rest] = parts;
  return {
    firstName,
    lastName: rest.join(" "),
  };
}
function mapAdminUserItem(user: {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  marketingSubscriptionStatus: MarketingSubscriptionStatus;
  marketingSegments: Array<{ segment: { name: string } }>;
}): AdminUserItem {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    marketingSubscriptionStatus: user.marketingSubscriptionStatus,
    marketingSegmentNames: user.marketingSegments.map((item) => item.segment.name).sort((a, b) => a.localeCompare(b)),
  };
}

async function getAdminUsersRolePage(input: {
  roles: Role[];
  page: number;
  pageSize: number;
  query: string;
}): Promise<AdminUsersRolePageData> {
  const where: Prisma.UserWhereInput = {
    role: {
      in: input.roles,
    },
    ...(input.query
      ? {
          OR: [
            {
              name: {
                contains: input.query,
                mode: "insensitive",
              },
            },
            {
              email: {
                contains: input.query,
                mode: "insensitive",
              },
            },
          ],
        }
      : {}),
  };

  const skip = (input.page - 1) * input.pageSize;
  const [totalItems, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: input.pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        marketingSubscriptionStatus: true,
        marketingSegments: {
          select: {
            segment: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    page: input.page,
    pageSize: input.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / input.pageSize)),
    items: rows.map(mapAdminUserItem),
  };
}

export async function getAdminUsersGroupedPageData(input: {
  query?: string;
  pageSize?: number;
  masterAdminsPage: number;
  adminsPage: number;
  teachersPage: number;
  clientsPage: number;
}): Promise<AdminUsersGroupedPageData> {
  const query = input.query?.trim() ?? "";
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));
  const normalizePage = (value: number) => Math.max(1, Math.floor(value));

  const [masterAdmins, admins, teachers, clients] = await Promise.all([
    getAdminUsersRolePage({
      roles: [Role.MASTER_ADMIN],
      page: normalizePage(input.masterAdminsPage),
      pageSize,
      query,
    }),
    getAdminUsersRolePage({
      roles: [Role.ADMIN],
      page: normalizePage(input.adminsPage),
      pageSize,
      query,
    }),
    getAdminUsersRolePage({
      roles: [Role.TEACHER],
      page: normalizePage(input.teachersPage),
      pageSize,
      query,
    }),
    getAdminUsersRolePage({
      roles: [Role.CLIENT],
      page: normalizePage(input.clientsPage),
      pageSize,
      query,
    }),
  ]);

  return {
    query,
    masterAdmins,
    admins,
    teachers,
    clients,
  };
}

export async function getAdminAdminsPageData(input: {
  query?: string;
  page: number;
  pageSize?: number;
}): Promise<AdminUsersRolePageData> {
  const query = input.query?.trim() ?? "";
  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));

  return getAdminUsersRolePage({
    roles: [Role.MASTER_ADMIN, Role.ADMIN],
    page,
    pageSize,
    query,
  });
}

export async function getAdminTeachersPageData(input: {
  query?: string;
  page: number;
  pageSize?: number;
}): Promise<AdminUsersRolePageData> {
  const query = input.query?.trim() ?? "";
  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));

  return getAdminUsersRolePage({
    roles: [Role.TEACHER],
    page,
    pageSize,
    query,
  });
}

export async function getAdminClientsPageData(input: {
  query?: string;
  page: number;
  pageSize?: number;
}): Promise<AdminUsersRolePageData> {
  const query = input.query?.trim() ?? "";
  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));

  return getAdminUsersRolePage({
    roles: [Role.CLIENT],
    page,
    pageSize,
    query,
  });
}

export async function getAdminClientStats(): Promise<AdminClientStats> {
  const now = new Date();
  const [clients, historicalRows, activeRows, totalSubscriptions] = await Promise.all([
    prisma.user.findMany({
      where: { role: Role.CLIENT },
      select: { id: true },
    }),
    prisma.subscriptionContract.findMany({
      where: {
        client: {
          role: Role.CLIENT,
        },
      },
      distinct: ["clientId"],
      select: { clientId: true },
    }),
    prisma.subscriptionContract.findMany({
      where: {
        client: {
          role: Role.CLIENT,
        },
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: {
          gt: now,
        },
      },
      distinct: ["clientId"],
      select: { clientId: true },
    }),
    prisma.subscriptionContract.count({
      where: {
        client: {
          role: Role.CLIENT,
        },
      },
    }),
  ]);

  const totalClients = clients.length;
  const clientIdsWithHistory = new Set(historicalRows.map((row) => row.clientId));
  const clientIdsWithActiveSubscription = new Set(activeRows.map((row) => row.clientId));

  const subscribedClients = clientIdsWithActiveSubscription.size;
  const neverSubscribedClients = Math.max(0, totalClients - clientIdsWithHistory.size);
  const unsubscribedClients = Math.max(0, clientIdsWithHistory.size - subscribedClients);

  return {
    totalClients,
    neverSubscribedClients,
    subscribedClients,
    unsubscribedClients,
    totalSubscriptions,
  };
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
      marketingSubscriptionStatus: true,
      marketingSegments: {
        select: {
          segment: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  return users.map(mapAdminUserItem);
}

export async function getAdminUserById(id: string): Promise<AdminUserDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      isActive: true,
      image: true,
      marketingSubscriptionStatus: true,
      marketingSegments: {
        select: {
          segmentId: true,
        },
      },
      clientProfile: {
        select: {
          phone: true,
          notes: true,
        },
      },
      teacherProfile: {
        select: {
          phone: true,
          bio: true,
          specialties: true,
          certifications: true,
          hireDate: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  const primaryPhone =
    user.role === Role.TEACHER
      ? user.teacherProfile?.phone ?? user.clientProfile?.phone ?? ""
      : user.clientProfile?.phone ?? user.teacherProfile?.phone ?? "";

  return {
    id: user.id,
    name: user.name,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    image: user.image ?? "",
    phone: primaryPhone,
    notes: user.clientProfile?.notes ?? "",
    bio: user.teacherProfile?.bio ?? "",
    specialties: user.teacherProfile?.specialties ?? [],
    certifications: user.teacherProfile?.certifications ?? [],
    hireDate: user.teacherProfile?.hireDate?.toISOString() ?? null,
    marketingSubscriptionStatus: user.marketingSubscriptionStatus,
    marketingSegmentIds: user.marketingSegments.map((item) => item.segmentId),
  };
}

export async function getAdminClientActivityData(clientId: string): Promise<AdminClientActivityData> {
  const now = new Date();
  const [plansBought, bookedClassRows, classesCancelled, outstandingMemberships, creditEntitlements, creditProducts] =
    await prisma.$transaction([
      prisma.orderItem.findMany({
        where: {
          order: {
            clientId,
            status: OrderStatus.PAID,
          },
          product: {
            productType: {
              in: [
                ProductType.CLASS_PACK,
                ProductType.PRIVATE_PACK,
                ProductType.UNLIMITED_MEMBERSHIP,
                ProductType.DROP_IN_CLASS,
              ],
            },
          },
        },
        orderBy: [{ order: { placedAt: "desc" } }, { createdAt: "desc" }],
        select: {
          orderId: true,
          productNameSnapshot: true,
          priceNameSnapshot: true,
          lineTotalAmountMinor: true,
          currencyCode: true,
          order: {
            select: {
              placedAt: true,
            },
          },
        },
      }),
      prisma.booking.findMany({
        where: {
          clientId,
          status: {
            in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW],
          },
        },
        select: {
          studioSession: {
            select: {
              classType: {
                select: {
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
      }),
      prisma.booking.count({
        where: {
          clientId,
          status: BookingStatus.CANCELLED,
        },
      }),
      prisma.subscriptionContract.findMany({
        where: {
          clientId,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: { gt: now },
          OR: [{ endedAt: null }, { endedAt: { gt: now } }],
        },
        orderBy: { currentPeriodEnd: "asc" },
        select: {
          id: true,
          status: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          product: {
            select: {
              name: true,
            },
          },
        },
      }),
      prisma.clientEntitlement.findMany({
        where: {
          clientId,
          status: ClientEntitlementStatus.ACTIVE,
          entitlementType: {
            in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
          },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          status: true,
          expiresAt: true,
          product: {
            select: {
              name: true,
            },
          },
        },
      }),
      prisma.product.findMany({
        where: {
          isActive: true,
          isArchived: false,
          entitlementRules: {
            some: {
              isActive: true,
              entitlementType: {
                in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
              },
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

  const entitlementBalances =
    creditEntitlements.length > 0
      ? await prisma.creditLedgerEntry.groupBy({
          by: ["entitlementId"],
          where: {
            clientId,
            entitlementId: { in: creditEntitlements.map((entitlement) => entitlement.id) },
          },
          _sum: {
            amount: true,
          },
        })
      : [];
  const balanceByEntitlementId = new Map(
    entitlementBalances.map((row) => [row.entitlementId, row._sum.amount ?? 0]),
  );

  const entitlementRows = creditEntitlements
    .map((entitlement) => ({
      entitlementId: entitlement.id,
      productName: entitlement.product.name,
      status: entitlement.status,
      expiresAt: entitlement.expiresAt?.toISOString() ?? null,
      remainingCredits: balanceByEntitlementId.get(entitlement.id) ?? 0,
    }))
    .filter((entitlement) => entitlement.remainingCredits > 0);

  const creditsRemaining = entitlementRows.reduce((sum, row) => sum + row.remainingCredits, 0);
  const bookedTotals = bookedClassRows.reduce(
    (totals, booking) => {
      const scope = resolveEntitlementScope({
        serviceScope: booking.studioSession.classType.serviceScope,
        categorySlug: booking.studioSession.classType.category.slug,
      });
      if (scope === EntitlementScope.PRIVATE_CLASSES) {
        totals.private += 1;
      } else if (scope === EntitlementScope.COLLECTIVE_CLASSES) {
        totals.collective += 1;
      }
      return totals;
    },
    { collective: 0, private: 0 },
  );
  const nextCreditExpiration =
    entitlementRows
      .map((row) => row.expiresAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;

  return {
    plansBought: plansBought.map((entry) => ({
      orderId: entry.orderId,
      productName: entry.productNameSnapshot,
      priceName: entry.priceNameSnapshot,
      amountMinor: entry.lineTotalAmountMinor,
      currencyCode: entry.currencyCode,
      purchasedAt: entry.order.placedAt.toISOString(),
    })),
    classesBooked: bookedClassRows.length,
    collectiveClassesBooked: bookedTotals.collective,
    privateClassesBooked: bookedTotals.private,
    classesCancelled,
    outstandingMemberships: outstandingMemberships.map((subscription) => ({
      id: subscription.id,
      productName: subscription.product.name,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    })),
    creditEntitlements: entitlementRows,
    creditsRemaining,
    nextCreditExpiration,
    eligibleCreditProducts: creditProducts,
  };
}

export async function adjustAdminClientCredits(input: {
  clientId: string;
  adminUserId: string;
  amount: number;
  entitlementId?: string;
  productId?: string;
  expiresAt?: Date | null;
  reason?: string;
}) {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw new Error("INVALID_CREDIT_AMOUNT");
  }
  const normalizedReason = input.reason?.trim() ?? "";
  if (!normalizedReason) {
    throw new Error("CREDIT_ADJUSTMENT_REASON_REQUIRED");
  }

  const now = new Date();
  const [clientRecord, adminRecord] = await prisma.$transaction([
    prisma.user.findUnique({
      where: { id: input.clientId },
      select: { id: true, role: true },
    }),
    prisma.user.findUnique({
      where: { id: input.adminUserId },
      select: { id: true, role: true },
    }),
  ]);

  if (!clientRecord || clientRecord.role !== Role.CLIENT) {
    throw new Error("CLIENT_NOT_FOUND");
  }

  if (!adminRecord || (adminRecord.role !== Role.ADMIN && adminRecord.role !== Role.MASTER_ADMIN)) {
    throw new Error("ADMIN_USER_NOT_FOUND");
  }

  if (input.entitlementId) {
    const entitlement = await prisma.clientEntitlement.findFirst({
      where: {
        id: input.entitlementId,
        clientId: input.clientId,
        entitlementType: {
          in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
        },
      },
      select: {
        id: true,
      },
    });

    if (!entitlement) {
      throw new Error("ENTITLEMENT_NOT_FOUND");
    }

    return prisma.$transaction(async (tx) => {
      if (input.expiresAt !== undefined) {
        await tx.clientEntitlement.update({
          where: { id: entitlement.id },
          data: { expiresAt: input.expiresAt ?? null },
        });
      }

      const currentBalanceAggregate = await tx.creditLedgerEntry.aggregate({
        where: {
          entitlementId: entitlement.id,
        },
        _sum: {
          amount: true,
        },
      });
      const currentBalance = currentBalanceAggregate._sum.amount ?? 0;
      const nextBalance = currentBalance + input.amount;
      if (nextBalance < 0) {
        throw new Error("CREDIT_BALANCE_NEGATIVE_FORBIDDEN");
      }

      await tx.creditLedgerEntry.create({
        data: {
          clientId: clientRecord.id,
          entitlementId: entitlement.id,
          entryType: CreditLedgerEntryType.ADJUSTMENT,
          amount: input.amount,
          happenedAt: now,
          createdById: adminRecord.id,
          notes: normalizedReason,
        },
      });
    });
  }

  if (!input.productId) {
    throw new Error("PRODUCT_REQUIRED");
  }
  const targetProductId = input.productId;

  if (input.amount < 1) {
    throw new Error("POSITIVE_AMOUNT_REQUIRED");
  }

  const entitlementRule = await prisma.entitlementRule.findFirst({
    where: {
      productId: targetProductId,
      isActive: true,
      entitlementType: {
        in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      entitlementType: true,
      entitlementScope: true,
    },
  });

  if (!entitlementRule) {
    throw new Error("PRODUCT_NOT_CREDIT_ELIGIBLE");
  }

  return prisma.$transaction(async (tx) => {
    const entitlement = await tx.clientEntitlement.create({
      data: {
        clientId: clientRecord.id,
        productId: targetProductId,
        entitlementType: entitlementRule.entitlementType,
        entitlementScope: entitlementRule.entitlementScope,
        status: ClientEntitlementStatus.ACTIVE,
        activatedAt: now,
        expiresAt: input.expiresAt ?? null,
        notes: "Admin-created credit entitlement.",
      },
      select: {
        id: true,
      },
    });

    await tx.creditLedgerEntry.create({
      data: {
        clientId: clientRecord.id,
        entitlementId: entitlement.id,
        entryType: CreditLedgerEntryType.ADJUSTMENT,
        amount: input.amount,
        happenedAt: now,
        createdById: adminRecord.id,
        notes: normalizedReason,
      },
    });
  });
}

export async function cancelAdminClientMembership(input: {
  clientId: string;
  subscriptionContractId: string;
}) {
  const now = new Date();
  const updated = await prisma.subscriptionContract.updateMany({
    where: {
      id: input.subscriptionContractId,
      clientId: input.clientId,
    },
    data: {
      status: SubscriptionStatus.CANCELLED,
      cancelAtPeriodEnd: true,
      cancelledAt: now,
      endedAt: now,
    },
  });

  if (updated.count === 0) {
    throw new Error("SUBSCRIPTION_NOT_FOUND");
  }
}

export async function createAdminUser(input: {
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  password: string;
  createdByUserId?: string;
}) {
  if (input.role === Role.MASTER_ADMIN) {
    if (!input.createdByUserId) {
      throw new Error("MASTER_ADMIN_ASSIGNMENT_FORBIDDEN");
    }

    const actor = await prisma.user.findUnique({
      where: { id: input.createdByUserId },
      select: { role: true },
    });

    if (!actor || actor.role !== Role.MASTER_ADMIN) {
      throw new Error("MASTER_ADMIN_ASSIGNMENT_FORBIDDEN");
    }
  }

  const passwordHash = await hash(input.password, 12);
  const { firstName, lastName } = splitName(input.name);

  return createUserFromTrustedFlow({
    firstName,
    lastName,
    email: input.email,
    passwordHash,
    role: input.role,
    createdVia: "ADMIN",
    createdByUserId: input.createdByUserId ?? null,
    createdIp: "admin-panel",
    activationStatus: input.isActive ? "ACTIVE" : "DISABLED",
    isActive: input.isActive,
    markEmailVerified: true,
  });
}

export async function updateAdminUser(
  id: string,
  input: {
    firstName?: string;
    lastName?: string;
    name?: string;
    email: string;
    role: Role;
    isActive: boolean;
    phone?: string;
    notes?: string;
    bio?: string;
    specialties?: string[];
    certifications?: string[];
    hireDate?: Date | null;
    password?: string;
    marketingSubscriptionStatus?: MarketingSubscriptionStatus;
    marketingSegmentIds?: string[];
  },
  actor: {
    id: string;
    role: Role;
  },
) {
  const passwordHash = input.password ? await hash(input.password, 12) : undefined;
  const firstName = input.firstName?.trim() ?? "";
  const lastName = input.lastName?.trim() ?? "";
  const fullName = `${firstName} ${lastName}`.trim() || input.name?.trim() || "User";
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPhone = toNullable(input.phone);
  const normalizedNotes = toNullable(input.notes);
  const normalizedBio = toNullable(input.bio);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id },
      select: {
        email: true,
        role: true,
      },
    });
    const actorRecord = await tx.user.findUnique({
      where: { id: actor.id },
      select: {
        role: true,
      },
    });

    const actorRole = actorRecord?.role ?? actor.role;

    if (actorRole !== Role.ADMIN && actorRole !== Role.MASTER_ADMIN) {
      throw new Error("ADMIN_USER_NOT_FOUND");
    }

    if (!existing) {
      throw new Error("USER_NOT_FOUND");
    }

    if (existing.role === Role.MASTER_ADMIN && actorRole !== Role.MASTER_ADMIN) {
      throw new Error("MASTER_ADMIN_MANAGEMENT_FORBIDDEN");
    }

    if (actorRole === Role.ADMIN && input.role === Role.MASTER_ADMIN) {
      throw new Error("MASTER_ADMIN_ASSIGNMENT_FORBIDDEN");
    }

    if (input.role !== Role.CLIENT && (input.marketingSubscriptionStatus || (input.marketingSegmentIds?.length ?? 0) > 0)) {
      throw new Error("MARKETING_CLIENT_ONLY");
    }

    await tx.user.update({
      where: { id },
      data: {
        name: fullName,
        firstName: firstName || null,
        lastName: lastName || null,
        role: input.role,
        isActive: input.isActive,
        isInactive: !input.isActive,
        activationStatus: input.isActive ? "ACTIVE" : "DISABLED",
        ...(input.role === Role.CLIENT && input.marketingSubscriptionStatus
          ? { marketingSubscriptionStatus: input.marketingSubscriptionStatus }
          : {}),
        ...(passwordHash ? { passwordHash } : {}),
      },
    });

    if (existing && existing.email.toLowerCase() !== normalizedEmail) {
      await applyTrustedAdminEmailChange({
        userId: id,
        newEmail: normalizedEmail,
      });
    }

    if (input.role === Role.TEACHER) {
      await tx.teacherProfile.upsert({
        where: { userId: id },
        update: {
          phone: normalizedPhone,
          bio: normalizedBio,
          specialties: input.specialties ?? [],
          certifications: input.certifications ?? [],
          hireDate: input.hireDate ?? null,
        },
        create: {
          userId: id,
          phone: normalizedPhone,
          bio: normalizedBio,
          specialties: input.specialties ?? [],
          certifications: input.certifications ?? [],
          hireDate: input.hireDate ?? null,
        },
      });
    } else {
      await tx.clientProfile.upsert({
        where: { userId: id },
        update: {
          phone: normalizedPhone,
          notes: normalizedNotes,
        },
        create: {
          userId: id,
          phone: normalizedPhone,
          notes: normalizedNotes,
        },
      });

      if (input.role === Role.CLIENT && input.marketingSegmentIds) {
        const segmentIds = [...new Set(input.marketingSegmentIds.filter(Boolean))];
        const validSegments = await tx.marketingSegment.findMany({
          where: { id: { in: segmentIds } },
          select: { id: true },
        });
        const validSegmentIds = validSegments.map((segment) => segment.id);

        await tx.marketingUserSegment.deleteMany({
          where: { userId: id },
        });

        if (validSegmentIds.length > 0) {
          await tx.marketingUserSegment.createMany({
            data: validSegmentIds.map((segmentId) => ({
              userId: id,
              segmentId,
            })),
            skipDuplicates: true,
          });
        }
      }
    }

    return tx.user.findUnique({
      where: { id },
    });
  });
}

async function assertAdminActor(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { role: true },
  });

  if (!actor || (actor.role !== Role.ADMIN && actor.role !== Role.MASTER_ADMIN)) {
    throw new Error("ADMIN_USER_NOT_FOUND");
  }
}

export async function listAdminMarketingSegmentOptions(): Promise<AdminMarketingSegmentOption[]> {
  const segments = await prisma.marketingSegment.findMany({
    where: { isActive: true },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      isActive: true,
    },
  });

  return segments;
}

export async function bulkSetClientMarketingSubscriptionStatus(input: {
  actorUserId: string;
  userIds: string[];
  status: MarketingSubscriptionStatus;
}) {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  if (userIds.length < 1) {
    throw new Error("USERS_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(tx, input.actorUserId);

    const clientCount = await tx.user.count({
      where: {
        id: { in: userIds },
        role: Role.CLIENT,
      },
    });

    if (clientCount !== userIds.length) {
      throw new Error("MARKETING_CLIENT_ONLY");
    }

    const updated = await tx.user.updateMany({
      where: { id: { in: userIds } },
      data: { marketingSubscriptionStatus: input.status },
    });

    return updated.count;
  });
}

export async function bulkAddClientMarketingSegments(input: {
  actorUserId: string;
  userIds: string[];
  segmentIds: string[];
}) {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  const segmentIds = [...new Set(input.segmentIds.filter(Boolean))];

  if (userIds.length < 1) {
    throw new Error("USERS_REQUIRED");
  }
  if (segmentIds.length < 1) {
    throw new Error("SEGMENTS_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(tx, input.actorUserId);

    const clientCount = await tx.user.count({
      where: {
        id: { in: userIds },
        role: Role.CLIENT,
      },
    });
    const segments = await tx.marketingSegment.findMany({
      where: { id: { in: segmentIds } },
      select: { id: true },
    });

    if (clientCount !== userIds.length) {
      throw new Error("MARKETING_CLIENT_ONLY");
    }
    if (segments.length !== segmentIds.length) {
      throw new Error("SEGMENTS_NOT_FOUND");
    }

    const rows = userIds.flatMap((userId) =>
      segmentIds.map((segmentId) => ({
        userId,
        segmentId,
      })),
    );

    const created = await tx.marketingUserSegment.createMany({
      data: rows,
      skipDuplicates: true,
    });

    return created.count;
  });
}

export async function bulkRemoveClientMarketingSegments(input: {
  actorUserId: string;
  userIds: string[];
  segmentIds: string[];
}) {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  const segmentIds = [...new Set(input.segmentIds.filter(Boolean))];

  if (userIds.length < 1) {
    throw new Error("USERS_REQUIRED");
  }
  if (segmentIds.length < 1) {
    throw new Error("SEGMENTS_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(tx, input.actorUserId);

    const clientCount = await tx.user.count({
      where: {
        id: { in: userIds },
        role: Role.CLIENT,
      },
    });
    const segments = await tx.marketingSegment.findMany({
      where: { id: { in: segmentIds } },
      select: { id: true },
    });

    if (clientCount !== userIds.length) {
      throw new Error("MARKETING_CLIENT_ONLY");
    }
    if (segments.length !== segmentIds.length) {
      throw new Error("SEGMENTS_NOT_FOUND");
    }

    const deleted = await tx.marketingUserSegment.deleteMany({
      where: {
        userId: { in: userIds },
        segmentId: { in: segmentIds },
      },
    });

    return deleted.count;
  });
}

export async function updateAdminTeacherImage(input: {
  userId: string;
  imagePath: string;
  adminUserId: string;
}) {
  const trimmed = input.imagePath.trim();
  const imagePath = assertCanonicalMediaPublicPath(trimmed, ["teachers"]);
  const [teacherRecord, adminRecord] = await prisma.$transaction([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, role: true },
    }),
    prisma.user.findUnique({
      where: { id: input.adminUserId },
      select: { id: true, role: true },
    }),
  ]);

  if (!teacherRecord || teacherRecord.role !== Role.TEACHER) {
    throw new Error("TEACHER_NOT_FOUND");
  }

  if (!adminRecord || (adminRecord.role !== Role.ADMIN && adminRecord.role !== Role.MASTER_ADMIN)) {
    throw new Error("ADMIN_USER_NOT_FOUND");
  }

  return prisma.user.update({
    where: { id: teacherRecord.id },
    data: {
      image: imagePath,
    },
    select: {
      id: true,
      image: true,
    },
  });
}

export async function getAdminClientRecoveryState(params: {
  clientId: string;
  actor: { actorId: string; actorRole: Role };
}): Promise<AdminClientRecoveryState> {
  if (params.actor.actorRole !== Role.ADMIN && params.actor.actorRole !== Role.MASTER_ADMIN) {
    throw new Error("ADMIN_ROLE_REQUIRED");
  }

  const now = new Date();

  const contracts = await prisma.subscriptionContract.findMany({
    where: { clientId: params.clientId },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      id: true,
      status: true,
      currentPeriodEnd: true,
      endedAt: true,
      product: { select: { name: true } },
    },
  });

  const active = contracts.find(
    (c) =>
      c.status === SubscriptionStatus.ACTIVE &&
      c.currentPeriodEnd > now &&
      (c.endedAt === null || c.endedAt > now),
  );
  if (active) {
    return { status: "HEALTHY", contractId: active.id, productName: active.product.name };
  }

  const pastDue = contracts.find((c) => c.status === SubscriptionStatus.PAST_DUE);
  if (pastDue) {
    return { status: "PAST_DUE", contractId: pastDue.id, productName: pastDue.product.name };
  }

  const cancelled = contracts.find(
    (c) => c.status === SubscriptionStatus.CANCELLED || c.status === SubscriptionStatus.EXPIRED,
  );
  if (cancelled) {
    return { status: "CANCELLED", contractId: cancelled.id, productName: cancelled.product.name };
  }

  return { status: "NONE" };
}

