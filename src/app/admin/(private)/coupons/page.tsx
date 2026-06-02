import { CouponDiscountType, CouponStatus } from "@prisma/client";

import { requireAdminSession } from "@/lib/auth/require-auth";
import { listAdminCoupons } from "@/lib/coupons/coupon-admin-service";
import {
  createAdminCouponAction,
  setAdminCouponStatusAction,
  updateAdminCouponAction,
} from "@/app/admin/(private)/coupons/actions";

type SearchParams = Promise<{
  success?: string;
  error?: string;
}>;

function toDateInputValue(value: Date | null): string {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
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
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-[#1f2735]">Catalog: Coupons</h1>
        <p className="mt-1 text-sm text-[#4b5a72]">
          Create, edit, activate, deactivate, and archive in-app coupons.
        </p>
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

      <div className="rounded-xl border border-[#d3dbe5] bg-white p-4">
        <h2 className="text-lg font-semibold text-[#1f2735]">Create Coupon</h2>
        <form action={createAdminCouponAction} className="mt-3 grid gap-3 md:grid-cols-3">
          <input name="code" placeholder="Code" className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" required />
          <input name="name" placeholder="Name (optional)" className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
          <input name="expiresAt" type="date" className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" required />
          <select name="status" defaultValue={CouponStatus.ACTIVE} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm">
            <option value={CouponStatus.ACTIVE}>Active</option>
            <option value={CouponStatus.INACTIVE}>Inactive</option>
          </select>
          <select name="discountType" defaultValue={CouponDiscountType.PERCENTAGE} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm">
            <option value={CouponDiscountType.PERCENTAGE}>Percentage (bps)</option>
            <option value={CouponDiscountType.FIXED_AMOUNT}>Fixed amount (minor units)</option>
          </select>
          <input name="discountPercentBps" type="number" placeholder="Percent bps (e.g. 1500)" className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
          <input name="discountAmountMinor" type="number" placeholder="Fixed amount minor" className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
          <input name="currencyCode" placeholder="Currency (EUR)" className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
          <input name="startsAt" type="date" className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
          <input name="minOrderAmountMinor" type="number" placeholder="Min order minor" className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
          <input name="maxTotalRedemptions" type="number" placeholder="Max total redemptions" className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
          <input name="maxRedemptionsPerClient" type="number" placeholder="Max per client redemptions" className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
          <textarea name="description" placeholder="Description (optional)" className="rounded border border-[#d3dbe5] px-3 py-2 text-sm md:col-span-3" />
          <div className="md:col-span-3">
            <button type="submit" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">Create coupon</button>
          </div>
        </form>
      </div>

      {coupons.length === 0 ? (
        <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">
          No coupons found.
        </div>
      ) : (
        <div className="space-y-4">
          {coupons.map((coupon) => (
            <article key={coupon.id} className="rounded-xl border border-[#d3dbe5] bg-white p-4">
              <h3 className="text-base font-semibold text-[#1f2735]">{coupon.code}</h3>
              <form action={updateAdminCouponAction} className="mt-3 grid gap-3 md:grid-cols-3">
                <input type="hidden" name="couponId" value={coupon.id} />
                <input name="code" defaultValue={coupon.code} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" required />
                <input name="name" defaultValue={coupon.name ?? ""} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
                <input name="expiresAt" type="date" defaultValue={toDateInputValue(coupon.expiresAt)} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" required />
                <select name="status" defaultValue={coupon.status} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm">
                  <option value={CouponStatus.ACTIVE}>Active</option>
                  <option value={CouponStatus.INACTIVE}>Inactive</option>
                  <option value={CouponStatus.ARCHIVED}>Archived</option>
                </select>
                <select name="discountType" defaultValue={coupon.discountType} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm">
                  <option value={CouponDiscountType.PERCENTAGE}>Percentage (bps)</option>
                  <option value={CouponDiscountType.FIXED_AMOUNT}>Fixed amount (minor units)</option>
                </select>
                <input name="discountPercentBps" type="number" defaultValue={coupon.discountPercentBps ?? ""} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
                <input name="discountAmountMinor" type="number" defaultValue={coupon.discountAmountMinor ?? ""} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
                <input name="currencyCode" defaultValue={coupon.currencyCode ?? ""} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
                <input name="startsAt" type="date" defaultValue={toDateInputValue(coupon.startsAt)} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
                <input name="minOrderAmountMinor" type="number" defaultValue={coupon.minOrderAmountMinor ?? ""} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
                <input name="maxTotalRedemptions" type="number" defaultValue={coupon.maxTotalRedemptions ?? ""} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
                <input name="maxRedemptionsPerClient" type="number" defaultValue={coupon.maxRedemptionsPerClient ?? ""} className="rounded border border-[#d3dbe5] px-3 py-2 text-sm" />
                <textarea name="description" defaultValue={coupon.description ?? ""} placeholder="Description (optional)" className="rounded border border-[#d3dbe5] px-3 py-2 text-sm md:col-span-3" />
                <div className="flex gap-2 md:col-span-3">
                  <button type="submit" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">Save</button>
                </div>
              </form>
              <form action={setAdminCouponStatusAction} className="mt-3 flex gap-2">
                <input type="hidden" name="couponId" value={coupon.id} />
                <button type="submit" name="status" value={CouponStatus.ACTIVE} className="rounded border border-[#d3dbe5] px-3 py-1 text-xs">Activate</button>
                <button type="submit" name="status" value={CouponStatus.INACTIVE} className="rounded border border-[#d3dbe5] px-3 py-1 text-xs">Deactivate</button>
                <button type="submit" name="status" value={CouponStatus.ARCHIVED} className="rounded border border-[#e9b4b4] px-3 py-1 text-xs text-[#8a1c1c]">Archive</button>
              </form>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
