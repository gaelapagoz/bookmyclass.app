"use server";

import { CouponDiscountType, CouponStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  createAdminCoupon,
  setAdminCouponStatus,
  updateAdminCoupon,
} from "@/lib/coupons/coupon-admin-service";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";

const couponSchema = z.object({
  code: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.nativeEnum(CouponStatus),
  discountType: z.nativeEnum(CouponDiscountType),
  discountPercentBps: z.coerce.number().int().nullable(),
  discountAmountMinor: z.coerce.number().int().nullable(),
  currencyCode: z.string().optional(),
  startsAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date(),
  minOrderAmountMinor: z.coerce.number().int().nullable(),
  maxTotalRedemptions: z.coerce.number().int().nullable(),
  maxRedemptionsPerClient: z.coerce.number().int().nullable(),
});

function toNullableInt(raw: FormDataEntryValue | null): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function toNullableDate(raw: FormDataEntryValue | null): Date | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function redirectWithError(message: string): never {
  redirect(`/admin/coupons?error=${encodeURIComponent(message)}`);
}

function getPrismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }
  const { code } = error as Prisma.PrismaClientKnownRequestError;
  return typeof code === "string" ? code : null;
}

function messageFromError(error: unknown): string {
  const prismaCode = getPrismaErrorCode(error);
  if (prismaCode === "P2002") return "A coupon with this normalized code already exists.";

  const code = error instanceof Error ? error.message : "";
  if (code === "ADMIN_ROLE_REQUIRED") return "Admin access is required.";
  if (code === "COUPON_CODE_INVALID") return "Coupon code format is invalid.";
  if (code === "COUPON_PERCENT_INVALID") return "Percent discount must be between 1 and 10000 bps.";
  if (code === "COUPON_FIXED_AMOUNT_INVALID") return "Fixed amount discount must be greater than zero.";
  if (code === "COUPON_CURRENCY_INVALID") return "Fixed amount coupons require a valid currency code.";
  if (code === "COUPON_EXPIRES_AT_INVALID") return "Expiry must be in the future.";
  if (code === "COUPON_STARTS_AT_INVALID") return "Start date must be before expiry.";
  if (code === "COUPON_MIN_ORDER_INVALID") return "Minimum order amount cannot be negative.";
  if (code === "COUPON_MAX_TOTAL_REDEMPTIONS_INVALID") return "Max total redemptions must be at least 1.";
  if (code === "COUPON_MAX_PER_CLIENT_INVALID") return "Max redemptions per client must be at least 1.";
  return "Unable to save coupon right now.";
}

async function assertAdminAccess() {
  await assertSameOriginServerAction();
  return requireAdminSession();
}

export async function createAdminCouponAction(formData: FormData) {
  const session = await assertAdminAccess();

  const parsed = couponSchema.safeParse({
    code: formData.get("code"),
    name: String(formData.get("name") ?? "").trim() || undefined,
    description: String(formData.get("description") ?? "").trim() || undefined,
    status: String(formData.get("status") ?? CouponStatus.ACTIVE),
    discountType: String(formData.get("discountType") ?? CouponDiscountType.PERCENTAGE),
    discountPercentBps: toNullableInt(formData.get("discountPercentBps")),
    discountAmountMinor: toNullableInt(formData.get("discountAmountMinor")),
    currencyCode: String(formData.get("currencyCode") ?? "").trim() || undefined,
    startsAt: toNullableDate(formData.get("startsAt")),
    expiresAt: toNullableDate(formData.get("expiresAt")),
    minOrderAmountMinor: toNullableInt(formData.get("minOrderAmountMinor")),
    maxTotalRedemptions: toNullableInt(formData.get("maxTotalRedemptions")),
    maxRedemptionsPerClient: toNullableInt(formData.get("maxRedemptionsPerClient")),
  });

  if (!parsed.success || !parsed.data.expiresAt) {
    redirectWithError("Invalid coupon input.");
  }
  const coupon = parsed.data;

  try {
    await createAdminCoupon({
      actorUserId: session.user.id,
      coupon,
    });
  } catch (error) {
    redirectWithError(messageFromError(error));
  }

  revalidatePath("/admin/coupons");
  redirect("/admin/coupons?success=Coupon%20created.");
}

export async function updateAdminCouponAction(formData: FormData) {
  const session = await assertAdminAccess();
  const couponId = String(formData.get("couponId") ?? "").trim();
  if (!couponId) {
    redirectWithError("Coupon ID is required.");
  }

  const parsed = couponSchema.safeParse({
    code: formData.get("code"),
    name: String(formData.get("name") ?? "").trim() || undefined,
    description: String(formData.get("description") ?? "").trim() || undefined,
    status: String(formData.get("status") ?? CouponStatus.ACTIVE),
    discountType: String(formData.get("discountType") ?? CouponDiscountType.PERCENTAGE),
    discountPercentBps: toNullableInt(formData.get("discountPercentBps")),
    discountAmountMinor: toNullableInt(formData.get("discountAmountMinor")),
    currencyCode: String(formData.get("currencyCode") ?? "").trim() || undefined,
    startsAt: toNullableDate(formData.get("startsAt")),
    expiresAt: toNullableDate(formData.get("expiresAt")),
    minOrderAmountMinor: toNullableInt(formData.get("minOrderAmountMinor")),
    maxTotalRedemptions: toNullableInt(formData.get("maxTotalRedemptions")),
    maxRedemptionsPerClient: toNullableInt(formData.get("maxRedemptionsPerClient")),
  });

  if (!parsed.success || !parsed.data.expiresAt) {
    redirectWithError("Invalid coupon input.");
  }
  const coupon = parsed.data;

  try {
    await updateAdminCoupon({
      actorUserId: session.user.id,
      couponId,
      coupon,
    });
  } catch (error) {
    redirectWithError(messageFromError(error));
  }

  revalidatePath("/admin/coupons");
  redirect("/admin/coupons?success=Coupon%20updated.");
}

export async function setAdminCouponStatusAction(formData: FormData) {
  const session = await assertAdminAccess();
  const couponId = String(formData.get("couponId") ?? "").trim();
  const parsedStatus = z
    .enum([CouponStatus.ACTIVE, CouponStatus.INACTIVE, CouponStatus.ARCHIVED])
    .safeParse(String(formData.get("status") ?? ""));

  if (!couponId || !parsedStatus.success) {
    redirectWithError("Invalid coupon status update.");
  }

  try {
    await setAdminCouponStatus({
      actorUserId: session.user.id,
      couponId,
      status: parsedStatus.data,
    });
  } catch (error) {
    redirectWithError(messageFromError(error));
  }

  revalidatePath("/admin/coupons");
  redirect("/admin/coupons?success=Coupon%20status%20updated.");
}
