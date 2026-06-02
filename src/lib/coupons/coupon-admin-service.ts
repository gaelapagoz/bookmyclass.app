import { CouponDiscountType, CouponRedemptionStatus, CouponStatus, Prisma, Role } from "@prisma/client";

import { prisma } from "@/lib/db";
import { normalizeCouponCode } from "@/lib/coupons/coupon-primitives";

export type AdminCouponRow = {
  id: string;
  code: string;
  name: string | null;
  description: string | null;
  status: CouponStatus;
  discountType: CouponDiscountType;
  discountPercentBps: number | null;
  discountAmountMinor: number | null;
  currencyCode: string | null;
  startsAt: Date | null;
  expiresAt: Date;
  minOrderAmountMinor: number | null;
  maxTotalRedemptions: number | null;
  maxRedemptionsPerClient: number | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminCouponUsageStatusFilter = CouponRedemptionStatus | "ALL";

export type AdminCouponUsageHistoryRow = {
  id: string;
  status: CouponRedemptionStatus;
  couponCode: string;
  couponName: string | null;
  clientName: string | null;
  clientEmail: string;
  subtotalBeforeMinor: number;
  discountAmountMinor: number;
  totalAfterMinor: number;
  currencyCode: string;
  orderId: string | null;
  orderStatus: string | null;
  paymentId: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  paymentProvider: string | null;
  paymentAmountMinor: number | null;
  stripeCheckoutSessionId: string | null;
  reservedAt: Date | null;
  appliedAt: Date | null;
  reversedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
};

const DEFAULT_COUPON_USAGE_PAGE_SIZE = 20;
const MAX_COUPON_USAGE_PAGE_SIZE = 100;
const MAX_COUPON_USAGE_QUERY_LENGTH = 120;

type CouponAdminActor = {
  id: string;
  role: Role;
};

type CouponUpsertInput = {
  code: string;
  name?: string | null;
  description?: string | null;
  status: CouponStatus;
  discountType: CouponDiscountType;
  discountPercentBps?: number | null;
  discountAmountMinor?: number | null;
  currencyCode?: string | null;
  startsAt?: Date | null;
  expiresAt: Date;
  minOrderAmountMinor?: number | null;
  maxTotalRedemptions?: number | null;
  maxRedemptionsPerClient?: number | null;
};

async function resolveCouponAdminActor(actorUserId: string): Promise<CouponAdminActor> {
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, role: true },
  });
  if (!actor || (actor.role !== Role.ADMIN && actor.role !== Role.MASTER_ADMIN)) {
    throw new Error("ADMIN_ROLE_REQUIRED");
  }
  return actor;
}

function normalizeCouponUsagePage(input: { page?: number; pageSize?: number }) {
  const page = Number.isInteger(input.page) && input.page && input.page > 0 ? input.page : 1;
  const requestedPageSize =
    Number.isInteger(input.pageSize) && input.pageSize ? input.pageSize : DEFAULT_COUPON_USAGE_PAGE_SIZE;
  const pageSize = Math.min(Math.max(requestedPageSize, 1), MAX_COUPON_USAGE_PAGE_SIZE);

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  };
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function assertCouponAdminInput(input: CouponUpsertInput): {
  code: string;
  name: string | null;
  description: string | null;
  currencyCode: string | null;
} {
  const code = normalizeCouponCode(input.code);
  const name = normalizeOptionalText(input.name);
  const description = normalizeOptionalText(input.description);

  if (input.expiresAt.getTime() <= Date.now() - 1) {
    throw new Error("COUPON_EXPIRES_AT_INVALID");
  }
  if (input.startsAt && input.startsAt.getTime() >= input.expiresAt.getTime()) {
    throw new Error("COUPON_STARTS_AT_INVALID");
  }
  if (input.minOrderAmountMinor !== null && input.minOrderAmountMinor !== undefined && input.minOrderAmountMinor < 0) {
    throw new Error("COUPON_MIN_ORDER_INVALID");
  }
  if (input.maxTotalRedemptions !== null && input.maxTotalRedemptions !== undefined && input.maxTotalRedemptions < 1) {
    throw new Error("COUPON_MAX_TOTAL_REDEMPTIONS_INVALID");
  }
  if (input.maxRedemptionsPerClient !== null && input.maxRedemptionsPerClient !== undefined && input.maxRedemptionsPerClient < 1) {
    throw new Error("COUPON_MAX_PER_CLIENT_INVALID");
  }

  if (input.discountType === CouponDiscountType.PERCENTAGE) {
    if ((input.discountPercentBps ?? 0) < 1 || (input.discountPercentBps ?? 0) > 10_000) {
      throw new Error("COUPON_PERCENT_INVALID");
    }
    if (input.discountAmountMinor !== null && input.discountAmountMinor !== undefined) {
      throw new Error("COUPON_FIXED_AMOUNT_FORBIDDEN");
    }
    if (input.currencyCode) {
      throw new Error("COUPON_PERCENT_CURRENCY_FORBIDDEN");
    }
    return { code, name, description, currencyCode: null };
  }

  if ((input.discountAmountMinor ?? 0) < 1) {
    throw new Error("COUPON_FIXED_AMOUNT_INVALID");
  }
  if (input.discountPercentBps !== null && input.discountPercentBps !== undefined) {
    throw new Error("COUPON_PERCENT_FORBIDDEN");
  }
  const currencyCode = input.currencyCode?.trim().toUpperCase() ?? null;
  if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) {
    throw new Error("COUPON_CURRENCY_INVALID");
  }
  return { code, name, description, currencyCode };
}

