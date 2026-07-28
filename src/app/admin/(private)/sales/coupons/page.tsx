import { CouponRedemptionStatus, Role } from "@prisma/client";
import Link from "next/link";

import AdminListControls from "@/components/admin/AdminListControls";
import AdminPagination from "@/components/admin/AdminPagination";
import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  listAdminCouponUsageHistory,
  type AdminCouponUsageStatusFilter,
} from "@/lib/coupons/coupon-admin-service";

type SearchParams = Promise<{
  page?: string | string[];
  status?: string | string[];
  q?: string | string[];
}>;

const STATUS_OPTIONS: Array<{ value: AdminCouponUsageStatusFilter; label: string }> = [
  { value: "ALL", label: "All Statuses" },
  { value: CouponRedemptionStatus.RESERVED, label: "Reserved" },
  { value: CouponRedemptionStatus.APPLIED, label: "Applied" },
  { value: CouponRedemptionStatus.REJECTED, label: "Rejected" },
  { value: CouponRedemptionStatus.EXPIRED, label: "Expired" },
  { value: CouponRedemptionStatus.REVERSED, label: "Reversed" },
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | string[] | undefined): number {
  const parsed = Number(firstParam(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseStatus(value: string | string[] | undefined): AdminCouponUsageStatusFilter {
  const raw = firstParam(value);
  if (
    raw === CouponRedemptionStatus.RESERVED ||
    raw === CouponRedemptionStatus.APPLIED ||
    raw === CouponRedemptionStatus.REJECTED ||
    raw === CouponRedemptionStatus.EXPIRED ||
    raw === CouponRedemptionStatus.REVERSED
  ) {
    return raw;
  }
  return "ALL";
}

function formatMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: currencyCode,
  }).format(amountMinor / 100);
}

function formatDate(value: Date | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function buildPageHref(page: number, status: AdminCouponUsageStatusFilter, query: string) {
  const search = new URLSearchParams();
  search.set("page", String(page));
  search.set("status", status);
  if (query) {
    search.set("q", query);
  }
  return `/admin/sales/coupons?${search.toString()}`;
}

function paymentReferenceLabel(item: {
  paymentProvider: string | null;
  paymentMethod: string | null;
  paymentAmountMinor: number | null;
  stripeCheckoutSessionId: string | null;
}) {
  if (item.paymentProvider === "INTERNAL" && item.paymentMethod === "MANUAL" && item.paymentAmountMinor === 0) {
    return "Internal manual payment - no Stripe session";
  }
  return item.stripeCheckoutSessionId ?? "No Stripe session";
}

export default async function AdminCouponSalesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireAdminSession();
  const params = await searchParams;
  const page = parsePage(params.page);
  const status = parseStatus(params.status);
  const query = firstParam(params.q)?.trim() ?? "";
  const actor = { userId: session.user.id, role: session.user.role as Role };
  const data = await listAdminCouponUsageHistory({ actor, page, pageSize: 20, status, query });

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Coupon Redemptions</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">
            Track coupon redemptions, discounts applied, and related orders.
          </p>
        </div>

        <div className="flex flex-wrap items-start justify-end gap-2">
          <Link href="/admin/coupons" className="rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm font-medium text-[#1f2735]">
            Manage coupons
          </Link>
          <AdminListControls
            basePath="/admin/sales/coupons"
            filterName="status"
            filterValue={data.status}
            filterOptions={STATUS_OPTIONS}
            searchName="q"
            searchValue={data.query}
            searchPlaceholder="Search coupon, client, or email"
            searchAriaLabel="Search coupon usage"
          />
        </div>
      </header>

      {data.items.length === 0 ? (
        <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">
          No coupon usage found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
              <tr>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Coupon</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Discount</th>
                <th className="px-3 py-2">Total After</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Payment</th>
                <th className="px-3 py-2">Applied</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                  <td className="px-3 py-2">{formatDate(item.createdAt)}</td>
                  <td className="px-3 py-2 font-medium">
                    {item.couponCode}
                    {item.couponName ? <p className="text-xs text-[#5a6d86]">{item.couponName}</p> : null}
                  </td>
                  <td className="px-3 py-2">
                    {item.clientName ?? "-"}
                    <p className="text-xs text-[#5a6d86]">{item.clientEmail}</p>
                  </td>
                  <td className="px-3 py-2">{item.status}</td>
                  <td className="px-3 py-2">{formatMoney(item.discountAmountMinor, item.currencyCode)}</td>
                  <td className="px-3 py-2">{formatMoney(item.totalAfterMinor, item.currencyCode)}</td>
                  <td className="px-3 py-2">
                    {item.orderId ?? "-"}
                    {item.orderStatus ? <p className="text-xs text-[#5a6d86]">{item.orderStatus}</p> : null}
                  </td>
                  <td className="px-3 py-2">
                    {paymentReferenceLabel(item)}
                    {item.paymentStatus ? <p className="text-xs text-[#5a6d86]">{item.paymentStatus}</p> : null}
                  </td>
                  <td className="px-3 py-2">{formatDate(item.appliedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminPagination
        page={data.page}
        totalPages={data.totalPages}
        onChange={(nextPage) => buildPageHref(nextPage, data.status, data.query)}
      />
    </section>
  );
}
