import Link from "next/link";
import { CouponDiscountType, CouponStatus } from "@prisma/client";

import { createAdminCouponAction } from "@/app/admin/(private)/coupons/actions";
import { AdminCouponForm } from "@/components/admin/AdminCouponForm";
import { requireAdminSession } from "@/lib/auth/require-auth";

type SearchParams = Promise<{ error?: string }>;

export default async function AdminCouponCreatePage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminSession();
  const { error } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Create Coupon</h1>
        <Link href="/admin/coupons" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to coupons
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <div className="rounded-xl border border-[#d3dbe5] bg-white p-5">
        <AdminCouponForm
          action={createAdminCouponAction}
          submitLabel="Create coupon"
          initialValues={{
            name: "",
            code: "",
            status: CouponStatus.ACTIVE,
            description: "",
            discountType: CouponDiscountType.PERCENTAGE,
            discountValue: "",
            validFrom: "",
            validUntil: "",
            maxTotalRedemptions: "",
            maxRedemptionsPerClient: "",
          }}
        />
      </div>
    </section>
  );
}