type CouponAuditWriter = Pick<Prisma.TransactionClient, "auditLog">;

async function writeCouponAuditLog(
  db: CouponAuditWriter,
  input: {
  actorId: string;
  actionType:
    | "COUPON_CREATE"
    | "COUPON_UPDATE"
    | "COUPON_ACTIVATE"
    | "COUPON_DEACTIVATE"
    | "COUPON_ARCHIVE";
  couponId: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await db.auditLog.create({
    data: {
      actorId: input.actorId,
      actionType: input.actionType,
      entityType: "Coupon",
      entityId: input.couponId,
      metadata: input.metadata,
    },
  });
}

export async function listAdminCoupons(): Promise<AdminCouponRow[]> {
  return prisma.coupon.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      status: true,
      discountType: true,
      discountPercentBps: true,
      discountAmountMinor: true,
      currencyCode: true,
      startsAt: true,
      expiresAt: true,
      minOrderAmountMinor: true,
      maxTotalRedemptions: true,
      maxRedemptionsPerClient: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function listAdminCouponUsageHistory(input: {
  actor: { readonly userId: string; readonly role: Role };
  page?: number;
  pageSize?: number;
  status?: AdminCouponUsageStatusFilter;
  query?: string;
}): Promise<{
  items: AdminCouponUsageHistoryRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  status: AdminCouponUsageStatusFilter;
  query: string;
}> {
  await resolveCouponAdminActor(input.actor.userId);
  const { page, pageSize, skip } = normalizeCouponUsagePage(input);
  const status = input.status ?? "ALL";
  const query = input.query?.trim().slice(0, MAX_COUPON_USAGE_QUERY_LENGTH) ?? "";

  const where: Prisma.CouponRedemptionWhereInput = {
    ...(status === "ALL" ? {} : { status }),
    ...(query
      ? {
          OR: [
            { couponCodeSnapshot: { contains: query, mode: "insensitive" } },
            { coupon: { code: { contains: query, mode: "insensitive" } } },
            { coupon: { name: { contains: query, mode: "insensitive" } } },
            { client: { name: { contains: query, mode: "insensitive" } } },
            { client: { email: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [items, totalItems] = await prisma.$transaction([
    prisma.couponRedemption.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        status: true,
        couponCodeSnapshot: true,
        subtotalBeforeMinor: true,
        discountAmountMinor: true,
        totalAfterMinor: true,
        currencyCode: true,
        orderId: true,
        paymentId: true,
        stripeCheckoutSessionId: true,
        reservedAt: true,
        appliedAt: true,
        reversedAt: true,
        expiresAt: true,
        createdAt: true,
        coupon: { select: { code: true, name: true } },
        client: { select: { name: true, email: true } },
        order: { select: { status: true } },
        payment: {
          select: {
            status: true,
            method: true,
            provider: true,
            stripeCheckoutSessionId: true,
            amountMinor: true,
          },
        },
      },
    }),
    prisma.couponRedemption.count({ where }),
  ]);

  return {
    items: items.map((item) => ({
      id: item.id,
      status: item.status,
      couponCode: item.couponCodeSnapshot || item.coupon.code,
      couponName: item.coupon.name,
      clientName: item.client.name,
      clientEmail: item.client.email,
      subtotalBeforeMinor: item.subtotalBeforeMinor,
      discountAmountMinor: item.discountAmountMinor,
      totalAfterMinor: item.totalAfterMinor,
      currencyCode: item.currencyCode,
      orderId: item.orderId,
      orderStatus: item.order?.status ?? null,
      paymentId: item.paymentId,
      paymentStatus: item.payment?.status ?? null,
      paymentMethod: item.payment?.method ?? null,
      paymentProvider: item.payment?.provider ?? null,
      paymentAmountMinor: item.payment?.amountMinor ?? null,
      stripeCheckoutSessionId: item.payment?.stripeCheckoutSessionId ?? item.stripeCheckoutSessionId ?? null,
      reservedAt: item.reservedAt,
      appliedAt: item.appliedAt,
      reversedAt: item.reversedAt,
      expiresAt: item.expiresAt,
      createdAt: item.createdAt,
    })),
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    status,
    query,
  };
}

export async function createAdminCoupon(input: {
  actorUserId: string;
  coupon: CouponUpsertInput;
}): Promise<{ id: string }> {
  const actor = await resolveCouponAdminActor(input.actorUserId);
  const normalized = assertCouponAdminInput(input.coupon);
  return prisma.$transaction(async (tx) => {
    const created = await tx.coupon.create({
      data: {
        code: normalized.code,
        name: normalized.name,
        description: normalized.description,
        status: input.coupon.status,
        discountType: input.coupon.discountType,
        discountPercentBps:
          input.coupon.discountType === CouponDiscountType.PERCENTAGE
            ? input.coupon.discountPercentBps ?? null
            : null,
        discountAmountMinor:
          input.coupon.discountType === CouponDiscountType.FIXED_AMOUNT
            ? input.coupon.discountAmountMinor ?? null
            : null,
        currencyCode: normalized.currencyCode,
        startsAt: input.coupon.startsAt ?? null,
        expiresAt: input.coupon.expiresAt,
        minOrderAmountMinor: input.coupon.minOrderAmountMinor ?? null,
        maxTotalRedemptions: input.coupon.maxTotalRedemptions ?? null,
        maxRedemptionsPerClient: input.coupon.maxRedemptionsPerClient ?? null,
        createdById: actor.id,
      },
      select: { id: true },
    });

    await writeCouponAuditLog(tx, {
      actorId: actor.id,
      actionType: "COUPON_CREATE",
      couponId: created.id,
      metadata: { status: input.coupon.status, code: normalized.code },
    });

    return created;
  });
}

export async function updateAdminCoupon(input: {
  actorUserId: string;
  couponId: string;
  coupon: CouponUpsertInput;
}): Promise<void> {
  const actor = await resolveCouponAdminActor(input.actorUserId);
  const normalized = assertCouponAdminInput(input.coupon);
  await prisma.$transaction(async (tx) => {
    await tx.coupon.update({
      where: { id: input.couponId },
      data: {
        code: normalized.code,
        name: normalized.name,
        description: normalized.description,
        status: input.coupon.status,
        discountType: input.coupon.discountType,
        discountPercentBps:
          input.coupon.discountType === CouponDiscountType.PERCENTAGE
            ? input.coupon.discountPercentBps ?? null
            : null,
        discountAmountMinor:
          input.coupon.discountType === CouponDiscountType.FIXED_AMOUNT
            ? input.coupon.discountAmountMinor ?? null
            : null,
        currencyCode: normalized.currencyCode,
        startsAt: input.coupon.startsAt ?? null,
        expiresAt: input.coupon.expiresAt,
        minOrderAmountMinor: input.coupon.minOrderAmountMinor ?? null,
        maxTotalRedemptions: input.coupon.maxTotalRedemptions ?? null,
        maxRedemptionsPerClient: input.coupon.maxRedemptionsPerClient ?? null,
        updatedById: actor.id,
        archivedAt: input.coupon.status === CouponStatus.ARCHIVED ? new Date() : null,
      },
    });

    await writeCouponAuditLog(tx, {
      actorId: actor.id,
      actionType: "COUPON_UPDATE",
      couponId: input.couponId,
      metadata: { status: input.coupon.status, code: normalized.code },
    });
  });
}

export async function setAdminCouponStatus(input: {
  actorUserId: string;
  couponId: string;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
}): Promise<void> {
  const actor = await resolveCouponAdminActor(input.actorUserId);
  await prisma.$transaction(async (tx) => {
    await tx.coupon.update({
      where: { id: input.couponId },
      data: {
        status: input.status,
        updatedById: actor.id,
        archivedAt: input.status === CouponStatus.ARCHIVED ? new Date() : null,
      },
    });

    await writeCouponAuditLog(tx, {
      actorId: actor.id,
      actionType:
        input.status === CouponStatus.ACTIVE
          ? "COUPON_ACTIVATE"
          : input.status === CouponStatus.INACTIVE
            ? "COUPON_DEACTIVATE"
            : "COUPON_ARCHIVE",
      couponId: input.couponId,
      metadata: { status: input.status },
    });
  });
}
