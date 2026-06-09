import Link from "next/link";
import { notFound } from "next/navigation";
import { CouponDiscountType, CouponStatus } from "@prisma/client";

import { updateAdminCouponAction } from "@/app/admin/(private)/coupons/actions";
import { AdminCouponForm } from "@/components/admin/AdminCouponForm";
import { requireAdminSession } from "@/lib/auth/require-auth";
import { getAdminCouponById } from "@/lib/coupons/coupon-admin-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

function toDateInputValue(value: Date | null): string {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

function toDiscountInputValue(coupon: {
  discountType: CouponDiscountType;
  discountPercentBps: number | null;
  discountAmountMinor: number | null;
}): string {
  if (coupon.discountType === CouponDiscountType.PERCENTAGE) {
    return coupon.discountPercentBps ? (coupon.discountPercentBps / 100).toString() : "";
  }

  if (!coupon.discountAmountMinor) {
    return "";
  }

  return (coupon.discountAmountMinor / 100).toFixed(2);
}

export default async function AdminCouponEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireAdminSession();
  const { id } = await params;
  const { error } = await searchParams;
  const coupon = await getAdminCouponById(id);

  if (!coupon) {
    notFound();
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Coupon</h1>
        <Link href="/admin/coupons" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to coupons
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <div className="rounded-xl border border-[#d3dbe5] bg-white p-5">
        <AdminCouponForm
          action={updateAdminCouponAction}
          submitLabel="Save"
          archived={coupon.status === CouponStatus.ARCHIVED}
          initialValues={{
            couponId: coupon.id,
            name: coupon.name ?? "",
            code: coupon.code,
            status: coupon.status,
            description: coupon.description ?? "",
            discountType: coupon.discountType,
            discountValue: toDiscountInputValue(coupon),
            validFrom: toDateInputValue(coupon.startsAt),
            validUntil: toDateInputValue(coupon.expiresAt),
            maxTotalRedemptions: coupon.maxTotalRedemptions?.toString() ?? "",
            maxRedemptionsPerClient: coupon.maxRedemptionsPerClient?.toString() ?? "",
          }}
        />
      </div>
    </section>
  );
}
