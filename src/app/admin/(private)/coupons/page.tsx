import Link from "next/link";
import { CouponDiscountType, CouponStatus } from "@prisma/client";

import { requireAdminSession } from "@/lib/auth/require-auth";
import { listAdminCoupons } from "@/lib/coupons/coupon-admin-service";

type SearchParams = Promise<{
  success?: string;
  error?: string;
}>;

function formatDate(value: Date | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-BE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function formatDiscountValue(coupon: {
  discountType: CouponDiscountType;
  discountPercentBps: number | null;
  discountAmountMinor: number | null;
}): string {
  if (coupon.discountType === CouponDiscountType.PERCENTAGE) {
    return coupon.discountPercentBps ? `${coupon.discountPercentBps / 100}%` : "-";
  }

  if (!coupon.discountAmountMinor) {
    return "-";
  }

  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: "EUR",
  }).format(coupon.discountAmountMinor / 100);
}

function formatCouponType(discountType: CouponDiscountType): string {
  return discountType === CouponDiscountType.PERCENTAGE ? "Percentage" : "Amount";
}

function formatCouponStatus(status: CouponStatus): string {
  if (status === CouponStatus.ACTIVE) {
    return "Active";
  }
  if (status === CouponStatus.INACTIVE) {
    return "Inactive";
  }
  return "Archived";
}

export default async function AdminCouponsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdminSession();
  const sp = await searchParams;
  const coupons = await listAdminCoupons();

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Coupons</h1>
        <Link href="/admin/coupons/new" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
          Create coupon
        </Link>
      </header>

      {sp.success ? (
        <p className="rounded-md border border-[#b7e4c7] bg-[#edfdf3] px-3 py-2 text-sm text-[#2d6a4f]">
          {sp.success}
        </p>
      ) : null}
      {sp.error ? (
        <p className="rounded-md border border-[#e9b4b4] bg-[#fff1f1] px-3 py-2 text-sm text-[#8a1c1c]">
          {sp.error}
        </p>
      ) : null}

      {coupons.length === 0 ? (
        <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">
          No coupons created yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
              <tr>
                <th className="px-3 py-2">Coupon name</th>
                <th className="px-3 py-2">Coupon code</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Discount value</th>
                <th className="px-3 py-2">Valid from</th>
                <th className="px-3 py-2">Valid until</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) => (
                <tr key={coupon.id} className="border-t border-[#e2e8f0] text-[#334155]">
                  <td className="px-3 py-2 font-medium">{coupon.name?.trim() || "-"}</td>
                  <td className="px-3 py-2">{coupon.code}</td>
                  <td className="px-3 py-2">{formatCouponStatus(coupon.status)}</td>
                  <td className="px-3 py-2">{formatCouponType(coupon.discountType)}</td>
                  <td className="px-3 py-2">{formatDiscountValue(coupon)}</td>
                  <td className="px-3 py-2">{formatDate(coupon.startsAt)}</td>
                  <td className="px-3 py-2">{formatDate(coupon.expiresAt)}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/coupons/${coupon.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
